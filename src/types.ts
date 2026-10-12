/**
 * Shared wire and file types: plain interfaces, no runtime, no dependencies.
 *
 * The browser imports these as types only. The runtime validators that enforce
 * them live in `./model.ts` and never reach the page bundle.
 */
import type { PaletteColor } from './config.ts'

/** Credential kinds. Nothing secret is ever stored for any of them. */
export type AuthKind = 'agent' | 'key' | 'certificate' | 'identity-agent' | 'alias' | 'password'

/** How a host authenticates; fields are references, never secrets. */
export interface Auth {
  kind: AuthKind
  /** `~/`-relative private key path (kinds `key`, `certificate`). */
  identityFile?: string | undefined
  /** `~/`-relative certificate path (kind `certificate`). */
  certificateFile?: string | undefined
  /** `~/`-relative or absolute agent socket (kind `identity-agent`). */
  agentSocket?: string | undefined
  /** `~/.ssh/config` host alias (kind `alias`). */
  alias?: string | undefined
}

/** A jump host: another saved host, or a free-text `-J` spec. */
export interface Jump {
  host?: string | undefined
  spec?: string | undefined
}

/** One port forward. */
export interface Forward {
  kind: 'local' | 'remote' | 'dynamic'
  bind: string
  target?: string | undefined
}

/** One saved host. */
export interface Host {
  id: string
  name: string
  group?: string | undefined
  tags?: string[] | undefined
  color?: PaletteColor | undefined
  favorite?: boolean | undefined
  host?: string | undefined
  port?: number | undefined
  user?: string | undefined
  auth: Auth
  jump?: Jump | undefined
  forwards?: Forward[] | undefined
  options?: Record<string, string> | undefined
  remoteCommand?: string | null | undefined
  notes?: string | undefined
}

/** One host group. */
export interface Group {
  id: string
  name: string
  color?: PaletteColor | undefined
}

/** The `hosts.yaml` document, version 1. */
export interface HostsDoc {
  version: 1
  groups: Group[]
  hosts: Host[]
}

/** One field-level validation error. */
export interface FieldError {
  /** Dotted path, e.g. `auth.identityFile` or `options.ProxyCommand`. */
  path: string
  message: string
}

/** Per-machine diagnostics for one host; computed per call, never persisted. */
export interface HostDiagnostics {
  key?: 'ok' | 'missing' | 'too-open'
  certificate?: 'ok' | 'missing'
  alias?: 'ok' | 'not-found'
  /** An absolute agent socket path is machine-specific. */
  machineSpecificSocket?: boolean
  /** A saved jump host that no longer exists. */
  jumpMissing?: boolean
}

/**
 * How the pre-flight host-key check ended.
 *
 * `disabled` — the caller did not ask for it, or the deployment turned it off.
 * `skipped` — the destination cannot be checked this way (alias, jump host,
 * `StrictHostKeyChecking=no`); `reason` says which.
 * `no-entry` — nothing is recorded for the destination, so there is nothing to
 * heal and no scan was run.
 * `ok` — the recorded key is the key the host serves.
 * `unreachable` — the host could not be asked; nothing was touched.
 * `changed` — the recorded key is stale and its lines were removed.
 */
export type HostKeyStatus = 'disabled' | 'skipped' | 'no-entry' | 'ok' | 'unreachable' | 'changed'

/** Result of the pre-flight host-key check that `hosts/launch` runs when asked to heal. */
export interface HostKeyReport {
  status: HostKeyStatus
  /** `host`, or `[host]:port` off 22 — the token `known_hosts` keys the entry by. */
  dest?: string | undefined
  /** The `known_hosts` file the stale lines were removed from. */
  file?: string | undefined
  /** How many `known_hosts` lines were removed. */
  removed?: number | undefined
  /** `SHA256:` fingerprints of the entries that were stored. */
  stored?: string[] | undefined
  /** `SHA256:` fingerprints of the keys the host serves now. */
  live?: string[] | undefined
  /** Why the check did not run. */
  reason?: string | undefined
}

/** Response of `hosts/list`. */
export interface ListResult {
  path: string
  exists: boolean
  revision: string
  doc: HostsDoc | null
  parseError?: string
  diagnostics: Record<string, HostDiagnostics>
}

/** TCP probe state of one host. */
export interface ProbeResult {
  id: string
  state: 'up' | 'down' | 'indirect' | 'unknown'
  ms?: number
}

/** Response of `hosts/launch`. */
export interface LaunchResult {
  line: string
  title: string
  /** Present when the caller asked for the pre-flight host-key check. */
  hostKey?: HostKeyReport | undefined
}

/** Response of `hosts/preview`. */
export interface PreviewResult {
  argv: string[] | null
  line: string | null
  errors: FieldError[]
}

/** Error envelope body. */
export interface ApiErrorBody {
  code: string
  message: string
  errors?: FieldError[]
  revision?: string
}
