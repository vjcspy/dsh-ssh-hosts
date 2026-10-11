/**
 * The in-panel host editor drawer.
 *
 * Every field error and the command preview come from the host's own validator
 * and builder (`hosts/preview`), debounced 300 ms, so what is previewed is
 * exactly what `launch` would build.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import type { AuthKind, FieldError, Forward, Group, Host, PreviewResult } from '../../types.ts'
import { ApiError, api } from '../api.ts'
import type { Translate } from '../locale.ts'
import { COLORS, colorVar, groupIdFor } from './ui.ts'

const KINDS: readonly AuthKind[] = ['agent', 'key', 'certificate', 'identity-agent', 'alias', 'password']

/** The editable form state. */
interface Form {
  id: string
  name: string
  group: string
  newGroupName: string
  tags: string
  color: string
  favorite: boolean
  host: string
  port: string
  user: string
  kind: AuthKind
  identityFile: string
  certificateFile: string
  agentSocket: string
  alias: string
  jumpMode: 'none' | 'saved' | 'spec'
  jumpHost: string
  jumpSpec: string
  forwards: { kind: Forward['kind']; bind: string; target: string }[]
  options: { key: string; value: string }[]
  remoteCommand: string
  notes: string
}

/** @param host - a saved host or a blank template. @returns form state. */
function toForm(host: Host): Form {
  return {
    id: host.id, name: host.name, group: host.group ?? '', newGroupName: '', tags: (host.tags ?? []).join(', '),
    color: host.color ?? '', favorite: host.favorite === true, host: host.host ?? '', port: host.port === undefined ? '' : String(host.port),
    user: host.user ?? '', kind: host.auth.kind, identityFile: host.auth.identityFile ?? '', certificateFile: host.auth.certificateFile ?? '',
    agentSocket: host.auth.agentSocket ?? '', alias: host.auth.alias ?? '',
    jumpMode: host.jump?.host !== undefined ? 'saved' : host.jump?.spec !== undefined ? 'spec' : 'none',
    jumpHost: host.jump?.host ?? '', jumpSpec: host.jump?.spec ?? '',
    forwards: (host.forwards ?? []).map(f => ({ kind: f.kind, bind: f.bind, target: f.target ?? '' })),
    options: Object.entries(host.options ?? {}).map(([key, value]) => ({ key, value })),
    remoteCommand: host.remoteCommand ?? '', notes: host.notes ?? '',
  }
}

/** Blank string means absent. */
const some = (value: string): string | undefined => (value.trim() === '' ? undefined : value.trim())

/** @param form - form state. @param groupId - the group id to use. @returns the host the form describes. */
function fromForm(form: Form, groupId: string | undefined): Host {
  const auth: Host['auth'] = { kind: form.kind }
  if (form.kind === 'key' || form.kind === 'certificate') auth.identityFile = some(form.identityFile)
  if (form.kind === 'certificate') auth.certificateFile = some(form.certificateFile)
  if (form.kind === 'identity-agent') auth.agentSocket = some(form.agentSocket)
  if (form.kind === 'alias') auth.alias = some(form.alias)
  const port = some(form.port)
  const tags = form.tags.split(',').map(s => s.trim()).filter(s => s !== '')
  const options = Object.fromEntries(form.options.filter(o => o.key.trim() !== '').map(o => [o.key.trim(), o.value]))
  const host: Host = { id: form.id, name: form.name.trim(), auth }
  if (groupId !== undefined) host.group = groupId
  if (tags.length > 0) host.tags = tags
  if (form.color !== '') host.color = form.color as Host['color']
  if (form.favorite) host.favorite = true
  if (some(form.host) !== undefined) host.host = some(form.host)
  if (port !== undefined) host.port = Number(port)
  if (some(form.user) !== undefined) host.user = some(form.user)
  if (form.jumpMode === 'saved') host.jump = { host: form.jumpHost }
  else if (form.jumpMode === 'spec') host.jump = { spec: form.jumpSpec.trim() }
  if (form.forwards.length > 0) {
    host.forwards = form.forwards.map(f => (f.kind === 'dynamic' ? { kind: f.kind, bind: f.bind.trim() } : { kind: f.kind, bind: f.bind.trim(), target: f.target.trim() }))
  }
  if (Object.keys(options).length > 0) host.options = options
  if (some(form.remoteCommand) !== undefined) host.remoteCommand = some(form.remoteCommand)
  if (some(form.notes) !== undefined) host.notes = form.notes
  return host
}

/** Props of {@link HostEditor}. */
export interface HostEditorProps {
  readonly initial: Host
  readonly isNew: boolean
  readonly groups: readonly Group[]
  readonly hosts: readonly Host[]
  readonly revision: string
  readonly identities: readonly string[]
  readonly t: Translate
  readonly onCancel: () => void
  /** Save the host (and the group when new); resolves with field errors when refused. */
  readonly onSave: (host: Host, newGroup: Group | undefined) => Promise<FieldError[] | undefined>
  readonly onConflict: () => void
}

/**
 * Render the editor drawer.
 * @param props - the host, the inventory and the callbacks.
 * @returns the drawer element.
 */
export function HostEditor(props: HostEditorProps): ReactNode {
  const { t } = props
  const [form, setForm] = useState<Form>(() => toForm(props.initial))
  const [errors, setErrors] = useState<FieldError[]>([])
  const [preview, setPreview] = useState<PreviewResult | undefined>(undefined)
  const [saving, setSaving] = useState(false)
  const set = <K extends keyof Form>(key: K, value: Form[K]): void => { setForm(prev => ({ ...prev, [key]: value })) }

  const creatingGroup = form.group === '__new'
  const newGroup: Group | undefined = creatingGroup && form.newGroupName.trim() !== ''
    ? { id: groupIdFor(form.newGroupName, props.groups.map(g => g.id)), name: form.newGroupName.trim() }
    : undefined
  const groupId = creatingGroup ? undefined : (form.group === '' ? undefined : form.group)
  const draft = useMemo(() => fromForm(form, groupId), [form, groupId])

  const conflict = useRef(props.onConflict)
  conflict.current = props.onConflict
  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      api.preview(draft, props.revision, controller.signal).then((result) => {
        setPreview(result)
        setErrors(result.errors)
      }).catch((error: unknown) => {
        if (controller.signal.aborted) return
        if (error instanceof ApiError && error.status === 409) conflict.current()
      })
    }, 300)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [draft, props.revision])

  const errOf = (path: string): string | undefined => errors.find(e => e.path === path)?.message
  const fieldError = (path: string): ReactNode => {
    const message = errOf(path)
    return message === undefined ? null : <span className='ssh-error' role='alert'>{message}</span>
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      const refused = await props.onSave(fromForm(form, creatingGroup ? newGroup?.id : groupId), newGroup)
      if (refused !== undefined) setErrors(refused)
    } finally {
      setSaving(false)
    }
  }

  const pathInput = (key: 'identityFile' | 'certificateFile' | 'agentSocket', label: string, listId?: string): ReactNode => (
    <div className='ssh-field'>
      <label>{label}</label>
      <input
        className='ssh-input ssh-mono' value={form[key]} list={listId} aria-invalid={errOf(`auth.${key}`) !== undefined}
        onChange={(e) => { set(key, e.target.value) }} spellCheck={false}
      />
      {fieldError(`auth.${key}`)}
    </div>
  )

  const jumpCandidates = props.hosts.filter(h => h.id !== form.id && h.jump === undefined)
  return (
    <div className='ssh-drawer' role='dialog' aria-label={props.isNew ? t('editor.titleNew') : t('editor.titleEdit')}>
      <div className='ssh-drawer-head'>
        <span>{props.isNew ? t('editor.titleNew') : t('editor.titleEdit')}</span>
        <button type='button' className='ssh-icon-btn' style={{ marginLeft: 'auto' }} onClick={props.onCancel} aria-label={t('editor.close')}>✕</button>
      </div>
      <div className='ssh-drawer-body'>
        <div className='ssh-field'>
          <label>{t('editor.name')}</label>
          <input className='ssh-input' value={form.name} aria-invalid={errOf('name') !== undefined} onChange={(e) => { set('name', e.target.value) }} autoFocus />
          {fieldError('name')}
        </div>
        <div className='ssh-field'>
          <label>{t('editor.group')}</label>
          <select className='ssh-select' value={form.group} onChange={(e) => { set('group', e.target.value) }}>
            <option value=''>{t('editor.groupNone')}</option>
            {props.groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            <option value='__new'>{t('editor.groupNew')}</option>
          </select>
          {creatingGroup && <input className='ssh-input' placeholder={t('editor.groupNewName')} value={form.newGroupName} onChange={(e) => { set('newGroupName', e.target.value) }} />}
          {fieldError('group')}
        </div>
        <div className='ssh-field'>
          <label>{t('editor.tags')}</label>
          <input className='ssh-input' value={form.tags} onChange={(e) => { set('tags', e.target.value) }} />
        </div>
        <div className='ssh-field'>
          <span className='ssh-label'>{t('editor.color')}</span>
          <div className='ssh-swatches'>
            {COLORS.map(color => (
              <button
                key={color} type='button' className='ssh-swatch' aria-label={color} aria-pressed={form.color === color}
                style={{ background: colorVar(color) }} onClick={() => { set('color', form.color === color ? '' : color) }}
              />
            ))}
          </div>
          <label className='ssh-hint'><input type='checkbox' checked={form.favorite} onChange={(e) => { set('favorite', e.target.checked) }} /> {t('editor.favorite')}</label>
        </div>

        {form.kind !== 'alias' && (
          <>
            <div className='ssh-grid2'>
              <div className='ssh-field'>
                <label>{t('editor.host')}</label>
                <input className='ssh-input ssh-mono' value={form.host} aria-invalid={errOf('host') !== undefined} onChange={(e) => { set('host', e.target.value) }} spellCheck={false} />
                {fieldError('host')}
              </div>
              <div className='ssh-field'>
                <label>{t('editor.port')}</label>
                <input className='ssh-input ssh-mono' value={form.port} placeholder='22' inputMode='numeric' aria-invalid={errOf('port') !== undefined} onChange={(e) => { set('port', e.target.value) }} />
                {fieldError('port')}
              </div>
            </div>
            <div className='ssh-field'>
              <label>{t('editor.user')}</label>
              <input className='ssh-input ssh-mono' value={form.user} aria-invalid={errOf('user') !== undefined} onChange={(e) => { set('user', e.target.value) }} spellCheck={false} />
              {fieldError('user')}
            </div>
          </>
        )}

        <div className='ssh-field'>
          <span className='ssh-label'>{t('editor.auth')}</span>
          <div className='ssh-seg'>
            {KINDS.map(kind => (
              <button key={kind} type='button' aria-pressed={form.kind === kind} onClick={() => { set('kind', kind) }}>{t(`auth.${kind}`)}</button>
            ))}
          </div>
        </div>
        {(form.kind === 'key' || form.kind === 'certificate') && (
          <>
            {pathInput('identityFile', t('editor.identityFile'), 'ssh-identities')}
            <datalist id='ssh-identities'>{props.identities.map(name => <option key={name} value={name} />)}</datalist>
          </>
        )}
        {form.kind === 'certificate' && pathInput('certificateFile', t('editor.certificateFile'))}
        {form.kind === 'identity-agent' && pathInput('agentSocket', t('editor.agentSocket'))}
        {form.kind === 'alias' && (
          <div className='ssh-field'>
            <label>{t('editor.alias')}</label>
            <input className='ssh-input ssh-mono' value={form.alias} aria-invalid={errOf('auth.alias') !== undefined} onChange={(e) => { set('alias', e.target.value) }} spellCheck={false} />
            {fieldError('auth.alias')}
            <span className='ssh-hint'>{t('editor.aliasHint')}</span>
          </div>
        )}
        {form.kind === 'password' && <span className='ssh-hint'>{t('editor.passwordHint')}</span>}
        {form.kind === 'agent' && <span className='ssh-hint'>{t('editor.agentHint')}</span>}

        <details className='ssh-disclosure'>
          <summary>{t('editor.advanced')}</summary>
          <div className='ssh-disclosure-body'>
            <div className='ssh-field'>
              <span className='ssh-label'>{t('editor.jump')}</span>
              <div className='ssh-seg'>
                {(['none', 'saved', 'spec'] as const).map(mode => (
                  <button key={mode} type='button' aria-pressed={form.jumpMode === mode} onClick={() => { set('jumpMode', mode) }}>
                    {mode === 'none' ? t('editor.jumpNone') : mode === 'saved' ? t('editor.jumpSaved') : t('editor.jumpSpec')}
                  </button>
                ))}
              </div>
              {form.jumpMode === 'saved' && (
                <select className='ssh-select' value={form.jumpHost} onChange={(e) => { set('jumpHost', e.target.value) }}>
                  <option value=''>—</option>
                  {jumpCandidates.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                </select>
              )}
              {form.jumpMode === 'spec' && (
                <input className='ssh-input ssh-mono' value={form.jumpSpec} placeholder={t('editor.jumpSpecPlaceholder')} onChange={(e) => { set('jumpSpec', e.target.value) }} spellCheck={false} />
              )}
              {fieldError('jump')}{fieldError('jump.host')}{fieldError('jump.spec')}
            </div>

            <div className='ssh-field'>
              <span className='ssh-label'>{t('editor.forwards')}</span>
              {form.forwards.map((f, i) => (
                <div key={i} className='ssh-fwd'>
                  <select className='ssh-select' value={f.kind} onChange={(e) => { set('forwards', form.forwards.map((x, j) => (j === i ? { ...x, kind: e.target.value as Forward['kind'] } : x))) }}>
                    <option value='local'>{t('editor.forwardKindLocal')}</option>
                    <option value='remote'>{t('editor.forwardKindRemote')}</option>
                    <option value='dynamic'>{t('editor.forwardKindDynamic')}</option>
                  </select>
                  <input className='ssh-input ssh-mono' placeholder={t('editor.forwardBind')} value={f.bind} onChange={(e) => { set('forwards', form.forwards.map((x, j) => (j === i ? { ...x, bind: e.target.value } : x))) }} />
                  <input className='ssh-input ssh-mono' placeholder={t('editor.forwardTarget')} value={f.target} disabled={f.kind === 'dynamic'} onChange={(e) => { set('forwards', form.forwards.map((x, j) => (j === i ? { ...x, target: e.target.value } : x))) }} />
                  <button type='button' className='ssh-act' aria-label={t('editor.remove')} onClick={() => { set('forwards', form.forwards.filter((_, j) => j !== i)) }}>✕</button>
                  {fieldError(`forwards.${i}.bind`)}{fieldError(`forwards.${i}.target`)}
                </div>
              ))}
              <button type='button' className='ssh-btn' onClick={() => { set('forwards', [...form.forwards, { kind: 'local', bind: '', target: '' }]) }}>{t('editor.forwardAdd')}</button>
            </div>

            <div className='ssh-field'>
              <span className='ssh-label'>{t('editor.options')}</span>
              {form.options.map((o, i) => (
                <div key={i}>
                  <div className='ssh-kv'>
                    <input className='ssh-input ssh-mono' placeholder={t('editor.optionKey')} value={o.key} aria-invalid={errOf(`options.${o.key}`) !== undefined} onChange={(e) => { set('options', form.options.map((x, j) => (j === i ? { ...x, key: e.target.value } : x))) }} />
                    <input className='ssh-input ssh-mono' placeholder={t('editor.optionValue')} value={o.value} onChange={(e) => { set('options', form.options.map((x, j) => (j === i ? { ...x, value: e.target.value } : x))) }} />
                    <button type='button' className='ssh-act' aria-label={t('editor.remove')} onClick={() => { set('options', form.options.filter((_, j) => j !== i)) }}>✕</button>
                  </div>
                  {fieldError(`options.${o.key}`)}
                </div>
              ))}
              <button type='button' className='ssh-btn' onClick={() => { set('options', [...form.options, { key: '', value: '' }]) }}>{t('editor.optionAdd')}</button>
            </div>

            <div className='ssh-field'>
              <label>{t('editor.remoteCommand')}</label>
              <input className='ssh-input ssh-mono' value={form.remoteCommand} aria-invalid={errOf('remoteCommand') !== undefined} onChange={(e) => { set('remoteCommand', e.target.value) }} spellCheck={false} />
              {fieldError('remoteCommand')}
            </div>
            <div className='ssh-field'>
              <label>{t('editor.notes')}</label>
              <textarea className='ssh-textarea' rows={3} value={form.notes} onChange={(e) => { set('notes', e.target.value) }} />
            </div>
          </div>
        </details>

        <div className='ssh-field'>
          <span className='ssh-label'>{t('editor.preview')}</span>
          <div className='ssh-preview ssh-mono' data-testid='command-preview'>
            {preview?.line ?? t('editor.previewPending')}
          </div>
          {preview?.line != null && (
            <button type='button' className='ssh-btn' onClick={() => { void navigator.clipboard?.writeText(preview.line ?? '') }}>{t('editor.previewCopy')}</button>
          )}
        </div>
      </div>
      <div className='ssh-drawer-foot'>
        <button type='button' className='ssh-btn ssh-btn--primary' disabled={saving || (preview?.errors.length ?? 1) > 0 || (creatingGroup && newGroup === undefined)} onClick={() => { void save() }}>{t('editor.save')}</button>
        <button type='button' className='ssh-btn' onClick={props.onCancel}>{t('editor.cancel')}</button>
      </div>
    </div>
  )
}
