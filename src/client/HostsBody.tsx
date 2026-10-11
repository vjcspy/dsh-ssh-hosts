/**
 * The SSH tab body: toolbar, sections, rows and the editor drawer.
 *
 * The hosts file is the only authority. The body re-reads it every few seconds
 * while visible (and on focus), so a `git pull` or a hand edit shows up without
 * a reload; a write carries the revision it read and a `409` reloads with a toast.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: declares the `sessionId` session seat and the tab-info hook this body reads.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'

import { COLLAPSED_STORAGE_KEY, LIST_POLL_MS, PROBE_POLL_MS, RECENT_STORAGE_KEY } from '../config.ts'
import type { FieldError, Group, Host, ListResult, ProbeResult } from '../types.ts'
import { ApiError, api } from './api.ts'
import { EmptyState } from './components/EmptyState.tsx'
import { HostEditor } from './components/HostEditor.tsx'
import { HostRow } from './components/HostRow.tsx'
import { colorVar, fuzzyMatch, randomToken, readStored, searchText, writeStored } from './components/ui.ts'
import type { ConnectOutcome } from './connect.ts'
import type {} from './locale.ts'

/** A per-machine recent connection. */
interface Recent { readonly id: string; readonly at: number }

/** What the apply closure offers this body. */
export interface HostsInjected {
  /** Whether Connect can run now (terminal service and sidebar both present). */
  readonly available: { getSnapshot: () => boolean; subscribe: (fn: () => void) => () => void }
  /** The on-screen Session; the body aborts its connects when this stops being its own Session. */
  readonly mounted: { getSnapshot: () => string | undefined; subscribe: (fn: () => void) => () => void } | undefined
  /** Run one Connect transaction, or `undefined` while the terminal service is absent. */
  readonly connect: ((sessionId: string, hostId: string, signal: AbortSignal) => Promise<ConnectOutcome>) | undefined
  /** Record a per-machine recent connection. */
  readonly recordRecent: (hostId: string, at: number) => void
}

/** The body's composed props. */
export type HostsBodyProps =
  & PropsRuntime<'sidebar.right.pane.tab'>
  & { readonly face: () => HostsInjected }
  & PropsLocale<'dshSshHosts'>

const BLANK_AUTH = { kind: 'agent' } as const

/** A blank host for the New action. */
function blankHost(): Host {
  return { id: randomToken(8), name: '', auth: { ...BLANK_AUTH } }
}

/** One entry of the flattened, navigable list. */
interface Entry { readonly key: string; readonly host: Host }

/**
 * Render the SSH tab.
 * @param props - the tab info, the Session seat, the translate seat and the injected face.
 * @returns the tab element.
 */
export function HostsBody({ face: readFace, useTabInfo, sessionId, t }: HostsBodyProps): ReactNode {
  const face = useMemo(() => readFace(), [readFace])
  const { tab } = useTabInfo()
  const visible = tab.visible
  const canConnect = useSyncExternalStore(face.available.subscribe, face.available.getSnapshot)

  const [data, setData] = useState<ListResult | undefined>(undefined)
  const [loadError, setLoadError] = useState<string | undefined>(undefined)
  const [probes, setProbes] = useState<Record<string, ProbeResult>>({})
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | undefined>(undefined)
  const [editor, setEditor] = useState<{ host: Host; isNew: boolean } | undefined>(undefined)
  const [identities, setIdentities] = useState<string[]>([])
  const [toast, setToast] = useState<string | undefined>(undefined)
  const [connecting, setConnecting] = useState<ReadonlySet<string>>(new Set())
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => readStored(COLLAPSED_STORAGE_KEY, {}))
  const [recents, setRecents] = useState<Recent[]>(() => readStored<Recent[]>(RECENT_STORAGE_KEY, []))
  const controllers = useRef(new Map<string, AbortController>())
  const searchRef = useRef<HTMLInputElement | null>(null)
  const revisionRef = useRef('')
  const editorOpen = editor !== undefined

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const result = await api.list()
      revisionRef.current = result.revision
      setData(prev => (prev?.revision === result.revision && prev.exists === result.exists
        ? { ...prev, diagnostics: result.diagnostics } : result))
      setLoadError(undefined)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error))
    }
  }, [])

  // Poll while visible, and refresh on focus.
  useEffect(() => {
    if (!visible) return
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, LIST_POLL_MS)
    const onFocus = (): void => { void refresh() }
    window.addEventListener('focus', onFocus)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', onFocus) }
  }, [visible, refresh])

  // Probe on mount, when the host set changes, then every 60 s while visible.
  const probeKey = data?.doc?.hosts.map(h => h.id).join(',') ?? ''
  useEffect(() => {
    if (!visible || probeKey === '') return
    const controller = new AbortController()
    const run = (): void => {
      api.probe(probeKey.split(','), controller.signal).then((results) => {
        setProbes(Object.fromEntries(results.map(r => [r.id, r])))
      }).catch(() => undefined)
    }
    run()
    const timer = window.setInterval(run, PROBE_POLL_MS)
    return () => { window.clearInterval(timer); controller.abort() }
  }, [visible, probeKey])

  // Identity-file names for the editor combobox.
  useEffect(() => {
    if (editorOpen) api.identities().then(setIdentities).catch(() => undefined)
  }, [editorOpen])

  // Abort every in-flight Connect on unmount and when the user leaves this Session.
  useEffect(() => {
    const live = controllers.current
    const abortAll = (): void => { for (const controller of live.values()) controller.abort() }
    const stop = face.mounted?.subscribe(() => {
      const now = face.mounted?.getSnapshot()
      if (now !== undefined && now !== sessionId) abortAll()
      else if (now === undefined) abortAll()
    })
    return () => { stop?.(); abortAll() }
  }, [face, sessionId])

  const hosts = data?.doc?.hosts ?? []
  const groups = data?.doc?.groups ?? []
  const readOnly = data?.doc === null || data === undefined
  const groupName = (id: string | undefined): string | undefined => groups.find(g => g.id === id)?.name

  const visibleHosts = useMemo(
    () => hosts.filter(h => query.trim() === '' || fuzzyMatch(query, searchText(h, groupName(h.group)))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hosts, groups, query],
  )

  /** Sections in display order. */
  const sections = useMemo(() => {
    const out: { key: string; title: string; color?: string; hosts: Host[]; collapsible: boolean }[] = []
    const favorites = visibleHosts.filter(h => h.favorite === true)
    if (favorites.length > 0) out.push({ key: 'favorites', title: t('section.favorites'), hosts: favorites, collapsible: false })
    const byId = new Map(visibleHosts.map(h => [h.id, h]))
    const recent = recents.map(r => byId.get(r.id)).filter((h): h is Host => h !== undefined).slice(0, 5)
    if (recent.length > 0 && query.trim() === '') out.push({ key: 'recent', title: t('section.recent'), hosts: recent, collapsible: false })
    for (const group of groups) {
      const members = visibleHosts.filter(h => h.group === group.id)
      if (members.length > 0) out.push({ key: `group:${group.id}`, title: group.name, ...(group.color === undefined ? {} : { color: group.color }), hosts: members, collapsible: true })
    }
    const ungrouped = visibleHosts.filter(h => h.group === undefined || !groups.some(g => g.id === h.group))
    if (ungrouped.length > 0) out.push({ key: 'ungrouped', title: t('section.ungrouped'), hosts: ungrouped, collapsible: true })
    return out
  }, [visibleHosts, groups, recents, query, t])

  const flat: Entry[] = sections.flatMap(s => (s.collapsible && collapsed[s.key] === true ? [] : s.hosts.map(host => ({ key: `${s.key}|${host.id}`, host }))))

  const say = (message: string): void => { setToast(message) }

  const connectHost = useCallback(async (host: Host): Promise<void> => {
    if (face.connect === undefined) { say(t('toast.noTerminal')); return }
    if (controllers.current.has(host.id)) return
    const controller = new AbortController()
    controllers.current.set(host.id, controller)
    setConnecting(new Set(controllers.current.keys()))
    try {
      const outcome = await face.connect(sessionId, host.id, controller.signal)
      if (outcome.status === 'connected') setRecents(readStored<Recent[]>(RECENT_STORAGE_KEY, []))
      else if (outcome.status === 'failed') {
        say(t('toast.connectFailed', { error: outcome.cleanupError === undefined ? outcome.message : `${outcome.message}; ${outcome.cleanupError}` }))
      } else if (outcome.cleanupError !== undefined) say(outcome.cleanupError)
    } finally {
      controllers.current.delete(host.id)
      setConnecting(new Set(controllers.current.keys()))
    }
  }, [face, sessionId, t])

  /** Persist a new document; returns field errors when refused. */
  const persist = async (doc: NonNullable<ListResult['doc']>, hostIndex?: number): Promise<FieldError[] | undefined> => {
    try {
      const saved = await api.save(doc, revisionRef.current)
      revisionRef.current = saved.revision
      await refresh()
      say(t('toast.saved'))
      return undefined
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) { say(t('toast.conflict')); await refresh(); return undefined }
      if (error instanceof ApiError && error.status === 422) {
        const errors = error.fieldErrors
        if (hostIndex === undefined) say(t('toast.saveFailed', { error: errors[0] === undefined ? error.message : `${errors[0].path}: ${errors[0].message}` }))
        const prefix = `hosts.${hostIndex ?? -1}.`
        return errors.map(e => (e.path.startsWith(prefix) ? { ...e, path: e.path.slice(prefix.length) } : e))
      }
      say(t('toast.saveFailed', { error: error instanceof Error ? error.message : String(error) }))
      return undefined
    }
  }

  const saveHost = async (host: Host, newGroup: Group | undefined): Promise<FieldError[] | undefined> => {
    if (data?.doc == null) return undefined
    const doc = structuredClone(data.doc)
    if (newGroup !== undefined) doc.groups.push(newGroup)
    const index = doc.hosts.findIndex(h => h.id === host.id)
    if (index >= 0) doc.hosts[index] = host
    else doc.hosts.push(host)
    const refused = await persist(doc, index >= 0 ? index : doc.hosts.length - 1)
    if (refused === undefined) setEditor(undefined)
    return refused
  }

  const deleteHost = async (host: Host): Promise<void> => {
    if (data?.doc == null) return
    if (!window.confirm(t('row.deleteConfirm', { name: host.name }))) return
    const doc = structuredClone(data.doc)
    doc.hosts = doc.hosts.filter(h => h.id !== host.id)
    await persist(doc)
  }

  const copyCommand = async (host: Host): Promise<void> => {
    try {
      const launch = await api.launch(host.id)
      await navigator.clipboard.writeText(launch.line.replace(/^ /u, '').replace(/\r$/u, ''))
      say(t('toast.copied'))
    } catch (error) {
      say(t('toast.connectFailed', { error: error instanceof Error ? error.message : String(error) }))
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (editorOpen) return
    const target = event.target as HTMLElement
    const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT'
    if (event.key === '/' && !typing) { event.preventDefault(); searchRef.current?.focus(); return }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const at = flat.findIndex(e => e.key === selected)
      const next = event.key === 'ArrowDown' ? Math.min(flat.length - 1, at + 1) : Math.max(0, at - 1)
      const entry = flat[next < 0 ? 0 : next]
      if (entry !== undefined) setSelected(entry.key)
      return
    }
    if (event.key === 'Enter' && target === searchRef.current) {
      const entry = flat.find(e => e.key === selected) ?? flat[0]
      if (entry !== undefined && canConnect) void connectHost(entry.host)
    }
  }

  const toggle = (key: string): void => {
    const next = { ...collapsed, [key]: collapsed[key] !== true }
    setCollapsed(next)
    writeStored(COLLAPSED_STORAGE_KEY, next)
  }

  return (
    <div className='ssh-root' data-dsh-ssh='' onKeyDown={onKeyDown}>
      <div className='ssh-toolbar'>
        <input
          ref={searchRef} className='ssh-search' type='search' placeholder={t('toolbar.search')} value={query}
          onChange={(e) => { setQuery(e.target.value) }} aria-label={t('toolbar.search')}
        />
        <button type='button' className='ssh-btn ssh-btn--primary' disabled={readOnly} onClick={() => { setEditor({ host: blankHost(), isNew: true }) }}>{t('toolbar.add')}</button>
        <button type='button' className='ssh-icon-btn' title={t('toolbar.refresh')} aria-label={t('toolbar.refresh')} onClick={() => { void refresh() }}>↻</button>
      </div>
      {data?.parseError !== undefined && (
        <div className='ssh-banner' role='alert'>{t('banner.parse', { error: data.parseError, path: data.path })}</div>
      )}
      {loadError !== undefined && <div className='ssh-banner' role='alert'>{t('banner.load', { error: loadError })}</div>}
      <div className='ssh-scroll'>
        {data !== undefined && data.doc !== null && hosts.length === 0 && <EmptyState t={t} readOnly={readOnly} onAdd={() => { setEditor({ host: blankHost(), isNew: true }) }} />}
        {hosts.length > 0 && visibleHosts.length === 0 && <div className='ssh-empty'><p>{t('empty.noMatch', { query })}</p></div>}
        {sections.map((section) => {
          const isCollapsed = section.collapsible && collapsed[section.key] === true
          return (
            <div className='ssh-section' key={section.key} data-section={section.key}>
              <button type='button' className='ssh-section-head' onClick={() => { if (section.collapsible) toggle(section.key) }}>
                <span className='ssh-chip' style={{ background: colorVar(section.color) }} />
                {section.collapsible ? (isCollapsed ? '▸' : '▾') : ''} {section.title}
                <span className='ssh-count'>{section.hosts.length}</span>
              </button>
              {!isCollapsed && section.hosts.map((host) => {
                const key = `${section.key}|${host.id}`
                return (
                  <HostRow
                    key={key} host={host} diagnostics={data?.diagnostics[host.id]} probe={probes[host.id]} selected={selected === key}
                    connecting={connecting.has(host.id)} canConnect={canConnect} readOnly={readOnly} t={t}
                    onSelect={() => { setSelected(key) }} onConnect={() => { void connectHost(host) }}
                    onEdit={() => { setEditor({ host: structuredClone(host), isNew: false }) }}
                    onDuplicate={() => { setEditor({ host: { ...structuredClone(host), id: randomToken(8), name: `${host.name} copy` }, isNew: true }) }}
                    onCopy={() => { void copyCommand(host) }} onDelete={() => { void deleteHost(host) }}
                  />
                )
              })}
            </div>
          )
        })}
        {data !== undefined && <div className='ssh-footnote ssh-mono'>{t('footnote.hostsFile', { path: data.path })}</div>}
      </div>
      {editor !== undefined && data?.doc != null && (
        <HostEditor
          key={editor.host.id} initial={editor.host} isNew={editor.isNew} groups={groups} hosts={hosts} revision={data.revision}
          identities={identities} t={t} onCancel={() => { setEditor(undefined) }} onSave={saveHost}
          onConflict={() => { say(t('toast.conflict')); void refresh() }}
        />
      )}
      {toast !== undefined && (
        <div className='ssh-toast' role='status'>
          <span>{toast}</span>
          <button type='button' aria-label={t('toast.dismiss')} onClick={() => { setToast(undefined) }}>✕</button>
        </div>
      )}
    </div>
  )
}
