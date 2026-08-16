import { useEffect, useState } from 'react'
import { useDirtyDiscardConfirm } from '../../hooks/useDirtyDiscardConfirm'
import type { PatternChoiceGroup, WorkPattern } from '../../types/api'
import ModalShell from '../common/ModalShell'

interface Props {
  mode: 'create' | 'edit'
  initial: PatternChoiceGroup | null
  patterns: WorkPattern[]
  onClose: () => void
  /**
   * create モードでは複数曜日選択でき、`day_of_weeks` 配列を渡す。
   * 配列要素は number (0=月〜6=日) または null (毎日)。「毎日」は他曜日と排他。
   * edit モードでは単一行更新のため必ず長さ 1。
   * department_id はページ側で付与する。
   */
  onSubmit: (payload: {
    day_of_weeks: (number | null)[]
    min_count: number
    max_count: number
    candidate_pattern_ids: number[]
  }) => Promise<void>
}

// 内部表現: 「毎日」を sentinel `-1` で扱う（Set<number> で扱える + DayTemplateFormModal と同形）。
// payload に詰める時に -1 → null に変換する。
const ALL_WEEKDAY = -1
const SPECIFIC_WEEKDAYS: { value: number; label: string }[] = [
  { value: 0, label: '月' },
  { value: 1, label: '火' },
  { value: 2, label: '水' },
  { value: 3, label: '木' },
  { value: 4, label: '金' },
  { value: 5, label: '土' },
  { value: 6, label: '日' },
]
const EDIT_OPTIONS = [{ value: ALL_WEEKDAY, label: '毎日' }, ...SPECIFIC_WEEKDAYS]

function dowToInternal(dow: number | null): number {
  return dow === null ? ALL_WEEKDAY : dow
}
function internalToDow(value: number): number | null {
  return value === ALL_WEEKDAY ? null : value
}

export default function ChoiceGroupFormModal({
  mode,
  initial,
  patterns,
  onClose,
  onSubmit,
}: Props) {
  // create: 複数曜日 (Set)。edit: 単一値 (number)
  const [selectedDays, setSelectedDays] = useState<Set<number>>(new Set())
  const [editDay, setEditDay] = useState<number>(ALL_WEEKDAY)
  const [minCount, setMinCount] = useState<string>('1')
  const [maxCount, setMaxCount] = useState<string>('1')
  const [selectedPatternIds, setSelectedPatternIds] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (initial) {
      const internal = dowToInternal(initial.day_of_week)
      setEditDay(internal)
      setSelectedDays(new Set([internal]))
      setMinCount(String(initial.min_count))
      setMaxCount(String(initial.max_count))
      setSelectedPatternIds(new Set(initial.candidate_pattern_ids))
    }
  }, [initial])

  const { attemptClose, dialog: discardDialog } = useDirtyDiscardConfirm({
    values: {
      mode,
      editDay,
      selectedDays: Array.from(selectedDays).sort((a, b) => a - b),
      minCount,
      maxCount,
      selectedPatternIds: Array.from(selectedPatternIds).sort((a, b) => a - b),
    },
    onClose,
  })

  function toggleDay(value: number) {
    setSelectedDays((prev) => {
      const next = new Set(prev)
      if (value === ALL_WEEKDAY) {
        // 「毎日」は他曜日と排他
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

  function togglePattern(pid: number) {
    setSelectedPatternIds((prev) => {
      const next = new Set(prev)
      if (next.has(pid)) next.delete(pid)
      else next.add(pid)
      return next
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    const minN = parseInt(minCount, 10)
    const maxN = parseInt(maxCount, 10)
    if (Number.isNaN(minN) || minN < 0) {
      setErr('min_count は 0 以上の整数で入力してください')
      return
    }
    if (Number.isNaN(maxN) || maxN < 0) {
      setErr('max_count は 0 以上の整数で入力してください')
      return
    }
    if (minN > maxN) {
      setErr('min_count は max_count 以下で入力してください')
      return
    }
    if (selectedPatternIds.size === 0) {
      setErr('候補パターンを 1 つ以上選択してください')
      return
    }

    let dayOfWeeks: (number | null)[]
    if (mode === 'edit') {
      dayOfWeeks = [internalToDow(editDay)]
    } else {
      const dows = Array.from(selectedDays)
      if (dows.length === 0) {
        setErr('曜日を 1 つ以上選択してください')
        return
      }
      dayOfWeeks = dows.map(internalToDow)
    }

    setBusy(true)
    try {
      await onSubmit({
        day_of_weeks: dayOfWeeks,
        min_count: minN,
        max_count: maxN,
        candidate_pattern_ids: Array.from(selectedPatternIds),
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
            {mode === 'create' ? '選択グループを追加' : '選択グループを編集'}
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
                    毎日
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
                  複数選択すると、選んだ曜日ごとに同じ内容の選択グループ行を作成します。「毎日」は他曜日と排他。
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

          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span
                className="text-[11px] tracking-widest uppercase text-ink-muted block mb-1.5"
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                最小選択数
              </span>
              <input
                type="number"
                min={0}
                value={minCount}
                onChange={(e) => setMinCount(e.target.value)}
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
                最大選択数
              </span>
              <input
                type="number"
                min={0}
                value={maxCount}
                onChange={(e) => setMaxCount(e.target.value)}
                className="w-full bg-transparent border-0 border-b border-ink/30 focus:border-brand-600 focus:outline-none px-0 py-1.5 text-base"
                style={{ fontFamily: 'var(--font-mono)' }}
                required
              />
            </label>
          </div>

          <div>
            <span
              className="text-[11px] tracking-widest uppercase text-ink-muted block mb-2"
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              候補パターン（複数選択）
            </span>
            {patterns.length === 0 ? (
              <p className="text-xs text-ink-muted">
                先に作業パターンを作成してください
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto border border-ink/10 rounded-sm p-2">
                {patterns.map((p) => (
                  <button
                    type="button"
                    key={p.id}
                    onClick={() => togglePattern(p.id)}
                    className={`px-3 py-1.5 text-xs rounded-sm border transition-all ${
                      selectedPatternIds.has(p.id)
                        ? 'bg-brand-600 text-white border-brand-600'
                        : 'bg-transparent text-ink border-ink/20 hover:border-ink/50'
                    }`}
                  >
                    {p.pattern_name}
                  </button>
                ))}
              </div>
            )}
            <p className="mt-2 text-[11px] text-ink-muted leading-relaxed">
              選択された候補のうち、各日に最小〜最大選択数の範囲で割り当てます。
            </p>
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
