/**
 * TCP reachability probe for direct hosts.
 *
 * Opens a socket and closes it; no process is spawned and no data is sent.
 * Hosts reached through a jump are `indirect`, alias hosts `unknown`.
 */
import { connect } from 'node:net'

import type { Host, ProbeResult } from '../types.ts'

/** @returns whether host:port accepted a TCP connection, and how long that took. */
function tcp(host: string, port: number, timeoutMs: number): Promise<{ up: boolean; ms: number }> {
  return new Promise((resolvePromise) => {
    const started = Date.now()
    const socket = connect({ host: host.startsWith('[') ? host.slice(1, -1) : host, port })
    let settled = false
    const done = (up: boolean): void => {
      if (settled) return
      settled = true
      socket.destroy()
      resolvePromise({ up, ms: Date.now() - started })
    }
    socket.setTimeout(timeoutMs, () => { done(false) })
    socket.once('connect', () => { done(true) })
    socket.once('error', () => { done(false) })
  })
}

/**
 * Probe the given hosts with bounded concurrency.
 * @param hosts - hosts to probe.
 * @param timeoutMs - per-probe deadline.
 * @param concurrency - maximum simultaneous probes.
 * @returns one result per host, in input order.
 */
export async function probeHosts(hosts: readonly Host[], timeoutMs: number, concurrency: number): Promise<ProbeResult[]> {
  const results: ProbeResult[] = new Array<ProbeResult>(hosts.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < hosts.length) {
      const index = next++
      const host = hosts[index]
      if (host === undefined) continue
      if (host.auth.kind === 'alias') { results[index] = { id: host.id, state: 'unknown' }; continue }
      if (host.jump !== undefined) { results[index] = { id: host.id, state: 'indirect' }; continue }
      if (host.host === undefined) { results[index] = { id: host.id, state: 'unknown' }; continue }
      const outcome = await tcp(host.host, host.port ?? 22, timeoutMs)
      results[index] = outcome.up ? { id: host.id, state: 'up', ms: outcome.ms } : { id: host.id, state: 'down' }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, hosts.length)) }, worker))
  return results
}
