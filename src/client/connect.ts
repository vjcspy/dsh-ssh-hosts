/**
 * One cancellable Connect transaction onto the core terminal.
 *
 * The sequence mirrors the core `TerminalView` (`create` -> `follow` -> `write`
 * -> `rename`), then hands the process to the core `terminal` tab by adopting
 * its id, and PROVES the adoption before declaring success:
 * `openTabIn` returns void and silently does nothing once a Session's sidebar
 * adoption is released, so returning is not evidence. The host sets
 * `controllerId` only when an attachment's `follow` runs, so a listed terminal
 * whose `controllerId` is defined and is not this transaction's own attachment
 * means a core view attached.
 *
 * Two lifetimes are kept apart. The OPERATION signal (`opSignal`) means "give up
 * and roll back". The FOLLOWER controller is a child of it: operation abort
 * aborts the follower, but the intentional release in step 7 aborts only the
 * follower. `assertLive()` runs after every awaited stage and before every
 * side effect that cannot be undone, so no continuation after an abort can open
 * a tab, disarm rollback or record recency.
 *
 * This module imports no React, no DOM and no host service: everything impure
 * arrives through {@link ConnectDeps}, so a script can drive it with stubs.
 */
import { TERMINAL_ID_PREFIX } from '../config.ts'

/** A frame of the terminal follow stream, as far as this module reads it. */
export interface FrameLike {
  readonly type: string
  readonly screen?: string
}

/** A listed terminal, as far as this module reads it. */
export interface TerminalInfoLike {
  readonly id: string
  readonly controllerId?: string | undefined
}

/** The terminal operations this transaction uses. Ids are plain strings here. */
export interface TerminalPort {
  create(sessionId: string, request: { id: string; cols: number; rows: number }, signal: AbortSignal): Promise<unknown>
  follow(sessionId: string, id: string, attachmentId: string, signal: AbortSignal): AsyncIterable<FrameLike>
  write(sessionId: string, id: string, attachmentId: string, data: string): Promise<void>
  rename(sessionId: string, id: string, title: string): Promise<void>
  list(sessionId: string): Promise<readonly TerminalInfoLike[]>
  close(sessionId: string, id: string): Promise<void>
}

/** Everything impure the transaction needs. */
export interface ConnectDeps {
  /** `POST hosts/launch`. */
  launch(hostId: string, signal: AbortSignal): Promise<{ line: string; title: string }>
  readonly terminal: TerminalPort
  /** `sidebarRight.openTabIn(sessionId, 'terminal', { params: { terminalId } })`; returns void and may silently do nothing. */
  openTab(sessionId: string, terminalId: string): void
  /** Close the core `terminal` tab bound to `terminalId`, if one exists; used only by rollback. Must not throw. */
  closeTab(sessionId: string, terminalId: string): void
  /** An abortable timer: resolves after `ms`, rejects with the signal's reason on abort. */
  sleep(ms: number, signal: AbortSignal): Promise<void>
  now(): number
  /** Record a per-machine recent connection. */
  recordRecent(hostId: string, at: number): void
  /** A fresh unique token matching `[\w-]{1,100}`. */
  newId(): string
  readonly timings?: Partial<ConnectTimings>
}

/** Timing knobs, in milliseconds. */
export interface ConnectTimings {
  /** Longest wait for the first prompt before writing anyway. */
  readonly readyMs: number
  /** Adoption proof deadline after `openTabIn`. */
  readonly adoptMs: number
  /** Adoption poll interval. */
  readonly pollMs: number
  /** Rollback `close` deadline. */
  readonly closeMs: number
}

const DEFAULT_TIMINGS: ConnectTimings = { readyMs: 3000, adoptMs: 5000, pollMs: 250, closeMs: 5000 }

/** How a transaction ended. */
export type ConnectOutcome =
  | { readonly status: 'connected'; readonly terminalId: string }
  | { readonly status: 'aborted'; readonly terminalId?: string; readonly cleanupError?: string }
  | { readonly status: 'failed'; readonly message: string; readonly terminalId?: string; readonly cleanupError?: string }

/** Whether a screen string shows any printable character, ignoring escape sequences. */
function hasPrintable(screen: string | undefined): boolean {
  if (screen === undefined) return false
  // eslint-disable-next-line no-control-regex
  return screen.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/gu, '').replace(/\u001b[()][0-9A-Za-z]/gu, '').trim() !== ''
}

/** Message of an unknown error. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Run one Connect.
 * @param deps - impure edges.
 * @param sessionId - the Session whose terminal list and sidebar receive the tab.
 * @param hostId - the saved host to connect to.
 * @param opSignal - the operation lifetime; aborting it rolls back.
 * @returns how the transaction ended; never rejects.
 */
export async function connect(
  deps: ConnectDeps,
  sessionId: string,
  hostId: string,
  opSignal: AbortSignal,
): Promise<ConnectOutcome> {
  const timings: ConnectTimings = { ...DEFAULT_TIMINGS, ...deps.timings }
  const assertLive = (): void => { opSignal.throwIfAborted() }

  let terminalId: string | undefined
  let armed = false
  let tabOpened = false
  let followCtl: AbortController | undefined
  let loop: Promise<void> | undefined

  /** Abort `followCtl` and wait for its consumer loop to end. */
  const releaseFollower = async (): Promise<void> => {
    followCtl?.abort()
    await loop
  }

  /** Rollback in a lifetime `opSignal` cannot cancel. @returns an error message when cleanup failed. */
  const rollback = async (): Promise<string | undefined> => {
    if (terminalId === undefined) return undefined
    const id = terminalId
    // A tab opened before the abort would otherwise be left pointing at a closed terminal.
    if (tabOpened) {
      try { deps.closeTab(sessionId, id) } catch { /* best effort: the terminal close below still runs */ }
    }
    try {
      await releaseFollower()
      const guard = new AbortController()
      const timeout = deps.sleep(timings.closeMs, guard.signal).then(() => { throw new Error('close timed out') })
      timeout.catch(() => undefined)
      try {
        await Promise.race([deps.terminal.close(sessionId, id), timeout])
      } finally {
        guard.abort()
      }
      return undefined
    } catch (error) {
      return `cleanup failed — terminal ${id} may remain (${messageOf(error)})`
    }
  }

  try {
    const launch = await deps.launch(hostId, opSignal)
    assertLive()

    const id = `${TERMINAL_ID_PREFIX}${deps.newId()}`
    const attachmentId = deps.newId()
    terminalId = id
    // Armed as soon as `create` is issued: a create that resolves after an abort is still closed.
    armed = true
    await deps.terminal.create(sessionId, { id, cols: 80, rows: 24 }, opSignal)
    assertLive()

    const follow = new AbortController()
    followCtl = follow
    opSignal.addEventListener('abort', () => { follow.abort() }, { once: true })
    let followError: unknown
    let sawSnapshot = false
    let sawOutput = false
    let screenReady = false
    let wake: (() => void) | undefined
    const ready = new Promise<void>((resolveReady) => { wake = resolveReady })
    loop = (async () => {
      try {
        for await (const frame of deps.terminal.follow(sessionId, id, attachmentId, follow.signal)) {
          if (frame.type === 'snapshot') { sawSnapshot = true; screenReady = hasPrintable(frame.screen) }
          else if (frame.type === 'output') sawOutput = true
          if (sawSnapshot && (sawOutput || screenReady)) wake?.()
        }
      } catch (error) {
        if (!follow.signal.aborted) { followError = error; wake?.() }
      }
    })()

    // The first prompt: the snapshot plus the first output (or an already-drawn screen), at most `readyMs`.
    const waitCtl = new AbortController()
    opSignal.addEventListener('abort', () => { waitCtl.abort() }, { once: true })
    const timer = deps.sleep(timings.readyMs, waitCtl.signal)
    timer.catch(() => undefined)
    try {
      await Promise.race([ready, timer])
    } finally {
      waitCtl.abort()
    }
    assertLive()
    if (followError !== undefined) throw followError

    await deps.terminal.write(sessionId, id, attachmentId, launch.line)
    assertLive()
    await deps.terminal.rename(sessionId, id, launch.title)
    assertLive()

    // Intentional release: only the follower ends; the operation goes on.
    follow.abort()
    await loop
    assertLive()

    tabOpened = true
    deps.openTab(sessionId, id)

    const deadline = deps.now() + timings.adoptMs
    for (;;) {
      assertLive()
      const listed = await deps.terminal.list(sessionId)
      assertLive()
      const info = listed.find(item => item.id === id)
      if (info?.controllerId !== undefined && info.controllerId !== attachmentId) break
      if (deps.now() >= deadline) throw new Error('the terminal tab did not attach in time')
      await deps.sleep(timings.pollMs, opSignal)
    }

    assertLive()
    armed = false
    deps.recordRecent(hostId, deps.now())
    return { status: 'connected', terminalId: id }
  } catch (error) {
    const aborted = opSignal.aborted
    const cleanupError = armed ? await rollback() : undefined
    const extra = {
      ...terminalId === undefined ? {} : { terminalId },
      ...cleanupError === undefined ? {} : { cleanupError },
    }
    if (aborted) return { status: 'aborted', ...extra }
    return { status: 'failed', message: messageOf(error), ...extra }
  }
}
