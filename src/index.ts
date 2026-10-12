/**
 * Host half: load, validate and write the hosts YAML file, build the ssh
 * command line, and serve both to the browser half over the admission-fenced
 * `/api` channel.
 *
 * The plugin executes exactly one process of its own: `ssh-keyscan`, run by the
 * Connect pre-flight to prove that a recorded `known_hosts` entry is stale
 * (`./host/hostkey.ts`). It speaks the SSH handshake, authenticates nothing and
 * runs no local command; everything else here is a file read or a TCP probe.
 * The ssh connection itself is typed by the browser half into a core terminal.
 *
 * Deployment assumption: core picks the terminal's subprocess provider from the
 * Agent context. This plugin assumes a local provider; with a remote one the
 * `~/.ssh` paths would refer to the remote machine.
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: declares the `connection` member this module reads.
import type {} from '@deepseek-ai/dsh-client-connection'

import { PLUGIN_ID } from './config.ts'
import { registerRoutes } from './host/routes.ts'
import type { Config } from './schema.ts'

export { Config } from './schema.ts'

/** Cordis function-plugin name. */
export const name = PLUGIN_ID

/**
 * Services this plugin reads, and nothing else: a service named here that never
 * resolves leaves the plugin silently PENDING.
 */
export const inject = ['connection']

/**
 * Register the fenced routes.
 * @param ctx - Host context owning the `connection` service.
 * @param config - validated live configuration resolved by the Loader.
 */
export function apply(ctx: Context, config: Config): void {
  registerRoutes(ctx, {
    hostsFile: config.hostsFile,
    probeTimeoutMs: config.probeTimeoutMs,
    probeConcurrency: config.probeConcurrency,
    healChangedHostKey: config.healChangedHostKey,
  })
}
