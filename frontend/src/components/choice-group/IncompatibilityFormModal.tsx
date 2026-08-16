import { useEffect, useState } from 'react'
import type { PatternIncompatibility, WorkPattern } from '../../types/api'
import ModalShell from '../common/ModalShell'
import { useDirtyDiscardConfirm } from '../../hooks/useDirtyDiscardConfirm'

interface Props {
  mode: 'create' | 'edit'
  initial: PatternIncompatibility | null
  patterns: WorkPattern[]
  onClose: () => void
  /** department_id はページ側で付与する */
  onSubmit: (payload: {
    pattern_id_a: number
    pattern_id_b: number
  }) => Promise<void>
}

/**
 * 非両立ルールの新規作成 / 編集モーダル。
 * mode='create' で新規追加、mode='edit' で initial の値をプリフィルして編集する。
 */
export default function IncompatibilityFormModal({
  mode,
  initial,
  patterns,
  onClose,
  onSubmit,
}: Props) {
  const [patternA, setPatternA] = useState<number | null>(patterns[0]?.id ?? null)
  const [patternB, setPatternB] = useState<number | null>(patterns[1]?.id ?? null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (initial) {
      setPatternA(initial.pattern_id_a)
      setPatternB(initial.pattern_id_b)
    }
  }, [initial])

  const { attemptClose, dialog: discardDialog } = useDirtyDiscardConfirm({
    values: { patternA, patternB },
    onClose,
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    if (patternA === null || patternB === null) {
      setErr('両方のパターンを選択してください')
      return
    }
    if (patternA === patternB) {
      setErr('別々のパターンを選択してください')
      return
    }
    setBusy(true)
    try {
      await onSubmit({ pattern_id_a: patternA, pattern_id_b: patternB })
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
            {mode === 'create' ? '非両立ルールを追加' : '非両立ルールを編集'}
          </h2>
          <span
            className="text-[10px] tracking-[0.3em] uppercase text-brand-600"
            style={{ fontFamily: 'var(--font-mono)' }}
          >
            {mode === 'create' ? 'New' : 'Edit'}
          </span>
        </div>

        <div className="px-7 py-5 space-y-5">
          <p className="text-[12px] text-ink-muted leading-relaxed border-l-2 border-brand-600 pl-3">
            指定した 2 つの作業パターンを「同日に同時使用しない」ルールとして登録します。
          </p>

          <label className="block">
            <span
              className="text-[11px] tracking-widest uppercase text-ink-muted block mb-1.5"
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              パターン A
            </span>
            <select
              value={patternA ?? ''}
              onChange={(e) => setPatternA(Number(e.target.value))}
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
              パターン B
            </span>
            <select
              value={patternB ?? ''}
              onChange={(e) => setPatternB(Number(e.target.value))}
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
