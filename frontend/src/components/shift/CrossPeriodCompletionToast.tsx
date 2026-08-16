import { useEffect } from 'react'
import type { Schedule } from '../../types/api'

interface Props {
  /** Completed schedule whose period differs from what the user is currently viewing. */
  schedule: Schedule
  /** Click handler — typically `() => { setDepartmentId(...); setYear(...); setMonth(...) }`. */
  onJump: () => void
  /** Dismiss handler — fires on close button or auto-dismiss timeout. */
  onDismiss: () => void
}

const AUTO_DISMISS_MS = 8000

/**
 * Floating toast shown when a generation completes for a period the user has navigated away from.
 * (issue #212) Without this, the failure / success would be silently swallowed by the cleanup
 * useEffect that wipes the inline failure panel on period switch.
 *
 * Click "ジャンプ" → switch back to the schedule's department/year/month so the user can act.
 */
export default function CrossPeriodCompletionToast({ schedule, onJump, onDismiss }: Props) {
  useEffect(() => {
    const handle = window.setTimeout(onDismiss, AUTO_DISMISS_MS)
    return () => window.clearTimeout(handle)
  }, [onDismiss])

  const isFailed = schedule.status === 'INFEASIBLE'
  const kicker = isFailed ? 'Generation Failed' : 'Generation Completed'
  const headline = isFailed
    ? `${schedule.year}年${schedule.month}月の生成が失敗しました`
    : `${schedule.year}年${schedule.month}月の生成が完了しました`
  const accent = isFailed ? '#a83232' : '#2f7a3c'

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-6 right-6 z-40 max-w-sm bg-cream-50 border border-ink/15 rounded-sm shadow-lg"
      style={{ animation: 'crossPeriodToastIn 0.22s cubic-bezier(0.2, 0.8, 0.2, 1)' }}
    >
      <style>{`@keyframes crossPeriodToastIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }`}</style>
      <div className="px-4 py-3 flex items-start gap-3">
        <div
          aria-hidden="true"
          className="mt-1.5 w-2 h-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: accent }}
        />
        <div className="flex-1 min-w-0">
          <p
            className="text-[10px] tracking-[0.3em] uppercase"
            style={{ fontFamily: 'var(--font-mono)', color: accent }}
          >
            {kicker}
          </p>
          <p className="text-sm text-brand-900 font-medium mt-0.5">{headline}</p>
          {isFailed && schedule.diagnosis && (
            <p className="text-xs text-ink-muted mt-1 line-clamp-2">{schedule.diagnosis}</p>
          )}
          <div className="mt-2 flex gap-3 text-xs">
            <button
              type="button"
              onClick={onJump}
              className="text-brand-600 hover:text-brand-700 underline-offset-2 hover:underline"
            >
              該当期間にジャンプ
            </button>
            <button
              type="button"
              onClick={onDismiss}
              className="text-ink-muted hover:text-ink"
            >
              閉じる
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
