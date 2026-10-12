/**
 * Fenced `/api/dsh-ssh-hosts/*` routes.
 *
 * Registering through `ctx.connection.fetch.register` is what fences them: the
 * shared `/api` channel runs admission (`403` foreign `Host`, `401` without the
 * browser cookie) before any route lookup. Each route declares both channel
 * verbs, serves the one it intends, and answers the other with `405` plus
 * `Allow`; other verbs never reach a handler (the channel supports only GET,
 * HEAD and POST for exact routes).
 *
 * No route touches a terminal, and the only process any of them runs is the
 * Connect pre-flight's `ssh-keyscan` (`./hostkey.ts`) — opt-in per request,
 * never for a preview or a copy, and only ever deleting a `known_hosts` line.
 * The ssh line is built here, behind one validator, and the browser only types
 * what `launch` returned.
 */
import { homedir } from 'node:os'

import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection'

import { CHANNEL_METHODS, ROUTES, type RouteSpec } from '../config.ts'
import { parseDoc, validateDocument } from '../model.ts'
import type { ApiErrorBody, FieldError, Host, HostKeyReport, LaunchResult, ListResult, PreviewResult } from '../types.ts'
import { buildLaunch } from './command.ts'
import { diagnose } from './diagnostics.ts'
import { checkHostKey } from './hostkey.ts'
import { listIdentities } from './identities.ts'
import { probeHosts } from './probe.ts'
import { HostsStore, RevisionConflictError } from './store.ts'

/** Host-configurable facts the handlers need. */
export interface RouteOptions {
  readonly hostsFile: string
  readonly probeTimeoutMs: number
  readonly probeConcurrency: number
  /** Whether Connect may delete a stale `known_hosts` entry before it types the ssh line. */
  readonly healChangedHostKey: boolean
  /** Home directory; injectable for the artifact checks. */
  readonly home?: string
}

const MAX_BODY_BYTES = 1024 * 1024

/** A JSON success response. */
function ok(data: unknown, status = 200): Response {
  return Response.json({ ok: true, data }, { status, headers: { 'cache-control': 'no-store' } })
}

/** A JSON error response. */
function fail(status: number, error: ApiErrorBody, headers: Record<string, string> = {}): Response {
  return Response.json({ ok: false, error }, { status, headers: { 'cache-control': 'no-store', ...headers } })
}

/** Read a bounded JSON object body. */
async function jsonBody(request: Request): Promise<Record<string, unknown> | Response> {
  const text = await request.text()
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) return fail(413, { code: 'too-large', message: 'request body too large' })
  try {
    const parsed: unknown = JSON.parse(text === '' ? '{}' : text)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return fail(400, { code: 'bad-request', message: 'body must be a JSON object' })
    return parsed as Record<string, unknown>
  } catch {
    return fail(400, { code: 'bad-request', message: 'body is not valid JSON' })
  }
}

/**
 * Build the handlers of every route.
 * @param options - hosts file, probe settings and the host-key policy.
 * @returns a handler per route key.
 */
export function createHandlers(options: RouteOptions): Record<RouteSpec['key'], (request: Request) => Promise<Response>> {
  const home = options.home ?? homedir()
  const store = new HostsStore(options.hostsFile, home)

  const list = async (): Promise<Response> => {
    const read = await store.read()
    const diagnostics = read.doc === null ? {} : await diagnose(read.doc.hosts, home)
    const result: ListResult = {
      path: read.path, exists: read.exists, revision: read.revision, doc: read.doc, diagnostics,
      ...(read.parseError === undefined ? {} : { parseError: read.parseError }),
    }
    return ok(result)
  }

  const save = async (request: Request): Promise<Response> => {
    const body = await jsonBody(request)
    if (body instanceof Response) return body
    const revision = typeof body['revision'] === 'string' ? body['revision'] : undefined
    if (revision === undefined) return fail(400, { code: 'bad-request', message: 'revision is required' })
    const parsed = parseDoc(body['doc'])
    if (parsed.doc === null) return fail(422, { code: 'invalid', message: 'the document is malformed', errors: parsed.errors })
    const errors = validateDocument(parsed.doc, home)
    if (errors.length > 0) return fail(422, { code: 'invalid', message: 'the document has invalid fields', errors })
    try {
      return ok({ revision: await store.write(parsed.doc, revision) })
    } catch (error) {
      if (error instanceof RevisionConflictError) return fail(409, { code: 'conflict', message: error.message, revision: error.revision })
      return fail(500, { code: 'write-failed', message: error instanceof Error ? error.message : String(error) })
    }
  }

  const preview = async (request: Request): Promise<Response> => {
    const body = await jsonBody(request)
    if (body instanceof Response) return body
    const revision = typeof body['revision'] === 'string' ? body['revision'] : undefined
    if (revision === undefined) return fail(400, { code: 'bad-request', message: 'revision is required' })
    const read = await store.read()
    if (read.doc === null) return fail(422, { code: 'parse-error', message: read.parseError ?? 'the hosts file cannot be parsed' })
    if (read.revision !== revision) return fail(409, { code: 'conflict', message: 'hosts file changed on disk', revision: read.revision })
    const parsed = parseDoc({ version: 1, hosts: [body['draft']] })
    const draft: Host | undefined = parsed.doc?.hosts[0]
    if (parsed.doc === null || draft === undefined) {
      const errors: FieldError[] = parsed.errors.map(e => ({ path: e.path.replace(/^hosts\.0\.?/u, ''), message: e.message }))
      return ok({ argv: null, line: null, errors } satisfies PreviewResult)
    }
    const others = read.doc.hosts.filter(h => h.id !== draft.id)
    const built = buildLaunch(draft, [...others, draft], read.doc.groups, home)
    return ok((built.ok
      ? { argv: built.argv, line: built.line.replace(/\r$/u, ''), errors: [] }
      : { argv: null, line: null, errors: built.errors }) satisfies PreviewResult)
  }

  const launch = async (request: Request): Promise<Response> => {
    const body = await jsonBody(request)
    if (body instanceof Response) return body
    const id = typeof body['id'] === 'string' ? body['id'] : undefined
    if (id === undefined) return fail(400, { code: 'bad-request', message: 'id is required' })
    const read = await store.read()
    if (read.doc === null) return fail(422, { code: 'parse-error', message: read.parseError ?? 'the hosts file cannot be parsed' })
    const host = read.doc.hosts.find(h => h.id === id)
    if (host === undefined) return fail(404, { code: 'not-found', message: 'no such host' })
    // Opt-in: `Copy command` and the editor preview call this route too, and a
    // preview must never touch `known_hosts`.
    const heal = body['heal'] === true
    let hostKey: HostKeyReport = { status: 'disabled', reason: 'not requested' }
    if (heal) {
      hostKey = options.healChangedHostKey
        ? await checkHostKey(host, { home, timeoutMs: options.probeTimeoutMs })
        : { status: 'disabled', reason: 'healChangedHostKey is false' }
    }
    const built = buildLaunch(host, read.doc.hosts, read.doc.groups, home, { healHostKey: hostKey.status === 'changed' })
    if (!built.ok) return fail(422, { code: 'invalid', message: 'the host has invalid fields', errors: built.errors })
    return ok({ line: built.line, title: built.title, hostKey } satisfies LaunchResult)
  }

  const probe = async (request: Request): Promise<Response> => {
    const body = await jsonBody(request)
    if (body instanceof Response) return body
    const ids = Array.isArray(body['ids']) ? body['ids'].filter((i): i is string => typeof i === 'string') : []
    const read = await store.read()
    if (read.doc === null) return fail(422, { code: 'parse-error', message: read.parseError ?? 'the hosts file cannot be parsed' })
    const wanted = read.doc.hosts.filter(h => ids.includes(h.id))
    return ok(await probeHosts(wanted, options.probeTimeoutMs, options.probeConcurrency))
  }

  const identities = async (): Promise<Response> => ok(await listIdentities(home))

  return { list, save, preview, launch, probe, identities }
}

/**
 * Register every route, owned by this context.
 * @param ctx - Host context owning the `connection` service.
 * @param options - hosts file, probe settings and the host-key policy.
 */
export function registerRoutes(ctx: Context, options: RouteOptions): void {
  const handlers = createHandlers(options)
  for (const spec of ROUTES) {
    const handler = handlers[spec.key]
    const route: ConnectionFetchRoute = {
      path: spec.path,
      methods: CHANNEL_METHODS,
      requestBody: 'buffered',
      fetch: async (request) => {
        if (request.method !== spec.method) {
          return fail(405, { code: 'method-not-allowed', message: `use ${spec.method}` }, { allow: spec.method })
        }
        try {
          return await handler(request)
        } catch (error) {
          return fail(500, { code: 'internal', message: error instanceof Error ? error.message : String(error) })
        }
      },
    }
    ctx.effect(() => {
      const dispose = ctx.connection.fetch.register(route)
      return () => { void dispose() }
    }, `dsh-ssh-hosts: ${spec.path}`)
  }
}
