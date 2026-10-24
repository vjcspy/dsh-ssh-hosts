/**
 * Browser half: register the SSH tab kind, its keyed body, its copy and its
 * stylesheet, and bind the impure edges (the core terminal, the Session terminal
 * inventory and the right sidebar) behind one face.
 *
 * Connect needs three services this plugin does not own: `remote.terminal`,
 * `webTerminals` and `sidebarRight`. They are read through one scoped
 * `ctx.inject`, so their absence only disables Connect: the tab, the editor and
 * the list still work. Every type below comes from the declaration-merged
 * `ClientContext`, so a Host-side change to those namespaces fails `tsc` instead
 * of surfacing at runtime (the `remote.follow` breakage of 2026-10-24).
 *
 * `keepMounted` is `true`: Connect focuses the new core terminal tab, which would
 * otherwise unmount this body mid-transaction and roll the terminal back before
 * its handover is proven. A hidden tab pauses its polling.
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
// Type-only: declares the generated `remote` namespace on the Client Context.
import type {} from '@deepseek-ai/dsh-api-gateway/client'
// Type-only: declares the generated `remote.terminal` namespace on the Client Context.
import type {} from '@deepseek-ai/dsh-api-terminal-controller/remote'
// Type-only: declares the `webTerminals` service and its Session terminal inventory.
import type {} from '@deepseek-ai/dsh-api-terminal-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WebTerminalId } from '@deepseek-ai/dsh-api-terminal-controller/types'

import { GUIDE_ENTRY_ID, GUIDE_ENTRY_ORDER, LOCALE_NAMESPACE, PLUGIN_ID, RECENT_STORAGE_KEY, TAB_KIND } from '../config.ts'
import { api } from './api.ts'
import { readStored, writeStored, randomToken } from './components/ui.ts'
import { connect, type ConnectOutcome, type TerminalPort } from './connect.ts'
import { en } from './locale.ts'
import { HostsBody, type HostsInjected } from './HostsBody.tsx'
import { installStyles } from './styles.ts'

export type { HostsInjected, HostsBodyProps } from './HostsBody.tsx'

/** Services this half always needs; all shell-provided. */
export const inject = ['slots', 'locale', 'sidebarRightTabs']

/** The generated terminal namespace, as the scoped Context exposes it. */
type TerminalRemote = ClientContext['remote']['terminal']

/** The Session terminal inventory service. */
type TerminalInventoryService = ClientContext['webTerminals']

/** The outward right-sidebar face. */
type SidebarRight = ClientContext['sidebarRight']

/**
 * The `openTabIn` call Connect needs, with the `terminal` kind's navigation parameters.
 *
 * That parameter map is declared by `@deepseek-ai/dsh-client-ui-sidebar-terminal`, but the
 * package's published `/client` declaration never references its own `face.d.ts`, so the
 * augmentation never reaches this program and `SidebarRightTabParamsFor<'terminal'>` degrades
 * to `undefined`. This signature restates only the one call shape used here; the method is
 * still read off the real service, so renaming it still fails the type check.
 */
interface TerminalTabOpener {
  (sessionId: SessionId, kind: 'terminal', options: { readonly params: { readonly terminalId: WebTerminalId } }): void
}

/** The `terminal` tab kind's navigation parameters, as that kind declares them. */
type TerminalTabParams = { readonly terminalId: WebTerminalId } | { readonly shellPath: string } | undefined

/** One `RemoteResult`-shaped value, as far as this half reads it. */
interface ResultLike<T> { readonly ok: boolean; readonly value?: T; readonly error?: unknown }

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
function portOf(remote: TerminalRemote): TerminalPort {
  return {
    create: async (sid, request, signal) => valueOf(await remote.create(
      sid as SessionId,
      { id: request.id as WebTerminalId, cols: request.cols, rows: request.rows },
      signal,
    )),
    // The duplex stream is already the port's attachment: downlink iterator plus uplink and dispose.
    attach: (sid, id, signal) => remote.attach(sid as SessionId, id as WebTerminalId, signal),
    rename: async (sid, id, title) => { valueOf(await remote.rename(sid as SessionId, id as WebTerminalId, title)) },
    close: async (sid, id) => {
      const result = await remote.close(sid as SessionId, id as WebTerminalId)
      // Already gone (the core close handler won the race): the goal is met.
      if (!result.ok && (result.error as { code?: string } | undefined)?.code === 'terminal/unavailable') return
      valueOf(result)
    },
  }
}

/**
 * Refresh the Session's cached terminal list so a core `terminal` tab can open this id.
 *
 * A core view opened with `params.terminalId` reads that cache without refreshing it, and
 * rejects an id it does not hold (`missingTerminal`), so it would never attach. `read(true)`
 * joins a load that is already in flight, which may predate `create`; one further pass is
 * then guaranteed fresh.
 * @param terminals - the Session terminal inventory service.
 * @param sessionId - the Session that will host the tab.
 * @param terminalId - the terminal identity Connect allocated.
 * @returns whether the identity is now listed.
 */
async function syncInventory(terminals: TerminalInventoryService, sessionId: string, terminalId: string): Promise<boolean> {
  const id = terminalId as WebTerminalId
  const listed = (infos: readonly { readonly id: WebTerminalId }[]): boolean => infos.some(info => info.id === id)
  if (listed(await terminals.recover(sessionId as SessionId, true))) return true
  return listed(await terminals.recover(sessionId as SessionId, true))
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
  let services: { remote: TerminalRemote; terminals: TerminalInventoryService; sidebar: SidebarRight } | undefined
  const listeners = new Set<() => void>()
  const setServices = (next: typeof services): void => {
    services = next
    for (const fn of listeners) fn()
  }
  // `remote` must be listed with `remote.terminal`: the dotted name alone never resolves (same pair the core terminal plugin declares).
  // The scoped fiber is owned by `ctx`: it unloads with the plugin and re-runs when any listed service changes.
  ctx.inject(['remote', 'remote.terminal', 'webTerminals', 'sidebarRight'], (inner) => {
    setServices({ remote: inner.remote.terminal, terminals: inner.webTerminals, sidebar: inner.sidebarRight })
    inner.effect(() => () => { setServices(undefined) }, 'dsh-ssh-hosts: terminal services')
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
        launch: (id, s) => api.launch(id, true, s),
        terminal: port,
        syncInventory: (sid, terminalId) => syncInventory(live.terminals, sid, terminalId),
        openTab: (sid, terminalId) => {
          const openTerminalTab = live.sidebar.openTabIn as unknown as TerminalTabOpener
          openTerminalTab(sid as SessionId, 'terminal', { params: { terminalId: terminalId as WebTerminalId } })
        },
        closeTab: (sid, terminalId) => {
          try {
            for (const tab of live.sidebar.tabsIn(sid as SessionId)) {
              if (tab.kind !== 'terminal') continue
              // The tab kind's parameter map is unreachable here (see `TerminalTabOpener`), so the
              // navigation parameters are read through the same restated union the core tab declares.
              const params = live.sidebar.tabDomain.occurrence(sid as SessionId, { id: tab.id })
                .navigation.getSnapshot().params as TerminalTabParams
              if (params !== undefined && 'terminalId' in params
                && params.terminalId === (terminalId as WebTerminalId)) live.sidebar.closeIn(sid as SessionId, tab.id)
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
