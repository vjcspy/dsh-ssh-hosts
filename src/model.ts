/**
 * Host-only data model: the zod shape of `hosts.yaml` v1 and the one shared
 * validator that save, preview and launch all run.
 *
 * Two parsers sit between a field and the connection: the user's interactive
 * shell, which reads the typed line, and `ssh`, which re-parses every
 * `-o Key=Value` as a config line. Strict fields therefore admit only narrow
 * charsets, and the trusted-advanced fields (`options` values, `remoteCommand`)
 * forbid exactly the characters that could escape the single-quote wrapping or
 * the ssh-level double quotes.
 *
 * The browser never imports this module at run time; it imports `./types.ts`.
 */
import { z } from 'zod'

import { PALETTE } from './config.ts'
import type { FieldError, Forward, Group, Host, HostsDoc, Jump } from './types.ts'

export type {
  ApiErrorBody, Auth, AuthKind, FieldError, Forward, Group, Host, HostDiagnostics, HostsDoc, Jump,
  LaunchResult, ListResult, PreviewResult, ProbeResult,
} from './types.ts'

/** Control characters, including NUL, newline and DEL. */
const CONTROL = /[\x00-\x1f\x7f]/u

const HOST_NAME = /^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/u
const IPV6 = /^[0-9A-Fa-f:.]+$/u
const USER = /^[A-Za-z0-9._][A-Za-z0-9._-]{0,63}$/u
const ALIAS = /^[A-Za-z0-9._][A-Za-z0-9._-]{0,127}$/u
const ID = /^[a-z0-9][a-z0-9_-]{1,39}$/u
const FORWARD_PART = /^[A-Za-z0-9.:[\]_-]+$/u
const JUMP_SPEC = /^[A-Za-z0-9._@:,-]+$/u
const OPTION_KEY = /^[A-Za-z0-9]{2,64}$/u
/** Charset for every field that ends up inside a saved jump host's `ProxyCommand`. */
const PROXY_SAFE = /^[A-Za-z0-9._/@:+-]+$/u
/** Path charset: no quote, backslash, double quote, `%` (an ssh token prefix), shell metacharacter, whitespace or control char. */
const SAFE_PATH = /^[^'\\"%\s;$`|&<>(){}*?!#\x00-\x1f\x7f]+$/u
/** Socket path charset: as {@link SAFE_PATH} but a plain space is allowed. */
const SOCKET_PATH = /^[^'\\"%;$`|&<>(){}*?!#\x00-\x1f\x7f]+$/u

/** ssh option keys (lowercased) that run local code, load a library or name a program. */
const CODE_RUNNING_KEYS = [
  'proxycommand', 'proxyjump', 'localcommand', 'permitlocalcommand', 'knownhostscommand',
  'pkcs11provider', 'securitykeyprovider', 'xauthlocation', 'match', 'include',
]
/** ssh option keys (lowercased) owned by a structured field. */
const STRUCTURED_KEYS = [
  'identityfile', 'certificatefile', 'identityagent', 'identitiesonly', 'port', 'user', 'hostname', 'remotecommand',
]
/** The full lowercased deny-list. */
export const OPTION_DENY_LIST: ReadonlySet<string> = new Set([...CODE_RUNNING_KEYS, ...STRUCTURED_KEYS])

/**
 * Expand a leading `~/` with the given home directory.
 * @param path - a path that may start with `~/`.
 * @param home - the home directory to expand with.
 * @returns the expanded path.
 */
export function expandHome(path: string, home: string): string {
  if (path === '~') return home
  return path.startsWith('~/') ? `${home.replace(/\/$/u, '')}/${path.slice(2)}` : path
}

const optional = <T extends z.ZodType>(schema: T) => schema.nullish()

const authSchema = z.object({
  kind: z.enum(['agent', 'key', 'certificate', 'identity-agent', 'alias', 'password']),
  identityFile: optional(z.string()),
  certificateFile: optional(z.string()),
  agentSocket: optional(z.string()),
  alias: optional(z.string()),
}).strict()

const forwardSchema = z.object({
  kind: z.enum(['local', 'remote', 'dynamic']),
  bind: z.string(),
  target: optional(z.string()),
}).strict()

const jumpSchema = z.object({ host: optional(z.string()), spec: optional(z.string()) }).strict()

const hostSchema = z.object({
  id: z.string(),
  name: z.string(),
  group: optional(z.string()),
  tags: optional(z.array(z.string())),
  color: optional(z.string()),
  favorite: optional(z.boolean()),
  host: optional(z.string()),
  port: optional(z.number()),
  user: optional(z.string()),
  auth: authSchema,
  jump: optional(jumpSchema),
  forwards: optional(z.array(forwardSchema)),
  options: optional(z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]))),
  remoteCommand: optional(z.string()),
  notes: optional(z.string()),
}).strict()

const groupSchema = z.object({ id: z.string(), name: z.string(), color: optional(z.string()) }).strict()

/** The structural shape of `hosts.yaml` v1. */
export const docSchema = z.object({
  version: z.literal(1),
  groups: optional(z.array(groupSchema)),
  hosts: optional(z.array(hostSchema)),
}).strict()

/** Drop `null`/`undefined` members so the normalised object matches the exact optional types. */
function compact<T extends object>(value: T): T {
  const out: Record<string, unknown> = {}
  for (const [key, member] of Object.entries(value)) if (member !== null && member !== undefined) out[key] = member
  return out as T
}

/**
 * Structurally parse and normalise a raw document: nulls dropped, option values
 * stringified, the name trimmed. Semantic rules are {@link validateDocument}'s job.
 * @param raw - the parsed YAML (or request) value.
 * @returns the normalised document, or the structural errors.
 */
export function parseDoc(raw: unknown): { doc: HostsDoc | null; errors: FieldError[] } {
  const parsed = docSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      doc: null,
      errors: parsed.error.issues.map(issue => ({ path: issue.path.map(String).join('.') || '(root)', message: issue.message })),
    }
  }
  const data = parsed.data
  const hosts: Host[] = (data.hosts ?? []).map((h) => {
    const options = h.options === undefined || h.options === null
      ? undefined
      : Object.fromEntries(Object.entries(h.options).map(([k, v]) => [k, String(v)]))
    return compact({
      ...h,
      name: h.name.trim(),
      auth: compact(h.auth),
      jump: h.jump === null || h.jump === undefined ? undefined : compact(h.jump),
      forwards: h.forwards === null || h.forwards === undefined ? undefined : h.forwards.map(compact),
      options,
      // `remoteCommand: null` in YAML means none; keep it explicit-absent.
      remoteCommand: h.remoteCommand ?? undefined,
    }) as unknown as Host
  })
  const groups: Group[] = (data.groups ?? []).map(g => compact(g) as unknown as Group)
  return { doc: { version: 1, groups, hosts }, errors: [] }
}

/** Context one host validation runs in. */
export interface ValidationContext {
  /** Every saved host, for jump references. */
  readonly hosts: readonly Host[]
  /** Every saved group id. */
  readonly groups: readonly Group[]
  /** The home directory, for `~` expansion of jump-host fields. */
  readonly home: string
}

function err(path: string, message: string): FieldError { return { path, message } }

function checkPath(errors: FieldError[], path: string, value: string | undefined, kind: 'relative' | 'socket'): void {
  if (value === undefined || value === '') { errors.push(err(path, 'required')); return }
  if (kind === 'relative') {
    if (!value.startsWith('~/')) {
      errors.push(err(path, value.startsWith('/')
        ? `absolute paths are not portable between machines; write it as ~/… (for example ~/.ssh/${value.split('/').pop() ?? 'key'})`
        : 'must start with ~/'))
      return
    }
    if (!SAFE_PATH.test(value)) errors.push(err(path, "must not contain quotes, backslashes, '%', shell metacharacters (; $ ` | & < > ( ) { } * ? ! #), whitespace or control characters"))
    return
  }
  if (!value.startsWith('~/') && !value.startsWith('/')) { errors.push(err(path, 'must start with ~/ or /')); return }
  if (!SOCKET_PATH.test(value)) errors.push(err(path, "must not contain quotes, backslashes, '%', shell metacharacters (; $ ` | & < > ( ) { } * ? ! #) or control characters"))
}

function validateForward(errors: FieldError[], index: number, forward: Forward): void {
  const base = `forwards.${index}`
  const part = (path: string, value: string | undefined): void => {
    if (value === undefined || value === '') { errors.push(err(path, 'required')); return }
    if (value.startsWith('-') || !FORWARD_PART.test(value)) errors.push(err(path, 'invalid characters'))
  }
  part(`${base}.bind`, forward.bind)
  if (forward.kind === 'dynamic') {
    if (forward.target !== undefined) errors.push(err(`${base}.target`, 'a dynamic forward has no target'))
  } else part(`${base}.target`, forward.target)
}

/**
 * Fields of a saved jump host that enter the `ProxyCommand`, after `~` expansion.
 * @param jump - the saved jump host.
 * @param home - the home directory.
 * @returns the offending field names.
 */
export function proxyUnsafeFields(jump: Host, home: string): string[] {
  const bad: string[] = []
  const check = (name: string, value: string | undefined): void => {
    if (value !== undefined && !PROXY_SAFE.test(expandHome(value, home))) bad.push(name)
  }
  if (jump.auth.kind === 'alias') check('alias', jump.auth.alias)
  else {
    check('host', jump.host)
    check('user', jump.user)
    if (jump.port !== undefined && !PROXY_SAFE.test(String(jump.port))) bad.push('port')
    check('identityFile', jump.auth.identityFile)
    check('certificateFile', jump.auth.certificateFile)
    check('agentSocket', jump.auth.agentSocket)
  }
  return bad
}

function validateJump(errors: FieldError[], host: Host, jump: Jump, context: ValidationContext): void {
  if ((jump.host === undefined) === (jump.spec === undefined)) {
    errors.push(err('jump', 'set exactly one of a saved host or a free-text spec'))
    return
  }
  if (jump.spec !== undefined) {
    if (jump.spec.startsWith('-') || !JUMP_SPEC.test(jump.spec)) errors.push(err('jump.spec', 'invalid characters'))
    return
  }
  const target = context.hosts.find(h => h.id === jump.host)
  if (target === undefined) { errors.push(err('jump.host', 'the saved jump host no longer exists')); return }
  if (target.id === host.id) { errors.push(err('jump.host', 'a host cannot jump through itself')); return }
  if (target.jump !== undefined) {
    errors.push(err('jump.host', 'chains through more than one saved host are not supported; use a free-text spec'))
    return
  }
  const bad = proxyUnsafeFields(target, context.home)
  if (bad.length > 0) {
    errors.push(err('jump.host',
      `the saved jump host has characters in ${bad.join(', ')} that cannot be passed through a ProxyCommand; use a free-text jump spec plus ~/.ssh/config`))
  }
}

/**
 * Validate one host against every field rule. The one shared validator: save,
 * preview and launch all call it.
 * @param host - the host to check.
 * @param context - the inventory the host sits in.
 * @returns every violation; empty when the host is safe to build.
 */
export function validateHost(host: Host, context: ValidationContext): FieldError[] {
  const errors: FieldError[] = []
  if (!ID.test(host.id)) errors.push(err('id', 'must match [a-z0-9][a-z0-9_-]{1,39}'))
  const name = host.name.trim()
  if (name.length < 1 || name.length > 120) errors.push(err('name', 'must be 1-120 characters'))
  else if (CONTROL.test(name)) errors.push(err('name', 'must not contain control characters'))
  if (host.group !== undefined && !context.groups.some(g => g.id === host.group)) errors.push(err('group', 'unknown group'))
  if (host.color !== undefined && !(PALETTE as readonly string[]).includes(host.color)) errors.push(err('color', 'not a palette colour'))
  for (const [i, tag] of (host.tags ?? []).entries()) {
    if (tag.length < 1 || tag.length > 40 || CONTROL.test(tag)) errors.push(err(`tags.${i}`, 'must be 1-40 characters without control characters'))
  }

  const isAlias = host.auth.kind === 'alias'
  if (host.host !== undefined && host.host !== '') {
    const okHost = HOST_NAME.test(host.host) || (host.host.includes(':') && IPV6.test(host.host))
    if (!okHost || host.host.startsWith('-')) errors.push(err('host', 'invalid host name or address'))
  } else if (!isAlias) errors.push(err('host', 'required'))
  if (host.user !== undefined && host.user !== '') {
    if (!USER.test(host.user)) errors.push(err('user', 'invalid user name'))
  } else if (!isAlias) errors.push(err('user', 'required'))
  if (host.port !== undefined && (!Number.isInteger(host.port) || host.port < 1 || host.port > 65535)) errors.push(err('port', 'must be 1-65535'))

  switch (host.auth.kind) {
    case 'key':
      checkPath(errors, 'auth.identityFile', host.auth.identityFile, 'relative')
      break
    case 'certificate':
      checkPath(errors, 'auth.identityFile', host.auth.identityFile, 'relative')
      checkPath(errors, 'auth.certificateFile', host.auth.certificateFile, 'relative')
      break
    case 'identity-agent':
      checkPath(errors, 'auth.agentSocket', host.auth.agentSocket, 'socket')
      break
    case 'alias':
      if (host.auth.alias === undefined || host.auth.alias === '') errors.push(err('auth.alias', 'required'))
      else if (host.auth.alias.startsWith('-') || !ALIAS.test(host.auth.alias)) errors.push(err('auth.alias', 'invalid alias'))
      break
    default:
      break
  }

  if (host.jump !== undefined) validateJump(errors, host, host.jump, context)
  for (const [i, forward] of (host.forwards ?? []).entries()) validateForward(errors, i, forward)

  const seen = new Map<string, string>()
  for (const [key, value] of Object.entries(host.options ?? {})) {
    const path = `options.${key}`
    if (!OPTION_KEY.test(key)) { errors.push(err(path, 'invalid option name')); continue }
    const canonical = key.toLowerCase()
    if (OPTION_DENY_LIST.has(canonical)) {
      errors.push(err(path, CODE_RUNNING_KEYS.includes(canonical)
        ? 'this option can run local code and is not allowed'
        : 'this option is set through a dedicated field'))
      continue
    }
    const previous = seen.get(canonical)
    if (previous !== undefined) { errors.push(err(path, `duplicates ${previous} (option names are case-insensitive)`)); continue }
    seen.set(canonical, key)
    if (value === '') errors.push(err(path, 'must not be empty'))
    else if (/['\\"]/u.test(value) || CONTROL.test(value)) errors.push(err(path, "value must not contain quotes, backslashes or control characters"))
  }

  if (host.remoteCommand !== undefined && host.remoteCommand !== null) {
    if (host.remoteCommand === '') errors.push(err('remoteCommand', 'must not be empty'))
    else if (/['\\]/u.test(host.remoteCommand) || CONTROL.test(host.remoteCommand)) {
      errors.push(err('remoteCommand', "must not contain single quotes, backslashes or control characters"))
    }
  }
  return errors
}

/**
 * Validate a whole document: ids, group references, and every host.
 * @param doc - the normalised document.
 * @param home - the home directory for `~` expansion.
 * @returns every violation with `hosts.<i>.` / `groups.<i>.` path prefixes.
 */
export function validateDocument(doc: HostsDoc, home: string): FieldError[] {
  const errors: FieldError[] = []
  const groupIds = new Set<string>()
  for (const [i, group] of doc.groups.entries()) {
    if (!ID.test(group.id)) errors.push(err(`groups.${i}.id`, 'must match [a-z0-9][a-z0-9_-]{1,39}'))
    if (groupIds.has(group.id)) errors.push(err(`groups.${i}.id`, 'duplicate group id'))
    groupIds.add(group.id)
    const name = group.name.trim()
    if (name.length < 1 || name.length > 120 || CONTROL.test(name)) errors.push(err(`groups.${i}.name`, 'must be 1-120 characters without control characters'))
    if (group.color !== undefined && !(PALETTE as readonly string[]).includes(group.color)) errors.push(err(`groups.${i}.color`, 'not a palette colour'))
  }
  const ids = new Set<string>()
  const context: ValidationContext = { hosts: doc.hosts, groups: doc.groups, home }
  for (const [i, host] of doc.hosts.entries()) {
    if (ids.has(host.id)) errors.push(err(`hosts.${i}.id`, 'duplicate host id'))
    ids.add(host.id)
    for (const e of validateHost(host, context)) errors.push(err(`hosts.${i}.${e.path}`, e.message))
  }
  return errors
}
