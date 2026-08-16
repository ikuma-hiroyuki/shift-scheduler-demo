import { useEffect, useState } from 'react'
import type { WorkPattern, WorkPatternGroup } from '../../types/api'
import ModalShell from '../common/ModalShell'
import { useDirtyDiscardConfirm } from '../../hooks/useDirtyDiscardConfirm'

interface Props {
  mode: 'create' | 'edit'
  initial: WorkPattern | null
  group: WorkPatternGroup
  onClose: () => void
  onSubmit: (payload: {
    pattern_name: string
    shift_type: number
    shift_start: string
    shift_end: string
  }) => Promise<void>
}

const SHIFTS: { v: number; label: string }[] = [
  { v: 1, label: '早番' },
  { v: 2, label: 'フル番' },
  { v: 3, label: '遅番' },
]

const TIME_RE = /^\d{2}:\d{2}$/

export default function WorkPatternFormModal({
  mode,
  initial,
  group,
  onClose,
  onSubmit,
}: Props) {
  const [patternName, setPatternName] = useState(() => initial?.pattern_name ?? '')
  const [shiftType, setShiftType] = useState<number>(() => initial?.shift_type ?? 2)
  const [start, setStart] = useState(() => initial?.shift_start ?? '09:00')
  const [end, setEnd] = useState(() => initial?.shift_end ?? '18:00')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (initial) {
      setPatternName(initial.pattern_name)
      setShiftType(initial.shift_type)
      setStart(initial.shift_start)
      setEnd(initial.shift_end)
    }
  }, [initial])

  const { attemptClose, dialog: discardDialog } = useDirtyDiscardConfirm({
    values: { patternName, shiftType, start, end },
    onClose,
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    if (!patternName.trim()) {
      setErr('作業パターン名を入力してください')
      return
    }
    if (!TIME_RE.test(start) || !TIME_RE.test(end)) {
      setErr('時刻は HH:MM 形式で入力してください')
      return
    }
    setBusy(true)
    try {
      await onSubmit({
        pattern_name: patternName.trim(),
        shift_type: shiftType,
        shift_start: start,
        shift_end: end,
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
            {mode === 'create' ? '作業パターンを追加' : '作業パターンを編集'}
          </h2>
          <span
            className="text-[10px] tracking-[0.3em] uppercase text-brand-600"
            style={{ fontFamily: 'var(--font-mono)' }}
          >
            Group · {group.name}
          </span>
        </div>

        <div className="px-7 py-5 space-y-5">
          <label className="block">
            <span
              className="text-[11px] tracking-widest uppercase text-ink-muted block mb-1.5"
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              作業パターン名
            </span>
            <input
              type="text"
              value={patternName}
              onChange={(e) => setPatternName(e.target.value)}
              placeholder="例: A1 / A2"
              className="w-full bg-transparent border-0 border-b border-ink/30 focus:border-brand-600 focus:outline-none px-0 py-1.5 text-base"
              required
              autoFocus
            />
          </label>

          <div>
            <span
              className="text-[11px] tracking-widest uppercase text-ink-muted block mb-2"
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              番型
            </span>
            <div className="flex gap-1.5">
              {SHIFTS.map((s) => (
                <button
                  type="button"
                  key={s.v}
                  onClick={() => setShiftType(s.v)}
                  className={`px-4 py-1.5 text-xs rounded-sm border transition-all ${
                    shiftType === s.v
                      ? 'bg-brand-900 text-cream-50 border-brand-900'
                      : 'bg-transparent text-ink border-ink/20 hover:border-ink/50'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span
                className="text-[11px] tracking-widest uppercase text-ink-muted block mb-1.5"
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                開始
              </span>
              <input
                type="time"
                value={start}
                onChange={(e) => setStart(e.target.value)}
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
                終了
              </span>
              <input
                type="time"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                className="w-full bg-transparent border-0 border-b border-ink/30 focus:border-brand-600 focus:outline-none px-0 py-1.5 text-base"
                style={{ fontFamily: 'var(--font-mono)' }}
                required
              />
            </label>
          </div>

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
