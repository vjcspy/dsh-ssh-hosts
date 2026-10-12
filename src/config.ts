/**
 * Constants and the route table shared by the Host half and the browser half.
 *
 * Deliberately dependency-free: the browser bundle imports this module, so
 * anything added here ships to the page. The Host-only schema lives in
 * `./schema.ts`, and the Host-only validators in `./model.ts`.
 */

/** Package id: the loader registration id, the tab kind's implementation id, and the body's slot key. */
export const PLUGIN_ID = 'dsh-ssh-hosts'

/** Right-sidebar tab kind this plugin owns. */
export const TAB_KIND = 'dsh-ssh-hosts'

/** Guide-page entry identity contributed by the tab kind. */
export const GUIDE_ENTRY_ID = 'dsh-ssh-hosts'

/** Ascending position of the guide entry among every registered type's entries. */
export const GUIDE_ENTRY_ORDER = 45

/** Locale namespace owning every product-visible string this plugin renders. */
export const LOCALE_NAMESPACE = 'dshSshHosts'

/** Route prefix below `/api`; every path this plugin registers sits under it. */
export const API_PREFIX = '/api/dsh-ssh-hosts'

/** Bundle-default hosts file; a deployment overrides it in its own profile patch. */
export const DEFAULT_HOSTS_FILE = '~/.config/dsh-ssh-hosts/hosts.yaml'

/** Default TCP probe deadline in milliseconds; also the pre-flight `ssh-keyscan` deadline. */
export const DEFAULT_PROBE_TIMEOUT_MS = 2000

/** Default number of concurrent TCP probes. */
export const DEFAULT_PROBE_CONCURRENCY = 8

/** Default for the Connect pre-flight: remove a `known_hosts` entry whose key the host no longer serves. */
export const DEFAULT_HEAL_CHANGED_HOST_KEY = true

/** Client list poll interval while the tab is visible, in milliseconds. */
export const LIST_POLL_MS = 5000

/** Client probe interval while the tab is visible, in milliseconds. */
export const PROBE_POLL_MS = 60_000

/** Terminal id prefix for every terminal this plugin creates. */
export const TERMINAL_ID_PREFIX = 'ssh-'

/** `localStorage` key holding the per-machine recent-connections list. */
export const RECENT_STORAGE_KEY = 'dsh-ssh-hosts.recent.v1'

/** `localStorage` key holding the collapsed-group state. */
export const COLLAPSED_STORAGE_KEY = 'dsh-ssh-hosts.collapsed.v1'

/** Named palette colours a host or group may carry. */
export const PALETTE = ['violet', 'teal', 'blue', 'green', 'amber', 'red', 'pink', 'slate', 'orange', 'cyan'] as const

/** One named palette colour. */
export type PaletteColor = (typeof PALETTE)[number]

/** One route this plugin registers. */
export interface RouteSpec {
  /** Route key used by the client. */
  readonly key: 'list' | 'save' | 'preview' | 'launch' | 'probe' | 'identities'
  /** Path below the API prefix. */
  readonly path: string
  /** The one HTTP method the handler serves; the other channel verb answers 405. */
  readonly method: 'GET' | 'POST'
}

/** The route table. */
export const ROUTES: readonly RouteSpec[] = [
  { key: 'list', path: `${API_PREFIX}/hosts/list`, method: 'GET' },
  { key: 'save', path: `${API_PREFIX}/hosts/save`, method: 'POST' },
  { key: 'preview', path: `${API_PREFIX}/hosts/preview`, method: 'POST' },
  { key: 'launch', path: `${API_PREFIX}/hosts/launch`, method: 'POST' },
  { key: 'probe', path: `${API_PREFIX}/hosts/probe`, method: 'POST' },
  { key: 'identities', path: `${API_PREFIX}/ssh/identities`, method: 'GET' },
]

/** HTTP methods the shared `/api` channel can dispatch to an exact Fetch route. */
export const CHANNEL_METHODS = ['GET', 'POST'] as const
