/**
 * Per-machine diagnostics, computed on every `list` and never persisted.
 *
 * Reads files only: `stat` of key paths and a text scan of `~/.ssh/config`
 * `Host` lines plus one level of `Include` globs. `Match` blocks are never
 * evaluated and no process is ever spawned (`ssh -G` would run `Match exec`).
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { expandHome } from '../model.ts'
import type { Host, HostDiagnostics } from '../types.ts'

/** Whether a path exists and its `mode & 0o077`. */
async function modeOf(path: string): Promise<{ exists: boolean; open: boolean }> {
  try {
    const info = await stat(path)
    return { exists: true, open: (info.mode & 0o077) !== 0 }
  } catch {
    return { exists: false, open: false }
  }
}

/** Escape a glob segment into a regex. */
function globToRegex(glob: string): RegExp {
  const body = glob.replace(/[.+^${}()|[\]\\]/gu, '\\$&').replace(/\*/gu, '.*').replace(/\?/gu, '.')
  return new RegExp(`^${body}$`, 'u')
}

/** Read the `Host` patterns of one ssh config file, plus its `Include` operands. */
async function scanFile(path: string): Promise<{ aliases: string[]; includes: string[] }> {
  let text: string
  try { text = await readFile(path, 'utf8') } catch { return { aliases: [], includes: [] } }
  const aliases: string[] = []
  const includes: string[] = []
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    const match = /^(Host|Include)\s*[=\s]\s*(.+)$/iu.exec(line)
    if (match === null) continue
    const words = (match[2] ?? '').split(/\s+/u).filter(w => w !== '')
    if (/^host$/iu.test(match[1] ?? '')) aliases.push(...words.filter(w => !/[*?!]/u.test(w)))
    else includes.push(...words)
  }
  return { aliases, includes }
}

/** Resolve one `Include` operand (relative to `~/.ssh`) into existing files; globs only in the file name. */
async function resolveInclude(operand: string, sshDir: string, home: string): Promise<string[]> {
  const expanded = expandHome(operand, home)
  const absolute = expanded.startsWith('/') ? expanded : resolve(sshDir, expanded)
  const dir = dirname(absolute)
  const base = absolute.slice(dir.length + 1)
  if (!/[*?]/u.test(base)) return [absolute]
  try {
    const names = await readdir(dir)
    const re = globToRegex(base)
    return names.filter(n => re.test(n)).sort().map(n => join(dir, n))
  } catch {
    return []
  }
}

/**
 * Collect the plain `Host` aliases of `~/.ssh/config` and one level of includes.
 * @param home - the home directory.
 * @returns the alias set.
 */
export async function scanAliases(home: string = homedir()): Promise<Set<string>> {
  const sshDir = join(home, '.ssh')
  const root = await scanFile(join(sshDir, 'config'))
  const all = new Set(root.aliases)
  for (const operand of root.includes) {
    for (const file of await resolveInclude(operand, sshDir, home)) {
      for (const alias of (await scanFile(file)).aliases) all.add(alias)
    }
  }
  return all
}

/**
 * Compute diagnostics for every host.
 * @param hosts - the saved hosts.
 * @param home - the home directory.
 * @returns diagnostics keyed by host id.
 */
export async function diagnose(hosts: readonly Host[], home: string = homedir()): Promise<Record<string, HostDiagnostics>> {
  const needsAliases = hosts.some(h => h.auth.kind === 'alias')
  const aliases = needsAliases ? await scanAliases(home) : new Set<string>()
  const out: Record<string, HostDiagnostics> = {}
  for (const host of hosts) {
    const d: HostDiagnostics = {}
    const { auth } = host
    if ((auth.kind === 'key' || auth.kind === 'certificate') && auth.identityFile !== undefined) {
      const info = await modeOf(expandHome(auth.identityFile, home))
      d.key = !info.exists ? 'missing' : info.open ? 'too-open' : 'ok'
    }
    if (auth.kind === 'certificate' && auth.certificateFile !== undefined) {
      d.certificate = (await modeOf(expandHome(auth.certificateFile, home))).exists ? 'ok' : 'missing'
    }
    if (auth.kind === 'alias' && auth.alias !== undefined) d.alias = aliases.has(auth.alias) ? 'ok' : 'not-found'
    if (auth.kind === 'identity-agent' && auth.agentSocket?.startsWith('/') === true) d.machineSpecificSocket = true
    if (host.jump?.host !== undefined && !hosts.some(h => h.id === host.jump?.host)) d.jumpMissing = true
    if (Object.keys(d).length > 0) out[host.id] = d
  }
  return out
}
