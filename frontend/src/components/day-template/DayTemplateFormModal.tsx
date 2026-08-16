import { useEffect, useState } from 'react'
import { useDirtyDiscardConfirm } from '../../hooks/useDirtyDiscardConfirm'
import type { DayTemplate, WorkPattern } from '../../types/api'
import ModalShell from '../common/ModalShell'

interface Props {
  mode: 'create' | 'edit'
  initial: DayTemplate | null
  patterns: WorkPattern[]
  onClose: () => void
  /**
   * create モードでは複数曜日選択でき、`day_of_weeks` 配列を渡す。
   * edit モードでは単一行更新のため必ず長さ 1。
   * department_id はページ側で付与する。
   */
  onSubmit: (payload: {
    day_of_weeks: number[]
    pattern_id: number
    required_min: number
    required_max: number | null
  }) => Promise<void>
}

const ALL_WEEKDAY = -1
const SPECIFIC_WEEKDAYS: { value: number; label: string }[] = [
  { value: 0, label: '月' },
  { value: 1, label: '火' },
  { value: 2, label: '水' },
  { value: 3, label: '木' },
  { value: 4, label: '金' },
  { value: 5, label: '土' },
  { value: 6, label: '日' },
  { value: 7, label: '祝' },
]
const EDIT_OPTIONS = [{ value: ALL_WEEKDAY, label: '全曜日' }, ...SPECIFIC_WEEKDAYS]

export default function DayTemplateFormModal({
  mode,
  initial,
  patterns,
  onClose,
  onSubmit,
}: Props) {
  // create: 複数曜日 (Set)。edit: 単一値 (number)
  const [selectedDays, setSelectedDays] = useState<Set<number>>(new Set())
  const [editDay, setEditDay] = useState<number>(ALL_WEEKDAY)
  const [patternId, setPatternId] = useState<number | null>(
    patterns[0]?.id ?? null,
  )
  const [requiredMin, setRequiredMin] = useState<string>('1')
  const [requiredMax, setRequiredMax] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (initial) {
      setEditDay(initial.day_of_week)
      setSelectedDays(new Set([initial.day_of_week]))
      setPatternId(initial.pattern_id)
      setRequiredMin(String(initial.required_min))
      setRequiredMax(initial.required_max == null ? '' : String(initial.required_max))
    } else if (patterns.length > 0 && patternId === null) {
      setPatternId(patterns[0].id)
    }
  }, [initial, patterns, patternId])

  const { attemptClose, dialog: discardDialog } = useDirtyDiscardConfirm({
    values: {
      mode,
      editDay,
      selectedDays: Array.from(selectedDays).sort((a, b) => a - b),
      patternId,
      requiredMin,
      requiredMax,
    },
    onClose,
  })

  function toggleDay(value: number) {
    setSelectedDays((prev) => {
      const next = new Set(prev)
      if (value === ALL_WEEKDAY) {
        // 「全曜日」は他曜日と排他
        if (next.has(ALL_WEEKDAY)) next.delete(ALL_WEEKDAY)
        else {
          next.clear()
          next.add(ALL_WEEKDAY)
        }
      } else {
        next.delete(ALL_WEEKDAY)
        if (next.has(value)) next.delete(value)
        else next.add(value)
      }
      return next
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
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

    let dayOfWeeks: number[]
    if (mode === 'edit') {
      dayOfWeeks = [editDay]
    } else {
      dayOfWeeks = Array.from(selectedDays)
      if (dayOfWeeks.length === 0) {
        setErr('曜日を 1 つ以上選択してください')
        return
      }
    }

    setBusy(true)
    try {
      await onSubmit({
        day_of_weeks: dayOfWeeks,
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
            {mode === 'create' ? '曜日別テンプレートを追加' : '曜日別テンプレートを編集'}
          </h2>
          <span
            className="text-[10px] tracking-[0.3em] uppercase text-brand-600"
            style={{ fontFamily: 'var(--font-mono)' }}
          >
            {mode === 'create' ? 'New' : 'Edit'}
          </span>
        </div>

        <div className="px-7 py-5 space-y-5">
          <div>
            <span
              className="text-[11px] tracking-widest uppercase text-ink-muted block mb-2"
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              曜日
            </span>
            {mode === 'create' ? (
              <>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => toggleDay(ALL_WEEKDAY)}
                    className={`px-3 py-1.5 text-xs rounded-sm border transition-all ${
                      selectedDays.has(ALL_WEEKDAY)
                        ? 'bg-brand-900 text-cream-50 border-brand-900'
                        : 'bg-transparent text-ink border-ink/20 hover:border-ink/50'
                    }`}
                  >
                    全曜日
                  </button>
                  <span className="w-px h-6 bg-ink/15 mx-1" aria-hidden="true" />
                  {SPECIFIC_WEEKDAYS.map((d) => (
                    <button
                      type="button"
                      key={d.value}
                      onClick={() => toggleDay(d.value)}
                      className={`w-10 h-9 text-sm rounded-sm border transition-all ${
                        selectedDays.has(d.value)
                          ? 'bg-brand-600 text-white border-brand-600'
                          : 'bg-transparent text-ink border-ink/20 hover:border-ink/50'
                      }`}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-ink-muted leading-relaxed">
                  複数選択すると、選んだ曜日ごとにテンプレート行を作成します。「全曜日」は他曜日と排他。
                  <br />
                  <span className="text-ink-muted">
                    ※ 同じ部門に「祝」の行があると祝日には祝が優先され、「全曜日」は祝日に適用されません。「祝」の行が無ければ祝日も「全曜日」に含まれます（一覧上部「ヘルプ」参照）。
                  </span>
                </p>
              </>
            ) : (
              <select
                value={editDay}
                onChange={(e) => setEditDay(Number(e.target.value))}
                className="w-full bg-transparent border-0 border-b border-ink/30 focus:border-brand-600 focus:outline-none px-0 py-1.5 text-base"
              >
                {EDIT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            )}
          </div>

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
