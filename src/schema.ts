/**
 * Host-only configuration schema.
 *
 * Kept apart from `./config.ts` so the browser bundle never pulls schemastery.
 */
import z from '@deepseek-ai/schemastery'

import { DEFAULT_HEAL_CHANGED_HOST_KEY, DEFAULT_HOSTS_FILE, DEFAULT_PROBE_CONCURRENCY, DEFAULT_PROBE_TIMEOUT_MS } from './config.ts'

/** Host configuration, as the Loader resolves it. */
export interface Config {
  /** Path of the hosts YAML file; `~/` expands to the process home. */
  hostsFile: string
  /** TCP probe deadline per host, in milliseconds; also the pre-flight host-key scan deadline. */
  probeTimeoutMs: number
  /** Maximum simultaneous TCP probes. */
  probeConcurrency: number
  /**
   * Connect deletes a `known_hosts` entry whose key the host no longer serves,
   * after proving the difference with one `ssh-keyscan`. Off means Connect
   * behaves exactly as before and ssh reports the failure itself.
   */
  healChangedHostKey: boolean
}

/** Plugin configuration. */
export const Config: z<Config> = z.object({
  hostsFile: z.string().default(DEFAULT_HOSTS_FILE),
  probeTimeoutMs: z.number().step(1).min(100).max(60_000).default(DEFAULT_PROBE_TIMEOUT_MS),
  probeConcurrency: z.number().step(1).min(1).max(64).default(DEFAULT_PROBE_CONCURRENCY),
  healChangedHostKey: z.boolean().default(DEFAULT_HEAL_CHANGED_HOST_KEY),
})
