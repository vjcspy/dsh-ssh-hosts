/** One host row: accent bar, name, address, badges, status dot and hover actions. */
import type { ReactNode } from 'react'

import type { Host, HostDiagnostics, ProbeResult } from '../../types.ts'
import type { Translate } from '../locale.ts'
import { addressOf, authKey, colorVar } from './ui.ts'

/** Props of {@link HostRow}. */
export interface HostRowProps {
  readonly host: Host
  readonly diagnostics: HostDiagnostics | undefined
  readonly probe: ProbeResult | undefined
  readonly selected: boolean
  readonly connecting: boolean
  readonly canConnect: boolean
  readonly readOnly: boolean
  readonly t: Translate
  readonly onSelect: () => void
  readonly onConnect: () => void
  readonly onEdit: () => void
  readonly onDuplicate: () => void
  readonly onCopy: () => void
  readonly onDelete: () => void
}

/** Diagnostic and structure badges of a host. */
function Badges({ host, diagnostics: d, t }: { host: Host; diagnostics: HostDiagnostics | undefined; t: Translate }): ReactNode {
  return (
    <div className='ssh-badges'>
      <span className='ssh-badge'>{t(authKey(host.auth))}</span>
      {host.jump !== undefined && <span className='ssh-badge'>{t('badge.jump')}</span>}
      {d?.key === 'missing' && <span className='ssh-badge ssh-badge--error'>{t('badge.keyMissing')}</span>}
      {d?.key === 'too-open' && <span className='ssh-badge ssh-badge--warn'>{t('badge.keyTooOpen')}</span>}
      {d?.certificate === 'missing' && <span className='ssh-badge ssh-badge--error'>{t('badge.certMissing')}</span>}
      {d?.alias === 'not-found' && <span className='ssh-badge ssh-badge--warn'>{t('badge.aliasMissing')}</span>}
      {d?.machineSpecificSocket === true && <span className='ssh-badge ssh-badge--warn'>{t('badge.machineSocket')}</span>}
      {d?.jumpMissing === true && <span className='ssh-badge ssh-badge--error'>{t('badge.jumpMissing')}</span>}
      {(host.tags ?? []).map(tag => <span className='ssh-badge' key={tag}>{tag}</span>)}
    </div>
  )
}

/**
 * Render one host.
 * @param props - the row's data and callbacks.
 * @returns the row element.
 */
export function HostRow(props: HostRowProps): ReactNode {
  const { host, probe, t } = props
  const stop = (fn: () => void) => (event: { stopPropagation: () => void }): void => { event.stopPropagation(); fn() }
  return (
    <div
      className='ssh-row'
      data-host-id={host.id}
      data-selected={props.selected}
      role='button'
      tabIndex={0}
      onClick={() => { props.onSelect(); if (props.canConnect && !props.connecting) props.onConnect() }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && event.target === event.currentTarget && props.canConnect && !props.connecting) props.onConnect()
      }}
    >
      <span className='ssh-accent' style={{ background: colorVar(host.color) }} />
      <span className='ssh-dot' data-state={probe?.state ?? 'unknown'} title={t(`status.${probe?.state ?? 'unknown'}`)} />
      <div className='ssh-main'>
        <span className='ssh-name'>{host.favorite === true ? '★ ' : ''}{host.name}</span>
        <span className='ssh-sub ssh-mono'>
          {addressOf(host)}
          {probe?.state === 'up' && probe.ms !== undefined && <span className='ssh-latency'>{`  ${probe.ms} ms`}</span>}
        </span>
        <Badges host={host} diagnostics={props.diagnostics} t={t} />
      </div>
      {props.connecting
        ? <span className='ssh-spinner' role='status' aria-label={t('row.connecting')} />
        : (
          <div className='ssh-actions'>
            <button type='button' className='ssh-act' title={t('row.connect')} disabled={!props.canConnect} onClick={stop(props.onConnect)}>▶</button>
            <button type='button' className='ssh-act' title={t('row.edit')} disabled={props.readOnly} onClick={stop(props.onEdit)}>✎</button>
            <button type='button' className='ssh-act' title={t('row.duplicate')} disabled={props.readOnly} onClick={stop(props.onDuplicate)}>⧉</button>
            <button type='button' className='ssh-act' title={t('row.copy')} onClick={stop(props.onCopy)}>⎘</button>
            <button type='button' className='ssh-act' title={t('row.delete')} disabled={props.readOnly} onClick={stop(props.onDelete)}>🗑</button>
          </div>
        )}
    </div>
  )
}
