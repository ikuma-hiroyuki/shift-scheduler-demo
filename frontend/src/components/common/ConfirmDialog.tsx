import { useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'
import { isTopmostModal } from '../../hooks/useModalDismiss'
import ModalShell from './ModalShell'

export type ConfirmTone = 'delete' | 'warning'

interface ConfirmDialogProps {
  title: string
  description: ReactNode
  tone?: ConfirmTone
  kicker?: string
  confirmLabel?: string
  cancelLabel?: string
  loading?: boolean
  loadingLabel?: string
  onCancel: () => void
  onConfirm: () => void
}

interface ToneStyle {
  kicker: string
  kickerClass: string
  kickerStyle?: React.CSSProperties
  confirmLabel: string
  loadingLabel: string
  confirmClass: string
}

const FOCUS_RING_BASE =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-cream-50'

const TONE_STYLES: Record<ConfirmTone, ToneStyle> = {
  delete: {
    kicker: 'Delete',
    kickerClass: 'text-[10px] tracking-[0.3em] uppercase',
    kickerStyle: { color: '#a83232' },
    confirmLabel: '削除する',
    loadingLabel: '削除中…',
    confirmClass: `bg-[#a83232] text-white hover:bg-[#8e2828] disabled:opacity-50 ${FOCUS_RING_BASE} focus-visible:ring-[#a83232]`,
  },
  warning: {
    kicker: 'Confirm',
    kickerClass: 'text-[10px] tracking-[0.3em] uppercase text-brand-600',
    confirmLabel: '実行する',
    loadingLabel: '実行中…',
    confirmClass: `bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 ${FOCUS_RING_BASE} focus-visible:ring-brand-600`,
  },
}

export default function ConfirmDialog({
  title,
  description,
  tone = 'warning',
  kicker,
  confirmLabel,
  cancelLabel = 'キャンセル',
  loading = false,
  loadingLabel,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const t = TONE_STYLES[tone]
  const titleId = useId()
  const overlayRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    confirmRef.current?.focus()
  }, [])

  useEffect(() => {
    function handleTab(e: KeyboardEvent) {
      if (e.key !== 'Tab') return
      if (!isTopmostModal(overlayRef.current)) return
      const cancel = cancelRef.current
      const confirm = confirmRef.current
      const dialog = dialogRef.current
      if (!cancel || !confirm || !dialog) return
      const active = document.activeElement
      if (e.shiftKey) {
        if (active === cancel || !dialog.contains(active)) {
          e.preventDefault()
          confirm.focus()
        }
      } else {
        if (active === confirm || !dialog.contains(active)) {
          e.preventDefault()
          cancel.focus()
        }
      }
    }
    window.addEventListener('keydown', handleTab)
    return () => window.removeEventListener('keydown', handleTab)
  }, [])

  return (
    <ModalShell ref={overlayRef} onClose={onCancel} loading={loading}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-cream-50 border border-ink/10 rounded-sm shadow-2xl"
      >
        <div className="px-6 py-5 border-b border-ink/10">
          <span
            className={t.kickerClass}
            style={{ fontFamily: 'var(--font-mono)', ...t.kickerStyle }}
          >
            {kicker ?? t.kicker}
          </span>
          <h3
            id={titleId}
            className="text-xl font-medium text-brand-900 mt-1"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {title}
          </h3>
        </div>
        <div className="px-6 py-4 text-sm text-ink">
          {typeof description === 'string' ? <p>{description}</p> : description}
        </div>
        <div className="px-6 py-4 border-t border-ink/10 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={loading}
            className={`px-4 py-2 text-sm text-ink-muted hover:text-ink transition-colors disabled:opacity-50 rounded-sm ${FOCUS_RING_BASE} focus-visible:ring-ink/40`}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={`px-5 py-2 text-sm rounded-sm transition-colors ${t.confirmClass}`}
          >
            {loading ? (loadingLabel ?? t.loadingLabel) : (confirmLabel ?? t.confirmLabel)}
          </button>
        </div>
      </div>
    </ModalShell>
  )
}
