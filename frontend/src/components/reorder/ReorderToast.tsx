import { useEffect } from 'react'
import type { ReorderState } from '../../stores/reorderStore'

interface Props {
  useStore: () => ReorderState
  /** 自動消去までの ms (デフォルト 4000) */
  durationMs?: number
}

/**
 * 並び替え用トースト。reorderStore.toast を 4 秒で自動消去。
 * aria-live で screen reader に announce。
 */
export default function ReorderToast({ useStore, durationMs = 4000 }: Props) {
  const toast = useStore().toast
  const setToast = useStore().setToast

  useEffect(() => {
    if (toast === null) return
    const t = setTimeout(() => setToast(null), durationMs)
    return () => clearTimeout(t)
  }, [toast, durationMs, setToast])

  if (toast === null) return null

  const tone =
    toast.kind === 'success'
      ? 'bg-[#3a6b6b] text-white border-[#3a6b6b]'
      : toast.kind === 'error'
        ? 'bg-[#a83232] text-white border-[#a83232]'
        : 'bg-brand-900 text-cream-50 border-brand-900'

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-6 right-6 z-50 px-5 py-3 rounded-sm shadow-xl border ${tone}`}
    >
      <div className="text-sm">{toast.message}</div>
    </div>
  )
}
