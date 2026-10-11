/**
 * Pure ssh command builder.
 *
 * Two parsers read what this module produces: the user's interactive shell
 * (every argv element is single-quoted; the validators forbid `'` and `\`
 * everywhere a value reaches the line) and `ssh` itself, which re-parses every
 * `-o Key=Value` as a config line (a value containing whitespace is wrapped in
 * ssh-level double quotes; the validators forbid `"` in option values). A saved
 * jump host's `ProxyCommand` is parsed a third time by `sh -c` inside ssh, so
 * its fields were held to a strict charset by `validateHost`.
 *
 * `--` always precedes the destination so a destination can never be read as an
 * option. The builder never spawns a process.
 */
import { expandHome, validateHost } from '../model.ts'
import type { FieldError, Host } from '../types.ts'

/** A successfully built launch. */
export interface BuiltLaunch {
  readonly ok: true
  /** The ssh argv, `ssh` first. */
  readonly argv: string[]
  /** The line typed into the shell: leading space, `exec`, single-quoted argv, carriage return. */
  readonly line: string
  /** The terminal title. */
  readonly title: string
}

/** A refused launch. */
export interface RefusedLaunch {
  readonly ok: false
  readonly errors: FieldError[]
}

/** `Key=Value`, with the value wrapped in ssh-level double quotes when it holds whitespace. */
function optionArg(key: string, value: string): string {
  return /\s/u.test(value) ? `${key}="${value}"` : `${key}=${value}`
}

/** The authentication flags of one host (an `alias` host has none: the alias carries them). */
function authFlags(host: Host, home: string): string[] {
  const { auth } = host
  switch (auth.kind) {
    case 'key':
      return ['-i', expandHome(auth.identityFile ?? '', home), '-o', 'IdentitiesOnly=yes']
    case 'certificate':
      return [
        '-i', expandHome(auth.identityFile ?? '', home),
        '-o', optionArg('CertificateFile', expandHome(auth.certificateFile ?? '', home)),
        '-o', 'IdentitiesOnly=yes',
      ]
    case 'identity-agent':
      return ['-o', optionArg('IdentityAgent', expandHome(auth.agentSocket ?? '', home))]
    case 'password':
      return ['-o', 'PreferredAuthentications=keyboard-interactive,password', '-o', 'PubkeyAuthentication=no']
    default:
      return []
  }
}

/** `user@host`, or the alias. */
function destination(host: Host): string {
  return host.auth.kind === 'alias' ? host.auth.alias ?? '' : `${host.user ?? ''}@${host.host ?? ''}`
}

/** The `-p` flag for a non-default port of a non-alias host. */
function portFlags(host: Host): string[] {
  return host.auth.kind !== 'alias' && host.port !== undefined && host.port !== 22 ? ['-p', String(host.port)] : []
}

/** The `ProxyCommand` value for a saved jump host. */
function proxyCommand(jump: Host, home: string): string {
  return ['ssh', ...authFlags(jump, home), ...portFlags(jump), '-W', '%h:%p', '--', destination(jump)].join(' ')
}

/**
 * Build the ssh argv for a host, after validating it.
 * @param host - the host to connect to.
 * @param all - every saved host, for the jump reference.
 * @param groups - every saved group, for validation.
 * @param home - the home directory for `~` expansion.
 * @returns the argv, the shell line and the title, or the validation errors.
 */
export function buildLaunch(
  host: Host,
  all: readonly Host[],
  groups: readonly { id: string; name: string }[],
  home: string,
): BuiltLaunch | RefusedLaunch {
  const errors = validateHost(host, { hosts: all, groups, home })
  if (errors.length > 0) return { ok: false, errors }

  const argv: string[] = ['ssh']
  const remote = host.remoteCommand ?? undefined
  if (remote !== undefined) argv.push('-t')
  argv.push(...authFlags(host, home), ...portFlags(host))

  if (host.jump?.spec !== undefined) argv.push('-J', host.jump.spec)
  else if (host.jump?.host !== undefined) {
    const jump = all.find(h => h.id === host.jump?.host)
    if (jump !== undefined) argv.push('-o', `ProxyCommand=${proxyCommand(jump, home)}`)
  }

  for (const forward of host.forwards ?? []) {
    if (forward.kind === 'local') argv.push('-L', `${forward.bind}:${forward.target ?? ''}`)
    else if (forward.kind === 'remote') argv.push('-R', `${forward.bind}:${forward.target ?? ''}`)
    else argv.push('-D', forward.bind)
  }
  for (const [key, value] of Object.entries(host.options ?? {})) argv.push('-o', optionArg(key, value))

  argv.push('--', destination(host))
  if (remote !== undefined) argv.push(remote)

  const line = ` exec ${argv.map(a => `'${a}'`).join(' ')}\r`
  return { ok: true, argv, line, title: host.name.trim() }
}
