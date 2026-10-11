/**
 * Browser half: register the SSH tab kind, its keyed body, its copy and its
 * stylesheet, and bind the one impure edge (the core terminal) behind a face.
 *
 * Connect needs two services this plugin does not own, `remote.terminal` and
 * `sidebarRight`. They are read through a scoped `ctx.inject` so their absence
 * only disables Connect: the tab, the editor and the list still work.
 *
 * `keepMounted` is `true`: Connect focuses the new core terminal tab, which would
 * otherwise unmount this body mid-transaction and roll the terminal back before
 * its adoption is proven. A hidden tab pauses its polling.
 *
 * @module dsh-ssh-hosts/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: declares the `locale` member this half reads.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: declares the `slots` member this half registers into.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: declares the `sidebarRightTabs` and `sidebarRight` members.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
// Type-only: declares the `sessionId` session seat.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: declares the generated `remote.terminal` namespace.
import type {} from '@deepseek-ai/dsh-api-terminal-controller/client'

import { GUIDE_ENTRY_ID, GUIDE_ENTRY_ORDER, LOCALE_NAMESPACE, PLUGIN_ID, RECENT_STORAGE_KEY, TAB_KIND } from '../config.ts'
import { api } from './api.ts'
import { readStored, writeStored, randomToken } from './components/ui.ts'
import { connect, type ConnectOutcome, type FrameLike, type TerminalInfoLike, type TerminalPort } from './connect.ts'
import { en } from './locale.ts'
import { HostsBody, type HostsInjected } from './HostsBody.tsx'
import { installStyles } from './styles.ts'

export type { HostsInjected, HostsBodyProps } from './HostsBody.tsx'

/** Services this half always needs; all shell-provided. */
export const inject = ['slots', 'locale', 'sidebarRightTabs']

/** One `RemoteResult`-shaped value, as far as this half reads it. */
interface ResultLike<T> { readonly ok: boolean; readonly value?: T; readonly error?: unknown }

/** The slice of the generated terminal namespace this half calls; ids stay plain strings. */
interface RemoteTerminalLike {
  create(sid: string, request: { id: string; cols: number; rows: number }, signal: AbortSignal): Promise<ResultLike<unknown>>
  follow(sid: string, id: string, attachmentId: string, signal: AbortSignal): AsyncIterable<FrameLike>
  write(sid: string, id: string, attachmentId: string, data: string): Promise<ResultLike<unknown>>
  rename(sid: string, id: string, title: string): Promise<ResultLike<unknown>>
  list(sid: string): Promise<ResultLike<readonly TerminalInfoLike[]>>
  close(sid: string, id: string): Promise<ResultLike<unknown>>
}

/** The slice of the sidebar service this half calls. */
interface SidebarLike {
  openTabIn(sessionId: string, kind: string, options: { params: { terminalId: string } }): void
  closeIn(sessionId: string, tabId: string): void
  tabsIn(sessionId: string): readonly { id: string; kind: string }[]
  readonly tabDomain: { occurrence(sessionId: string, tab: { id: string }): { navigation: { getSnapshot(): { params?: { terminalId?: string } | undefined } } } }
  readonly mounted: { getSnapshot(): string | undefined; subscribe(fn: () => void): () => void }
}

/** Unwrap a `RemoteResult`, throwing its error. */
function valueOf<T>(result: ResultLike<T>): T {
  if (!result.ok) throw result.error instanceof Error ? result.error : new Error(String(result.error))
  return result.value as T
}

/** An abortable timer that rejects with the signal's reason. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return }
    const timer = window.setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve() }, ms)
    const onAbort = (): void => { window.clearTimeout(timer); reject(signal.reason) }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/** Adapt the generated namespace to the transaction's port. */
function portOf(remote: RemoteTerminalLike): TerminalPort {
  return {
    create: async (sid, request, signal) => valueOf(await remote.create(sid, request, signal)),
    follow: (sid, id, attachmentId, signal) => remote.follow(sid, id, attachmentId, signal),
    write: async (sid, id, attachmentId, data) => { valueOf(await remote.write(sid, id, attachmentId, data)) },
    rename: async (sid, id, title) => { valueOf(await remote.rename(sid, id, title)) },
    list: async sid => valueOf(await remote.list(sid)),
    close: async (sid, id) => {
      const result = await remote.close(sid, id)
      // Already gone (the core close handler won the race): the goal is met.
      if (!result.ok && (result.error as { code?: string } | undefined)?.code === 'terminal/unavailable') return
      valueOf(result)
    },
  }
}

/** Record a per-machine recent connection, newest first, capped at 20. */
function recordRecent(hostId: string, at: number): void {
  const current = readStored<{ id: string; at: number }[]>(RECENT_STORAGE_KEY, [])
  writeStored(RECENT_STORAGE_KEY, [{ id: hostId, at }, ...current.filter(r => r.id !== hostId)].slice(0, 20))
}

/**
 * Register the tab kind, its dictionary, its stylesheet and its body.
 * @param ctx - browser-side plugin context owning the registry and the seats.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(LOCALE_NAMESPACE)
  ctx.effect(() => ctx.locale.register(LOCALE_NAMESPACE, 'en', en), 'dsh-ssh-hosts: dictionaries')
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: PLUGIN_ID,
    kind: TAB_KIND,
    keepMounted: true,
    title: () => t('tab.title'),
    guide: [{
      id: GUIDE_ENTRY_ID,
      order: GUIDE_ENTRY_ORDER,
      title: () => t('guide.title'),
      description: () => t('guide.description'),
    }],
  }), 'dsh-ssh-hosts: tab kind')
  installStyles(ctx)

  // Optional services: absent means Connect is disabled, nothing else.
  let services: { remote: RemoteTerminalLike; sidebar: SidebarLike } | undefined
  const listeners = new Set<() => void>()
  const setServices = (next: typeof services): void => {
    services = next
    for (const fn of listeners) fn()
  }
  // `remote` must be listed with `remote.terminal`: the dotted name alone never resolves (same pair the core terminal plugin declares).
  // The scoped fiber is owned by `ctx`: it unloads with the plugin and re-runs when either service changes.
  const bind = ctx as unknown as { inject: (names: string[], cb: (c: unknown) => void) => unknown }
  bind.inject(['remote', 'remote.terminal', 'sidebarRight'], (inner) => {
    const c = inner as ClientContext & { remote: { terminal: RemoteTerminalLike }; sidebarRight: SidebarLike }
    setServices({ remote: c.remote.terminal, sidebar: c.sidebarRight })
    c.effect(() => () => { setServices(undefined) }, 'dsh-ssh-hosts: terminal services')
  })

  const available = {
    getSnapshot: (): boolean => services !== undefined,
    subscribe: (fn: () => void): (() => void) => { listeners.add(fn); return () => { listeners.delete(fn) } },
  }

  const face: HostsInjected = {
    available,
    get mounted() { return services?.sidebar.mounted },
    get connect() {
      const live = services
      if (live === undefined) return undefined
      const port = portOf(live.remote)
      return (sessionId: string, hostId: string, signal: AbortSignal): Promise<ConnectOutcome> => connect({
        launch: (id, s) => api.launch(id, s),
        terminal: port,
        openTab: (sid, terminalId) => { live.sidebar.openTabIn(sid, 'terminal', { params: { terminalId } }) },
        closeTab: (sid, terminalId) => {
          try {
            for (const tab of live.sidebar.tabsIn(sid)) {
              if (tab.kind !== 'terminal') continue
              if (live.sidebar.tabDomain.occurrence(sid, { id: tab.id }).navigation.getSnapshot().params?.terminalId === terminalId) live.sidebar.closeIn(sid, tab.id)
            }
          } catch { /* best effort */ }
        },
        sleep,
        now: () => Date.now(),
        recordRecent,
        newId: () => randomToken(12),
      }, sessionId, hostId, signal)
    },
    recordRecent,
  }

  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: PLUGIN_ID,
    locale: LOCALE_NAMESPACE,
    inject: () => ({ face: () => face }),
  }, HostsBody)), 'dsh-ssh-hosts: tab body')
}
