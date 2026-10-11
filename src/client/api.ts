/**
 * Same-origin transport to the fenced routes.
 *
 * The browser cookie rides along on a same-origin `fetch`; the shared `/api`
 * channel runs admission before any route lookup. Every method returns the
 * unwrapped `data` or throws an {@link ApiError}.
 */
import { ROUTES, type RouteSpec } from '../config.ts'
import type { ApiErrorBody, FieldError, Host, HostsDoc, LaunchResult, ListResult, PreviewResult, ProbeResult } from '../types.ts'

/** A route failure with its status and server-side detail. */
export class ApiError extends Error {
  readonly status: number
  readonly body: ApiErrorBody

  /**
   * @param status - HTTP status.
   * @param body - the server's error body, or a synthesized one.
   */
  constructor(status: number, body: ApiErrorBody) {
    super(body.message)
    this.status = status
    this.body = body
  }

  /** Field errors the server attached, if any. */
  get fieldErrors(): FieldError[] { return this.body.errors ?? [] }
}

/** Find a route by key. */
function route(key: RouteSpec['key']): RouteSpec {
  const found = ROUTES.find(r => r.key === key)
  if (found === undefined) throw new Error(`unknown route ${key}`)
  return found
}

/** Call one route. */
async function call<T>(key: RouteSpec['key'], body?: unknown, signal?: AbortSignal): Promise<T> {
  const spec = route(key)
  const init: RequestInit = { method: spec.method, headers: { accept: 'application/json' } }
  if (signal !== undefined) init.signal = signal
  if (spec.method === 'POST') {
    init.headers = { accept: 'application/json', 'content-type': 'application/json' }
    init.body = JSON.stringify(body ?? {})
  }
  const response = await fetch(spec.path, init)
  let parsed: { ok?: boolean; data?: T; error?: ApiErrorBody } | undefined
  try {
    parsed = await response.json() as typeof parsed
  } catch {
    parsed = undefined
  }
  if (!response.ok || parsed?.ok !== true) {
    throw new ApiError(response.status, parsed?.error ?? { code: 'http', message: `request failed (${response.status})` })
  }
  return parsed.data as T
}

/** The route client the body and the connect transaction share. */
export const api = {
  list: (signal?: AbortSignal): Promise<ListResult> => call('list', undefined, signal),
  save: (doc: HostsDoc, revision: string): Promise<{ revision: string }> => call('save', { doc, revision }),
  preview: (draft: Host, revision: string, signal?: AbortSignal): Promise<PreviewResult> => call('preview', { draft, revision }, signal),
  launch: (id: string, signal?: AbortSignal): Promise<LaunchResult> => call('launch', { id }, signal),
  probe: (ids: string[], signal?: AbortSignal): Promise<ProbeResult[]> => call('probe', { ids }, signal),
  identities: (): Promise<string[]> => call('identities'),
}
