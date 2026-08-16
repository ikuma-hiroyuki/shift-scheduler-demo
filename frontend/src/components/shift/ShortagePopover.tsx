import { useEffect, useMemo, useRef } from 'react'
import type { ShortageRow } from '../../types/api'

interface Props {
  shortage: ShortageRow
  anchorRect: DOMRect
  onClose: () => void
}

/**
 * PARTIAL 状態の稼働表で、不足ポジセルをクリック/タップしたときに開くポップオーバー。
 * 不足の概要 (日付、ポジション名、不足人数、必要 / 現在) のみを表示する。
 *
 * CellEditPopover.tsx の自前 popover 実装パターン (画面端制御、Esc/外クリック閉じ) を踏襲。
 */
export default function ShortagePopover({ shortage, anchorRect, onClose }: Props) {
  const popRef = useRef<HTMLDivElement | null>(null)

  // Esc キー閉じ + クリック外閉じ
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    function onClick(e: MouseEvent) {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onClick)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onClick)
    }
  }, [onClose])

  // ポップオーバー位置 (画面端制御)
  const style = useMemo(() => {
    const POP_WIDTH = 280
    const POP_MAX_HEIGHT = 120
    const left = Math.min(
      Math.max(8, anchorRect.left),
      window.innerWidth - POP_WIDTH - 8,
    )
    const top = anchorRect.bottom + 4
    const overflow = top + POP_MAX_HEIGHT > window.innerHeight
    return overflow
      ? {
          position: 'fixed' as const,
          left,
          bottom: window.innerHeight - anchorRect.top + 4,
          width: POP_WIDTH,
          zIndex: 50,
        }
      : { position: 'fixed' as const, left, top, width: POP_WIDTH, zIndex: 50 }
  }, [anchorRect])

  return (
    <div
      ref={popRef}
      role="dialog"
      aria-labelledby="shortage-popover-title"
      style={style}
      className="bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2"
    >
      <div id="shortage-popover-title" className="text-sm font-semibold text-gray-900">
        {shortage.day}日 {shortage.pattern_name} ポジション {shortage.missing}名不足
      </div>
      <div className="text-xs text-gray-500 mt-0.5">
        必要 {shortage.required}名 / 現在 {shortage.assigned}名
      </div>
    </div>
  )
}
