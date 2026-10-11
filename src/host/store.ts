/**
 * Hosts file store: read, revision, and atomic write.
 *
 * The file is the only authority. Nothing is cached: every call re-reads the
 * bytes, so a `git pull` or a hand edit is seen on the next `list`. A write
 * carries the revision (sha256 of the bytes) the caller read; a mismatch is a
 * conflict, never an overwrite. The plugin never runs git.
 */
import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname } from 'node:path'

import { parse, stringify } from 'yaml'

import { expandHome, parseDoc } from '../model.ts'
import type { FieldError, Group, Host, HostsDoc } from '../types.ts'

const HEADER = '# Managed by dsh-ssh-hosts. Hand edits are fine; comments are not preserved.\n'

/** Result of reading the file. */
export interface StoreRead {
  readonly path: string
  readonly exists: boolean
  readonly revision: string
  readonly doc: HostsDoc | null
  readonly parseError?: string
}

/** A write refused because the file changed since the caller read it. */
export class RevisionConflictError extends Error {
  readonly revision: string

  /** @param revision - the revision currently on disk. */
  constructor(revision: string) {
    super('hosts file changed on disk')
    this.revision = revision
  }
}

/** @param bytes - file bytes. @returns the revision string. */
export function revisionOf(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Whether an error is a missing-file error. */
function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT'
}

/** Format structural errors for the banner. */
function describe(errors: readonly FieldError[]): string {
  return errors.slice(0, 5).map(e => `${e.path}: ${e.message}`).join('; ')
}

/** Order a host's keys stably so git diffs stay minimal. */
function orderedHost(host: Host): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const put = (key: string, value: unknown): void => {
    if (value === undefined) return
    if (Array.isArray(value) && value.length === 0) return
    out[key] = value
  }
  put('id', host.id)
  put('name', host.name)
  put('group', host.group)
  put('tags', host.tags)
  put('color', host.color)
  put('favorite', host.favorite === true ? true : undefined)
  put('host', host.host)
  put('port', host.port)
  put('user', host.user)
  const auth: Record<string, unknown> = { kind: host.auth.kind }
  for (const key of ['identityFile', 'certificateFile', 'agentSocket', 'alias'] as const) {
    if (host.auth[key] !== undefined) auth[key] = host.auth[key]
  }
  put('auth', auth)
  if (host.jump !== undefined) put('jump', host.jump.host !== undefined ? { host: host.jump.host } : { spec: host.jump.spec })
  put('forwards', host.forwards?.map(f => (f.target === undefined
    ? { kind: f.kind, bind: f.bind }
    : { kind: f.kind, bind: f.bind, target: f.target })))
  put('options', host.options !== undefined && Object.keys(host.options).length > 0 ? host.options : undefined)
  put('remoteCommand', host.remoteCommand ?? undefined)
  put('notes', host.notes)
  return out
}

/** Order a group's keys. */
function orderedGroup(group: Group): Record<string, unknown> {
  return group.color === undefined ? { id: group.id, name: group.name } : { id: group.id, name: group.name, color: group.color }
}

/**
 * Serialise a document with stable ordering and the managed header.
 * @param doc - the document.
 * @returns the YAML text.
 */
export function serialize(doc: HostsDoc): string {
  const body = stringify({ version: 1, groups: doc.groups.map(orderedGroup), hosts: doc.hosts.map(orderedHost) }, { lineWidth: 0 })
  return HEADER + body
}

/** File-backed hosts store. */
export class HostsStore {
  private chain: Promise<unknown> = Promise.resolve()
  private readonly configuredPath: string
  private readonly home: string

  /**
   * @param configuredPath - the configured `hostsFile`, possibly `~/`-relative.
   * @param home - the home directory for `~` expansion.
   */
  constructor(configuredPath: string, home: string = homedir()) {
    this.configuredPath = configuredPath
    this.home = home
  }

  /** The resolved absolute path. */
  get path(): string { return expandHome(this.configuredPath, this.home) }

  /** Read and parse the file; never throws for a missing or invalid file. */
  async read(): Promise<StoreRead> {
    let bytes: Buffer
    try {
      bytes = await readFile(this.path)
    } catch (error) {
      if (isMissing(error)) return { path: this.path, exists: false, revision: revisionOf(new Uint8Array()), doc: { version: 1, groups: [], hosts: [] } }
      return { path: this.path, exists: true, revision: 'unreadable', doc: null, parseError: error instanceof Error ? error.message : String(error) }
    }
    const revision = revisionOf(bytes)
    let raw: unknown
    try {
      raw = parse(bytes.toString('utf8'))
    } catch (error) {
      return { path: this.path, exists: true, revision, doc: null, parseError: error instanceof Error ? error.message : String(error) }
    }
    // An empty file parses to null: treat it as an empty inventory.
    const parsed = parseDoc(raw ?? { version: 1 })
    if (parsed.doc === null) return { path: this.path, exists: true, revision, doc: null, parseError: describe(parsed.errors) }
    return { path: this.path, exists: true, revision, doc: parsed.doc }
  }

  /**
   * Write the document if the file is still at `expectedRevision`.
   * @param doc - the validated document.
   * @param expectedRevision - the revision the caller read.
   * @returns the new revision.
   * @throws {RevisionConflictError} when the file changed.
   */
  write(doc: HostsDoc, expectedRevision: string): Promise<string> {
    const run = async (): Promise<string> => {
      const current = await this.read()
      if (current.doc === null) throw new Error(`the hosts file cannot be parsed, so it is not overwritten: ${current.parseError ?? ''}`)
      if (current.revision !== expectedRevision) throw new RevisionConflictError(current.revision)
      const bytes = Buffer.from(serialize(doc), 'utf8')
      await mkdir(dirname(this.path), { recursive: true })
      const temp = `${this.path}.${randomBytes(6).toString('hex')}.tmp`
      await writeFile(temp, bytes, { mode: 0o644 })
      await rename(temp, this.path)
      return revisionOf(bytes)
    }
    const next = this.chain.then(run, run)
    this.chain = next.catch(() => undefined)
    return next
  }
}
