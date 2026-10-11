/** The empty state: short copy, an Add action, the per-conversation caveat and the no-hidden-execution policy. */
import type { ReactNode } from 'react'

import type { Translate } from '../locale.ts'

/**
 * @param props - the translate seat and the add callback.
 * @returns the empty-state element.
 */
export function EmptyState({ t, onAdd, readOnly }: { t: Translate; onAdd: () => void; readOnly: boolean }): ReactNode {
  return (
    <div className='ssh-empty' data-testid='empty-state'>
      <h3>{t('empty.title')}</h3>
      <p>{t('empty.body')}</p>
      <button type='button' className='ssh-btn ssh-btn--primary' disabled={readOnly} onClick={onAdd}>{t('empty.add')}</button>
      <p>{t('empty.policy')}</p>
    </div>
  )
}
