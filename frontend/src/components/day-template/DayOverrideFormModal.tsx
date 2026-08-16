import { useEffect, useState } from 'react'
import type { DayOverride, WorkPattern } from '../../types/api'
import ModalShell from '../common/ModalShell'
import { useDirtyDiscardConfirm } from '../../hooks/useDirtyDiscardConfirm'

interface Props {
  mode: 'create' | 'edit'
  initial: DayOverride | null
  patterns: WorkPattern[]
  onClose: () => void
  /** department_id はページ側で付与する */
  onSubmit: (payload: {
    specific_date: string
    pattern_id: number
    required_min: number
    required_max: number | null
  }) => Promise<void>
}

export default function DayOverrideFormModal({
  mode,
  initial,
  patterns,
  onClose,
  onSubmit,
}: Props) {
  const [specificDate, setSpecificDate] = useState<string>('')
  const [patternId, setPatternId] = useState<number | null>(
    patterns[0]?.id ?? null,
  )
  const [requiredMin, setRequiredMin] = useState<string>('1')
  const [requiredMax, setRequiredMax] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (initial) {
      setSpecificDate(initial.specific_date)
      setPatternId(initial.pattern_id)
      setRequiredMin(String(initial.required_min))
      setRequiredMax(initial.required_max == null ? '' : String(initial.required_max))
    } else if (patterns.length > 0 && patternId === null) {
      setPatternId(patterns[0].id)
    }
  }, [initial, patterns, patternId])

  const { attemptClose, dialog: discardDialog } = useDirtyDiscardConfirm({
    values: { specificDate, patternId, requiredMin, requiredMax },
    onClose,
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    if (!specificDate) {
      setErr('日付を入力してください')
      return
    }
    if (patternId === null) {
      setErr('作業パターンを選択してください')
      return
    }
    const min = parseInt(requiredMin, 10)
    if (Number.isNaN(min) || min < 0) {
      setErr('最小人数は 0 以上の整数で入力してください')
      return
    }
    let max: number | null = null
    if (requiredMax.trim() !== '') {
      max = parseInt(requiredMax, 10)
      if (Number.isNaN(max) || max < min) {
        setErr('最大人数は最小人数以上で入力してください')
        return
      }
    }
    setBusy(true)
    try {
      await onSubmit({
        specific_date: specificDate,
        pattern_id: patternId,
        required_min: min,
        required_max: max,
      })
      onClose()
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
      setErr(typeof msg === 'string' ? msg : '保存に失敗しました')
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalShell onClose={attemptClose} loading={busy}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        className="w-full max-w-md bg-cream-50 border border-ink/10 rounded-sm shadow-2xl"
        style={{ animation: 'modalIn 0.22s cubic-bezier(0.2, 0.8, 0.2, 1)' }}
      >
        <style>{`@keyframes modalIn { from { opacity: 0; transform: translateY(8px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }`}</style>

        <div className="px-7 pt-6 pb-4 border-b border-ink/10 flex items-baseline justify-between">
          <h2
            className="text-2xl font-medium text-brand-900"
            style={{ fontFamily: 'var(--font-display)', fontVariationSettings: '"opsz" 96' }}
          >
            {mode === 'create' ? '特定日上書きを追加' : '特定日上書きを編集'}
          </h2>
          <span
            className="text-[10px] tracking-[0.3em] uppercase text-brand-600"
            style={{ fontFamily: 'var(--font-mono)' }}
          >
            {mode === 'create' ? 'New' : 'Edit'}
          </span>
        </div>

        <div className="px-7 py-5 space-y-5">
          <label className="block">
            <span
              className="text-[11px] tracking-widest uppercase text-ink-muted block mb-1.5"
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              対象日
            </span>
            <input
              type="date"
              value={specificDate}
              onChange={(e) => setSpecificDate(e.target.value)}
              className="w-full bg-transparent border-0 border-b border-ink/30 focus:border-brand-600 focus:outline-none px-0 py-1.5 text-base"
              style={{ fontFamily: 'var(--font-mono)' }}
              required
            />
          </label>

          <label className="block">
            <span
              className="text-[11px] tracking-widest uppercase text-ink-muted block mb-1.5"
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              作業パターン
            </span>
            <select
              value={patternId ?? ''}
              onChange={(e) => setPatternId(Number(e.target.value))}
              className="w-full bg-transparent border-0 border-b border-ink/30 focus:border-brand-600 focus:outline-none px-0 py-1.5 text-base"
              required
            >
              <option value="" disabled>
                選択してください
              </option>
              {patterns.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.pattern_name}（{p.shift_start}–{p.shift_end}）
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span
              className="text-[11px] tracking-widest uppercase text-ink-muted block mb-1.5"
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              最小人数
            </span>
            <input
              type="number"
              min={0}
              value={requiredMin}
              onChange={(e) => setRequiredMin(e.target.value)}
              className="w-full bg-transparent border-0 border-b border-ink/30 focus:border-brand-600 focus:outline-none px-0 py-1.5 text-base"
              style={{ fontFamily: 'var(--font-mono)' }}
              required
            />
          </label>

          <label className="block">
            <span
              className="text-[11px] tracking-widest uppercase text-ink-muted block mb-1.5"
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              最大人数（任意）
            </span>
            <input
              type="number"
              min={0}
              value={requiredMax}
              onChange={(e) => setRequiredMax(e.target.value)}
              placeholder="空欄で固定"
              className="w-full bg-transparent border-0 border-b border-ink/30 focus:border-brand-600 focus:outline-none px-0 py-1.5 text-base"
              style={{ fontFamily: 'var(--font-mono)' }}
            />
            <span className="mt-1.5 block text-[11px] text-ink-muted leading-relaxed">
              空欄なら最小人数ちょうど（固定）。値を入れると最小〜最大の範囲。
            </span>
          </label>

          {err && (
            <p className="text-xs text-[#a83232] bg-[#a83232]/8 border-l-2 border-[#a83232] px-3 py-2">
              {err}
            </p>
          )}
        </div>

        <div className="px-7 py-4 border-t border-ink/10 flex justify-end gap-2">
          <button
            type="button"
            onClick={attemptClose}
            className="px-4 py-2 text-sm text-ink-muted hover:text-ink transition-colors"
          >
            キャンセル
          </button>
          <button
            type="submit"
            disabled={busy}
            className="px-5 py-2 text-sm bg-brand-900 text-cream-50 hover:bg-[#1a2940] disabled:opacity-50 transition-colors rounded-sm"
          >
            {busy ? '保存中…' : '保存'}
          </button>
        </div>
      </form>
      {discardDialog}
    </ModalShell>
  )
}
