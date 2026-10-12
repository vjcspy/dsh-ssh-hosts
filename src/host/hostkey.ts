/**
 * Pre-flight host-key check.
 *
 * `ssh` refuses a host whose key changed ("REMOTE HOST IDENTIFICATION HAS
 * CHANGED") and cannot recover from inside the connection: the stale entry has
 * to be removed from `known_hosts` first. The only way to know BEFORE dialling
 * that the recorded entry is stale is to ask the host, and `ssh-keyscan` is the
 * one process this plugin ever spawns — it speaks the SSH handshake,
 * authenticates nothing and runs no local command.
 *
 * The check is deliberately narrow:
 *
 * - it runs only when the destination already has a `known_hosts` entry, so a
 *   first connect is untouched and pays no extra round trip;
 * - it deletes only after the scan DISPROVES the recorded key;
 * - it never writes key material. The connection that follows carries
 *   `-o StrictHostKeyChecking=accept-new`, so ssh records the key it actually
 *   negotiated (see `buildLaunch`), and this module only ever removes.
 */
import { execFile } from 'node:child_process'
import { createHash, createHmac } from 'node:crypto'
import { readFile, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { expandHome } from '../model.ts'
import type { Host, HostKeyReport } from '../types.ts'

/** Key algorithms `ssh-keyscan` is asked for; each also names its `known_hosts` line. */
const SCAN_TYPES = 'rsa,ecdsa,ed25519'

/** One non-comment `known_hosts` line. */
export interface KnownHostLine {
  /** 1-based line number in the file. */
  readonly line: number
  /** Host patterns as written; a hashed pattern reads `|1|salt|hash`. */
  readonly hosts: readonly string[]
  /** Key algorithm as written, e.g. `ssh-ed25519` or `ecdsa-sha2-nistp256`. */
  readonly keyType: string
  /** Base64 key blob. */
  readonly blob: string
  /** `@cert-authority` or `@revoked`, when the line carries one. */
  readonly marker?: string
}

/** Options of one pre-flight check. */
export interface HostKeyCheckOptions {
  /** Home directory for `~` expansion. */
  readonly home: string
  /** Deadline for the scan, in milliseconds. */
  readonly timeoutMs: number
}

/**
 * Parse the key lines of a `known_hosts` body.
 * @param body - the file's text.
 * @returns one entry per non-empty, non-comment line that has all three fields.
 */
export function parseKnownHosts(body: string): KnownHostLine[] {
  const out: KnownHostLine[] = []
  const lines = body.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = (lines[index] ?? '').trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const fields = trimmed.split(/\s+/u)
    const marker = (fields[0] ?? '').startsWith('@') ? fields.shift() : undefined
    const hostField = fields[0]
    const keyType = fields[1]
    const blob = fields[2]
    if (hostField === undefined || keyType === undefined || blob === undefined) continue
    out.push({
      line: index + 1,
      hosts: hostField.split(','),
      keyType,
      blob,
      ...(marker === undefined ? {} : { marker }),
    })
  }
  return out
}

/**
 * The `known_hosts` host token of a destination: `host` on port 22 and
 * `[host]:port` otherwise — exactly what ssh looks up for a `-p` connection. A
 * plain `host` entry is NOT that token, so matching it would delete a port-22
 * entry that is still valid.
 * @param host - the address as configured.
 * @param port - the effective port.
 * @returns the one token to match.
 */
export function hostTokens(host: string, port: number): string[] {
  const name = host.toLowerCase()
  return port === 22 ? [name] : [`[${name}]:${port}`]
}

/**
 * Whether one `known_hosts` host pattern matches a token.
 *
 * Supports the hashed form `HashKnownHosts` writes: `|1|salt|HMAC-SHA1(salt,
 * host)`. `*` and `?` wildcards are not supported — a generated entry never
 * carries one, and a wrong match would delete a line that is still valid.
 * @param pattern - one comma-separated pattern as written.
 * @param token - the destination token, already lower-cased.
 * @returns whether ssh would consider the pattern a match.
 */
export function patternMatches(pattern: string, token: string): boolean {
  if (!pattern.startsWith('|1|')) return pattern.toLowerCase() === token
  const parts = pattern.split('|')
  const salt = parts[2]
  const digest = parts[3]
  if (salt === undefined || digest === undefined) return false
  return createHmac('sha1', Buffer.from(salt, 'base64')).update(token).digest('base64') === digest
}

/**
 * `SHA256:<base64>` fingerprint of a base64 key blob, spelled as ssh prints it.
 * @param blob - the base64 key blob of a `known_hosts` line or a scan result.
 * @returns the fingerprint without base64 padding.
 */
export function fingerprint(blob: string): string {
  return `SHA256:${createHash('sha256').update(Buffer.from(blob, 'base64')).digest('base64').replace(/=+$/u, '')}`
}

/**
 * The `known_hosts` files this deployment reads, in ssh's own order.
 * @param options - the host's own `options` map.
 * @param home - home directory for `~` expansion.
 * @returns the files to read, empty when the host sets `UserKnownHostsFile none`.
 */
export function knownHostsFiles(options: Record<string, string> | undefined, home: string): string[] {
  const configured = optionValue(options, 'userknownhostsfile')?.trim()
  if (configured !== undefined && configured !== '') {
    const first = configured.split(/\s+/u)[0] ?? ''
    if (first === '' || first.toLowerCase() === 'none') return []
    return [expandHome(first, home)]
  }
  return [path.join(home, '.ssh', 'known_hosts'), path.join(home, '.ssh', 'known_hosts2')]
}

/**
 * Check, and when the host key changed heal, the recorded entry of one host.
 *
 * Never throws: every outcome is a status the caller reports.
 * @param host - the saved host about to be connected to.
 * @param options - home directory and the scan deadline.
 * @returns what the check found and, for `changed`, what it removed.
 */
export async function checkHostKey(host: Host, options: HostKeyCheckOptions): Promise<HostKeyReport> {
  if (host.auth.kind === 'alias') {
    return { status: 'skipped', reason: 'the real hostname and port come from ~/.ssh/config' }
  }
  if (host.jump !== undefined) {
    return { status: 'skipped', reason: 'the destination is reached through a jump host' }
  }
  const name = host.host
  if (name === undefined || name === '') return { status: 'skipped', reason: 'the host has no address' }
  if (optionValue(host.options, 'stricthostkeychecking')?.trim().toLowerCase() === 'no') {
    return { status: 'skipped', reason: 'StrictHostKeyChecking=no — ssh already accepts a changed key' }
  }

  const port = host.port ?? 22
  const tokens = hostTokens(name, port)
  const dest = tokens[0] ?? name

  const bodies = new Map<string, string>()
  const matched = new Map<string, KnownHostLine[]>()
  for (const file of knownHostsFiles(host.options, options.home)) {
    let body: string
    try {
      body = await readFile(file, 'utf8')
    } catch {
      continue
    }
    bodies.set(file, body)
    const lines = parseKnownHosts(body).filter(entry => entry.marker === undefined
      && entry.hosts.some(pattern => tokens.some(token => patternMatches(pattern, token))))
    if (lines.length > 0) matched.set(file, lines)
  }
  // Nothing recorded: there is nothing to heal, and no reason to contact the host.
  if (matched.size === 0) return { status: 'no-entry', dest }

  const live = await scanHostKeys(name, port, options.timeoutMs)
  if (live === undefined) return { status: 'unreachable', dest }

  const stored = [...matched.values()].flat()
  const stale = stored.filter((entry) => {
    const served = live[entry.keyType]
    return served !== undefined && served !== entry.blob
  })
  if (stale.length === 0) return { status: 'ok', dest }

  // Every line for this destination goes, like `ssh-keygen -R`: a rebuilt host
  // changes all of its key types, and a partially healed block only moves the
  // same failure to the next one.
  let removed = 0
  let file: string | undefined
  for (const [candidate, lines] of matched) {
    const body = bodies.get(candidate)
    if (body === undefined) continue
    await removeLines(candidate, body, new Set(lines.map(entry => entry.line)))
    removed += lines.length
    file ??= candidate
  }
  return {
    status: 'changed',
    dest,
    ...(file === undefined ? {} : { file }),
    removed,
    stored: [...new Set(stored.map(entry => fingerprint(entry.blob)))],
    live: [...new Set(Object.values(live).map(blob => fingerprint(blob)))],
  }
}

/** One `options` value by ssh keyword, compared case-insensitively as ssh does. */
function optionValue(options: Record<string, string> | undefined, keyword: string): string | undefined {
  if (options === undefined) return undefined
  for (const [key, value] of Object.entries(options)) if (key.toLowerCase() === keyword) return value
  return undefined
}

/**
 * Ask the host for its public keys.
 * @param host - the address to scan.
 * @param port - the port to scan.
 * @param timeoutMs - the deadline, applied per connection by `-T` plus a hard kill.
 * @returns algorithm → base64 blob, or `undefined` when the host could not be asked.
 */
async function scanHostKeys(host: string, port: number, timeoutMs: number): Promise<Record<string, string> | undefined> {
  const seconds = Math.max(1, Math.ceil(timeoutMs / 1000))
  const args = ['-p', String(port), '-T', String(seconds), '-t', SCAN_TYPES, '--', host]
  const stdout = await new Promise<string | undefined>((resolve) => {
    execFile('ssh-keyscan', args, { timeout: timeoutMs + 2000, maxBuffer: 1024 * 1024 }, (error, out) => {
      resolve(error !== null && (out === '' || out === undefined) ? undefined : out)
    })
  })
  if (stdout === undefined) return undefined
  const keys: Record<string, string> = {}
  for (const line of stdout.split('\n')) {
    const fields = line.trim().split(/\s+/u)
    const keyType = fields[1]
    const blob = fields[2]
    if (keyType !== undefined && blob !== undefined && /^[A-Za-z0-9+/]+={0,2}$/u.test(blob)) keys[keyType] = blob
  }
  return Object.keys(keys).length === 0 ? undefined : keys
}

/**
 * Delete the given 1-based lines, keeping a `<file>.old` copy as
 * `ssh-keygen -R` does, and replacing the file atomically.
 * @param file - the `known_hosts` file to rewrite.
 * @param body - its current text.
 * @param lines - the 1-based line numbers to drop.
 */
async function removeLines(file: string, body: string, lines: ReadonlySet<number>): Promise<void> {
  const kept = body.split('\n').filter((_, index) => !lines.has(index + 1)).join('\n')
  const info = await stat(file)
  const mode = info.mode & 0o777
  await writeFile(`${file}.old`, body, { mode })
  const temporary = `${file}.dsh-ssh-hosts.tmp`
  await writeFile(temporary, kept, { mode })
  await rename(temporary, file)
}
