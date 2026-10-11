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
