/**
 * One cancellable Connect transaction onto the core terminal.
 *
 * On `dsh-v0.2.1-rc.2` the core terminal Remote exposes one duplex stream,
 * `remote.terminal.attach(sessionId, id, signal)`: `TerminalFrame` values arrive
 * through its async iterator and `TerminalInput` values leave through `send()`.
 * Connect mirrors what a core terminal view does, then hands the process to the
 * core `terminal` tab and PROVES the handover before declaring success:
 *
 * 1. `create` allocates the Host terminal.
 * 2. `rename` runs before `attach`, so the first `snapshot` already carries the
 *    final title and no follower receives a `state` frame this module caused.
 * 3. `attach` takes input control and yields the first `snapshot`.
 * 4. one `write` input carries the `exec ssh ...` line; its `ack` proves the Host
 *    wrote it to the PTY, so releasing the attachment cannot drop it.
 * 5. `syncInventory` refreshes the Session's cached terminal list: a core view
 *    opened with `params.terminalId` rejects an id missing from that cache
 *    (`missingTerminal`) and would never attach.
 * 6. `openTab` opens the core `terminal` tab. Adoption is proven by a
 *    `state{ writable: false }` frame on this still-open attachment, which the
 *    Host broadcasts only when another attachment takes control of the input.
 *
 * A process that exits after the `ack` is not a failure: the tab is still opened
 * so it shows the ssh error and exit banner. A process that exits or refuses the
 * write before the `ack` is a failure and rolls back.
 *
 * Two lifetimes are kept apart. The OPERATION signal (`opSignal`) means "give up
 * and roll back". The ATTACHMENT controller is a child of it: operation abort
 * aborts the attachment, but the intentional release after the proven handover
 * ends only that child. `assertLive()` runs after every awaited stage and before
 * every side effect that cannot be undone, so no continuation after an abort can
 * open a tab, disarm rollback or record recency.
 *
 * This module imports no React, no DOM and no host service: everything impure
 * arrives through {@link ConnectDeps}, so a script can drive it with stubs.
 */
import { TERMINAL_ID_PREFIX } from '../config.ts'
import type { HostKeyReport, LaunchResult } from '../types.ts'

/** Host terminal state, as far as this module reads it. */
export type TerminalStateValue = 'running' | 'exited' | 'failed'

/** A frame of the terminal attach stream, as far as this module reads it. */
export type FrameLike =
  | { readonly type: 'snapshot'; readonly screen: string; readonly info: { readonly state: TerminalStateValue }; readonly writable: boolean }
  | { readonly type: 'output'; readonly data?: string | undefined }
  | { readonly type: 'state'; readonly info: { readonly state: TerminalStateValue }; readonly writable: boolean }
  | { readonly type: 'ack'; readonly sequence: number; readonly refusal?: 'read-only' | 'not-running' | undefined }

/** The one command this transaction sends: the validated ssh line, first in sequence. */
export interface TerminalWriteInput {
  readonly type: 'write'
  readonly sequence: number
  readonly data: string
}

/** One open attach stream: the downlink iterator plus its uplink and cancellation. */
export interface TerminalAttachment extends AsyncIterable<FrameLike> {
  send(input: TerminalWriteInput): void
  dispose(): void
}

/** The terminal operations this transaction uses. Ids are plain strings here. */
export interface TerminalPort {
  create(sessionId: string, request: { id: string; cols: number; rows: number }, signal: AbortSignal): Promise<unknown>
  attach(sessionId: string, id: string, signal: AbortSignal): TerminalAttachment
  rename(sessionId: string, id: string, title: string): Promise<void>
  close(sessionId: string, id: string): Promise<void>
}

/** Everything impure the transaction needs. */
export interface ConnectDeps {
  /** `POST hosts/launch`, asking the Host half for the pre-flight host-key check. */
  launch(hostId: string, signal: AbortSignal): Promise<LaunchResult>
  readonly terminal: TerminalPort
  /**
   * Refresh the Session's cached terminal list so a core `terminal` tab can open
   * this id; `true` when the id is listed, `false` when it is still missing.
   */
  syncInventory(sessionId: string, terminalId: string): Promise<boolean>
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
  /** Longest wait for the first prompt before writing anyway; fails when no snapshot arrived at all. */
  readonly readyMs: number
  /** Longest wait for the Host to acknowledge the ssh line. */
  readonly ackMs: number
  /** Adoption proof deadline after `openTabIn`. */
  readonly adoptMs: number
  /** Rollback `close` deadline. */
  readonly closeMs: number
}

const DEFAULT_TIMINGS: ConnectTimings = { readyMs: 3000, ackMs: 5000, adoptMs: 5000, closeMs: 5000 }

/** How a transaction ended. */
export type ConnectOutcome =
  | {
    readonly status: 'connected'
    readonly terminalId: string
    /** Present when the pre-flight check healed a changed host key. */
    readonly hostKey?: HostKeyReport | undefined
  }
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
  let attachHandle: TerminalAttachment | undefined
  let loop: Promise<void> | undefined
  let released = false

  /** End the attachment on purpose, then wait for its consumer loop to settle. */
  const releaseFollower = async (): Promise<void> => {
    released = true
    followCtl?.abort()
    attachHandle?.dispose()
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
    terminalId = id
    // Armed as soon as `create` is issued: a create that resolves after an abort is still closed.
    armed = true
    await deps.terminal.create(sessionId, { id, cols: 80, rows: 24 }, opSignal)
    assertLive()

    // Before attach: no follower exists, so this cannot emit a `state` frame, and both the
    // first snapshot and the inventory refresh below already carry the final title.
    await deps.terminal.rename(sessionId, id, launch.title)
    assertLive()

    const follow = new AbortController()
    followCtl = follow
    opSignal.addEventListener('abort', () => { follow.abort() }, { once: true })
    const attachment = deps.terminal.attach(sessionId, id, follow.signal)
    attachHandle = attachment

    let sawSnapshot = false
    let sawOutput = false
    let screenReady = false
    let acked = false
    let adopted = false
    let lastState: TerminalStateValue = 'running'
    let followError: unknown
    const waiters = new Set<() => void>()
    const notify = (): void => {
      const pending = [...waiters]
      waiters.clear()
      for (const wake of pending) wake()
    }
    const waitChange = (): Promise<void> => new Promise<void>((resolve) => { waiters.add(resolve) })
    /** Wait for a stage predicate, waking early on any recorded failure or abort. */
    const waitFor = async (predicate: () => boolean, ms: number): Promise<void> => {
      if (predicate() || followError !== undefined) return
      const guard = new AbortController()
      const onAbort = (): void => { guard.abort(); notify() }
      opSignal.addEventListener('abort', onAbort, { once: true })
      const timer = deps.sleep(ms, guard.signal)
      timer.catch(() => undefined)
      // On the deadline the wait must end, not re-arm: abort the guard, then wake the loop.
      void timer.then(() => { guard.abort(); notify() }, () => { notify() })
      try {
        while (!predicate() && followError === undefined && !guard.signal.aborted) await waitChange()
      } finally {
        guard.abort()
        opSignal.removeEventListener('abort', onAbort)
        waiters.clear()
      }
    }

    loop = (async () => {
      try {
        for await (const frame of attachment) {
          if (frame.type === 'snapshot') {
            lastState = frame.info.state
            if (!frame.writable || frame.info.state !== 'running') {
              if (followError === undefined) followError = new Error('terminal is not writable')
            } else {
              sawSnapshot = true
              screenReady = hasPrintable(frame.screen)
            }
          } else if (frame.type === 'output') {
            sawOutput = true
          } else if (frame.type === 'ack') {
            if (frame.refusal !== undefined) {
              if (followError === undefined) followError = new Error(`terminal write refused (${frame.refusal})`)
            } else if (frame.sequence === 1) {
              acked = true
            }
          } else {
            const previous = lastState
            lastState = frame.info.state
            if (previous === 'running' && frame.info.state !== 'running') {
              // The single running -> exited|failed transition of this process.
              if (!acked && followError === undefined) {
                followError = new Error(`terminal ${frame.info.state} before the write settled`)
              }
            } else if (sawSnapshot && !frame.writable) {
              // Only another attachment taking control broadcasts this with the process alive.
              if (tabOpened) adopted = true
              else if (followError === undefined) followError = new Error('terminal control was lost before the tab opened')
            }
          }
          notify()
        }
        if (!follow.signal.aborted && !released && followError === undefined) {
          followError = new Error('terminal attachment ended')
        }
      } catch (error) {
        if (!follow.signal.aborted && !released && followError === undefined) followError = error
      } finally {
        notify()
      }
    })()

    // The first prompt: the snapshot plus the first output (or an already-drawn screen), at most `readyMs`.
    await waitFor(() => sawSnapshot && (sawOutput || screenReady), timings.readyMs)
    assertLive()
    if (followError !== undefined) throw followError
    if (!sawSnapshot) throw new Error('terminal did not send the initial screen in time')

    attachment.send({ type: 'write', sequence: 1, data: launch.line })
    await waitFor(() => acked, timings.ackMs)
    assertLive()
    if (followError !== undefined) throw followError
    if (!acked) throw new Error('the terminal did not acknowledge the ssh command in time')

    assertLive()
    if (!await deps.syncInventory(sessionId, id)) throw new Error('the terminal was not listed in the Session inventory')
    assertLive()

    tabOpened = true
    deps.openTab(sessionId, id)

    await waitFor(() => adopted, timings.adoptMs)
    assertLive()
    if (followError !== undefined) throw followError
    if (!adopted) throw new Error('the terminal tab did not attach in time')

    await releaseFollower()
    assertLive()
    armed = false
    deps.recordRecent(hostId, deps.now())
    return {
      status: 'connected',
      terminalId: id,
      ...(launch.hostKey === undefined ? {} : { hostKey: launch.hostKey }),
    }
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
