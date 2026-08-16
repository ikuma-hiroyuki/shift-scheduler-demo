import { CSSProperties, useEffect, useMemo, useRef, useState } from 'react'
import { finalizeSchedule, getAssignments } from '../../api/schedules'
import { listWorkPatterns } from '../../api/workPatterns'
import { useWorkPatternGroupsStore } from '../../stores/workPatternGroups'
import { useHolidays } from '../../hooks/useHolidays'
import { useModalDismiss } from '../../hooks/useModalDismiss'
import { cellKey, isPending, useEditorStore } from '../../stores/editor'
import type {
  Schedule,
  ShortageRow,
  WorkPattern,
  WorkPatternGroup,
} from '../../types/api'
import { roleLabel } from '../../constants/employee'

const EMPTY_GROUPS: WorkPatternGroup[] = []
import {
  DEFAULT_GROUP_COLOR,
  isHexColor,
  readableTextColor,
} from '../../constants/groupPalette'
import CellEditPopover from './CellEditPopover'
import CommitBar from './CommitBar'
import CompensatoryPopover from './CompensatoryPopover'
import EditModeToggle from './EditModeToggle'
import EditToast from './EditToast'
import ShortagePopover from './ShortagePopover'

interface Props {
  schedule: Schedule
  /** PARTIAL → GENERATED 確定後に親に通知する。親が schedule を refetch する。 */
  onFinalize?: (updated: Schedule) => void
}

const REST_LABELS = new Set(['割当休日', '●', '○', '有給'])

function cellDisplay(label: string): string {
  if (label === '割当休日') return '□'
  return label
}

const WEEKDAY_JP = ['月', '火', '水', '木', '金', '土', '日']

function getWeekday(year: number, month: number, day: number): number {
  return new Date(year, month - 1, day).getDay()
}

function weekdayLabel(year: number, month: number, day: number): string {
  const wd = getWeekday(year, month, day)
  return WEEKDAY_JP[wd === 0 ? 6 : wd - 1]
}

function dayHeaderClass(
  year: number,
  month: number,
  day: number,
  holidaySet: Set<number>,
): string {
  const wd = getWeekday(year, month, day)
  if (wd === 0 || holidaySet.has(day)) return 'text-rose-200'
  if (wd === 6) return 'text-sky-200'
  return 'text-white'
}

export default function ShiftGrid({ schedule, onFinalize }: Props) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const mode = useEditorStore((s) => s.mode)
  const year = useEditorStore((s) => s.year)
  const month = useEditorStore((s) => s.month)
  const employeeOrder = useEditorStore((s) => s.employeeOrder)
  const employeeNames = useEditorStore((s) => s.employeeNames)
  const cells = useEditorStore((s) => s.cells)
  const serverCells = useEditorStore((s) => s.serverCells)
  const hydrate = useEditorStore((s) => s.hydrate)
  const reset = useEditorStore((s) => s.reset)
  const openCell = useEditorStore((s) => s.openCell)
  const undo = useEditorStore((s) => s.undo)
  const redo = useEditorStore((s) => s.redo)
  const [roles, setRoles] = useState<Map<number, string>>(new Map())
  const [patterns, setPatterns] = useState<WorkPattern[]>([])
  // issue #199: グループは zustand store からサブスクライブ。
  // /work-patterns でグループを編集すると invalidate されるので、
  // /shift に戻った瞬間 (focus or store change) に再フェッチが走る。
  // 未ロード時の fallback は安定参照 EMPTY_GROUPS を使う(毎回 [] を作ると
  // selector の identity が変わって無限再レンダーになる)。
  const groups: WorkPatternGroup[] = useWorkPatternGroupsStore(
    (s) => s.groupsByDept[schedule.department_id] ?? EMPTY_GROUPS,
  )
  const fetchGroups = useWorkPatternGroupsStore((s) => s.fetch)
  const { holidaySet, holidayNameMap } = useHolidays(year, month)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    Promise.all([
      getAssignments(schedule.id),
      listWorkPatterns(schedule.department_id),
      fetchGroups(schedule.department_id),
    ])
      .then(([assignments, patternsRes]) => {
        if (cancelled) return
        hydrate(assignments, schedule.id, patternsRes)
        const rmap = new Map<number, string>()
        for (const e of assignments.employees) rmap.set(e.id, e.role)
        setRoles(rmap)
        setPatterns(patternsRes)
      })
      .catch(() => {
        if (!cancelled) setError('詳細データの取得に失敗しました')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [schedule.id, schedule.department_id, hydrate, fetchGroups])

  // issue #199: タブ復帰 / window focus でグループを再フェッチ。
  // 別タブで /work-patterns を編集して /shift タブに戻ったケースを拾う。
  useEffect(() => {
    function refresh() {
      fetchGroups(schedule.department_id, /*force*/ true).catch(() => {
        // 失敗時は表示中の値を維持
      })
    }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [schedule.department_id, fetchGroups])

  const sortedGroups = useMemo(
    () => [...groups].sort((a, b) => a.sort_order - b.sort_order),
    [groups],
  )
  // group.id → hex 色 (DB に保存された色をそのまま使用)
  const groupColorById = useMemo(() => {
    const m = new Map<number, string>()
    for (const g of sortedGroups) {
      const hex = isHexColor(g.color) ? g.color : DEFAULT_GROUP_COLOR
      m.set(g.id, hex)
    }
    return m
  }, [sortedGroups])
  const patternIdToGroupId = useMemo(() => {
    const m = new Map<number, number>()
    for (const p of patterns) m.set(p.id, p.group_id)
    return m
  }, [patterns])

  // セル/凡例の見た目を決定。グループ由来は inline style(任意 hex 対応)、
  // REST/empty は class ベースの既存挙動を維持。
  const cellAppearance = (
    label: string,
    patternId: number | null,
  ): { className: string; style?: CSSProperties } => {
    if (!label) return { className: '' }
    if (REST_LABELS.has(label)) {
      return { className: 'bg-red-50 text-red-600' }
    }
    if (patternId != null) {
      const gid = patternIdToGroupId.get(patternId)
      if (gid != null) {
        const hex = groupColorById.get(gid)
        if (hex) {
          return {
            className: '',
            style: { backgroundColor: hex, color: readableTextColor(hex) },
          }
        }
      }
    }
    return { className: 'bg-white text-gray-700' }
  }

  useEffect(() => () => reset(), [reset])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (mode !== 'edit') return
      const meta = e.ctrlKey || e.metaKey
      if (!meta) return
      const k = e.key.toLowerCase()
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, undo, redo])

  // PARTIAL 状態: 不足ポジ (フックは早期 return の前に置く)
  const isPartial = schedule.status === 'PARTIAL'
  const shortages: ShortageRow[] = useMemo(
    () => (isPartial ? schedule.shortages ?? [] : []),
    [isPartial, schedule.shortages],
  )
  const shortagesByDay = useMemo(() => {
    const map = new Map<number, ShortageRow[]>()
    for (const s of shortages) {
      const arr = map.get(s.day) ?? []
      arr.push(s)
      map.set(s.day, arr)
    }
    return map
  }, [shortages])
  const totalMissing = useMemo(
    () => shortages.reduce((acc, s) => acc + s.missing, 0),
    [shortages],
  )
  const [shortageOpen, setShortageOpen] = useState<{
    shortage: ShortageRow
    anchorRect: DOMRect
  } | null>(null)
  const [finalizing, setFinalizing] = useState(false)
  const [finalizeError, setFinalizeError] = useState<string | null>(null)
  const canFinalize = isPartial && (schedule.can_finalize ?? false)

  // issue #238: 全画面モード。低縦幅ブラウザでも詳細テーブルを画面いっぱい使う。
  // body scroll lock + Esc キー + focus return は useModalDismiss 任せ
  // (iOS Safari issue #216 教訓: 自前 body.style.overflow = hidden は禁止)。
  const [fullscreen, setFullscreen] = useState(false)
  const overlayRef = useRef<HTMLDivElement>(null)
  useModalDismiss({
    containerRef: overlayRef,
    onClose: () => setFullscreen(false),
    enabled: fullscreen,
  })

  // schedule 切替/loading/error/store reset で「表が消えたのに背景固定のまま」を防ぐ。
  // 早期 return パス (loading/error/store 未 hydrate) に入ったら fullscreen をリセット。
  useEffect(() => {
    if (loading || error || year == null || month == null || employeeOrder.length === 0) {
      setFullscreen(false)
    }
  }, [loading, error, year, month, employeeOrder.length])

  if (loading) {
    return <p className="text-sm text-gray-400 text-center py-8">読み込み中...</p>
  }
  if (error) {
    return <p className="text-sm text-red-500 text-center py-4">{error}</p>
  }
  if (year == null || month == null || employeeOrder.length === 0) return null

  const numDays = new Date(year, month, 0).getDate()
  const days = Array.from({ length: numDays }, (_, i) => i + 1)

  async function handleFinalize() {
    if (finalizing) return
    setFinalizing(true)
    setFinalizeError(null)
    try {
      const updated = await finalizeSchedule(schedule.id)
      // 親が schedule を refetch することで PARTIAL → GENERATED UI に切替。
      // 編集中の pending 編集や undo スタックを破壊しない (window.reload は使わない)。
      if (onFinalize) onFinalize(updated)
      setFinalizing(false)
    } catch (err) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setFinalizeError(detail ?? '確定に失敗しました')
      setFinalizing(false)
    }
  }

  return (
    <div
      ref={overlayRef}
      data-confirm-modal-dismiss="true"
      className={
        fullscreen
          ? 'fixed inset-0 z-40 bg-cream-50 overflow-auto p-6'
          : ''
      }
    >
      <div className="print:hidden">
        <CommitBar />
      </div>

      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-sm font-semibold text-brand-900">
            {year}年{month}月 稼働表詳細（第{schedule.generation_attempt}回）
          </h3>
          {isPartial && (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800 border border-amber-200">
              部分生成 · {totalMissing}名不足
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 print:hidden">
          {isPartial && (
            <button
              type="button"
              onClick={handleFinalize}
              disabled={!canFinalize || finalizing}
              title={
                canFinalize
                  ? 'すべての不足が解消されました。確定して GENERATED に進めます。'
                  : '不足をすべて解消すると確定できます'
              }
              className="px-3 py-1 text-xs font-semibold rounded bg-emerald-100 text-emerald-800 hover:bg-emerald-200 disabled:opacity-50 disabled:cursor-not-allowed border border-emerald-200"
            >
              {finalizing ? '確定中…' : 'シフトを確定'}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              // issue #238: 全画面中に印刷すると fixed inset-0 のオーバーレイが
              // ページレイアウトを乗っ取って印刷崩れする。先に解除してから 1 フレーム後に印刷。
              setFullscreen(false)
              requestAnimationFrame(() => window.print())
            }}
            disabled={mode === 'edit'}
            title={mode === 'edit' ? '編集モード中は印刷できません' : ''}
            className="px-3 py-1 text-xs font-semibold rounded bg-sky-100 text-sky-800 hover:bg-sky-200 disabled:opacity-50"
          >
            印刷
          </button>
          <button
            type="button"
            onClick={() => setFullscreen((v) => !v)}
            aria-pressed={fullscreen}
            className="px-3 py-1 text-xs font-semibold rounded bg-slate-100 text-slate-800 hover:bg-slate-200"
          >
            {fullscreen ? '全画面を閉じる' : '全画面'}
          </button>
          <EditModeToggle />
        </div>
      </div>

      {isPartial && (
        <div className="bg-amber-50 border-l-4 border-amber-400 text-amber-800 px-3 py-2 text-sm mb-3 print:hidden space-y-1">
          <p>
            部分的に作成しました — {totalMissing}名分のポジションが不足しています。
            不足行を確認して手動調整してください。
          </p>
          {schedule.diagnosis && (
            <pre className="whitespace-pre-wrap font-sans text-xs text-amber-900/80 mt-1">
              {schedule.diagnosis}
            </pre>
          )}
        </div>
      )}

      {finalizeError && (
        <div className="bg-red-50 border-l-4 border-red-400 text-red-800 px-3 py-2 text-sm mb-3 print:hidden">
          {finalizeError}
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-3 print:hidden">
        {[
          { label: '□（割当休日）', cls: 'bg-red-50 text-red-600 border border-red-200' },
          { label: '●（希望休）', cls: 'bg-red-50 text-red-600 border border-red-200' },
          { label: '○（仮休）', cls: 'bg-red-50 text-red-600 border border-red-200' },
          { label: '有給', cls: 'bg-red-50 text-red-600 border border-red-200' },
        ].map(({ label, cls }) => (
          <span key={label} className={`text-xs rounded px-2 py-0.5 ${cls}`}>
            {label}
          </span>
        ))}
        {isPartial && (
          <span className="text-xs rounded px-2 py-0.5 bg-red-100 text-red-700 border border-red-300">
            ⚠ ポジ不足
          </span>
        )}
        {sortedGroups.map((g) => {
          const hex = groupColorById.get(g.id) ?? DEFAULT_GROUP_COLOR
          return (
            <span
              key={g.id}
              className="text-xs rounded px-2 py-0.5 border border-ink/10"
              style={{ backgroundColor: hex, color: readableTextColor(hex) }}
            >
              {g.name}
            </span>
          )
        })}
      </div>

      <div
        className={
          'overflow-auto border border-gray-200 rounded-lg print:overflow-visible print:max-h-none print:border-0 print:rounded-none ' +
          (fullscreen ? 'max-h-[calc(100dvh-180px)]' : 'max-h-[60vh] min-h-[320px]')
        }
        style={{ scrollPaddingTop: '36px' }}
      >
        <table className="border-collapse text-[11px] shift-grid-table w-full table-fixed">
          <colgroup>
            <col style={{ width: '88px' }} />
            <col style={{ width: '56px' }} />
            {days.map((d) => (
              <col key={d} />
            ))}
            <col style={{ width: '36px' }} />
            <col style={{ width: '36px' }} />
          </colgroup>
          <thead className="sticky top-0 z-10 shadow-[0_1px_0_rgba(0,0,0,0.08)]">
            <tr>
              <th className="px-2 py-1.5 text-left text-white bg-brand-700 whitespace-nowrap font-medium">
                氏名
              </th>
              <th className="px-2 py-1.5 text-left text-white bg-brand-700 whitespace-nowrap font-medium">
                役職
              </th>
              {days.map((d) => (
                <th
                  key={d}
                  className={`px-0 py-1.5 text-center bg-brand-700 font-medium ${dayHeaderClass(year, month, d, holidaySet)}`}
                  title={holidayNameMap.get(d)}
                >
                  <div className="leading-none">{d}</div>
                  <div className="font-normal text-[9px] leading-none mt-0.5 opacity-80">
                    {weekdayLabel(year, month, d)}
                  </div>
                </th>
              ))}
              <th className="px-1 py-1.5 text-center text-white bg-brand-700 font-medium">
                勤務
              </th>
              <th className="px-1 py-1.5 text-center text-white bg-brand-700 font-medium">
                休日
              </th>
            </tr>
          </thead>
          <tbody>
            {employeeOrder.map((empId, ri) => {
              let workCount = 0
              for (const d of days) {
                const c = cells.get(cellKey(empId, d))
                if (c && c.label && !REST_LABELS.has(c.label)) workCount++
              }
              const restCount = numDays - workCount
              return (
                <tr key={empId} className={ri % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="px-2 py-0.5 whitespace-nowrap font-medium text-brand-900 border-r border-gray-100 truncate print:whitespace-normal print:overflow-visible print:[text-overflow:clip] print:break-all">
                    {employeeNames.get(empId) ?? ''}
                  </td>
                  <td className="px-2 py-0.5 whitespace-nowrap text-ink-muted border-r border-gray-100 truncate print:whitespace-normal print:overflow-visible print:[text-overflow:clip]">
                    {roleLabel(roles.get(empId))}
                  </td>
                  {days.map((d) => {
                    const key = cellKey(empId, d)
                    const c = cells.get(key)
                    const label = c?.label ?? ''
                    const patternId = c?.patternId ?? null
                    const clickable = mode === 'edit'
                    const pending = clickable && isPending(key, cells, serverCells)
                    const appearance = cellAppearance(label, patternId)
                    return (
                      <td
                        key={d}
                        onClick={
                          clickable
                            ? (e) => {
                                const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                                openCell(key, {
                                  top: r.top,
                                  left: r.left,
                                  bottom: r.bottom,
                                  right: r.right,
                                  width: r.width,
                                  height: r.height,
                                })
                              }
                            : undefined
                        }
                        className={
                          `text-center py-0.5 px-0 border-r border-gray-100 font-medium ${appearance.className} ` +
                          (clickable ? 'cursor-pointer hover:ring-2 hover:ring-blue-300 ' : '') +
                          (pending ? 'ring-2 ring-amber-400 ring-inset' : '')
                        }
                        style={appearance.style}
                      >
                        {cellDisplay(label)}
                      </td>
                    )
                  })}
                  <td className="text-center py-0.5 px-1 text-ink font-medium border-r border-gray-100">
                    {workCount}
                  </td>
                  <td className="text-center py-0.5 px-1 text-ink-muted">{restCount}</td>
                </tr>
              )
            })}
          </tbody>
          {isPartial && shortagesByDay.size > 0 && (
            <tfoot className="sticky bottom-0 bg-white shadow-[0_-1px_0_rgba(0,0,0,0.08)]">
              <tr>
                <td className="px-2 py-1 whitespace-nowrap font-semibold text-red-700 border-r border-gray-100">
                  不足
                </td>
                <td className="px-2 py-1 text-center text-red-600 border-r border-gray-100">
                  ⚠
                </td>
                {days.map((d) => {
                  const rows = shortagesByDay.get(d)
                  if (!rows || rows.length === 0) {
                    return (
                      <td
                        key={d}
                        className="px-0 py-1 text-center border-r border-gray-100 bg-white"
                      />
                    )
                  }
                  return (
                    <td
                      key={d}
                      className="px-0.5 py-1 text-center border-r border-gray-100 bg-red-50 align-middle"
                    >
                      <div className="flex flex-col gap-0.5 items-center">
                        {rows.map((sr) => (
                          <button
                            key={sr.pattern_id}
                            type="button"
                            onMouseEnter={(e) => {
                              const rect = (
                                e.currentTarget as HTMLElement
                              ).getBoundingClientRect()
                              setShortageOpen({ shortage: sr, anchorRect: rect })
                            }}
                            onMouseLeave={() => setShortageOpen(null)}
                            onClick={(e) => {
                              // タッチ/キーボード向けフォールバック
                              const rect = (
                                e.currentTarget as HTMLElement
                              ).getBoundingClientRect()
                              setShortageOpen({ shortage: sr, anchorRect: rect })
                            }}
                            aria-label={`${d}日 ${sr.pattern_name} ポジション ${sr.missing}名不足`}
                            className="inline-flex items-center justify-center bg-red-100 text-red-700 border border-red-300 rounded px-1 py-0.5 text-[10px] font-medium hover:bg-red-200 focus:outline-none focus:ring-2 focus:ring-red-400"
                          >
                            {sr.pattern_name}
                          </button>
                        ))}
                      </div>
                    </td>
                  )
                })}
                <td className="px-1 py-1 text-center text-red-700 font-semibold border-r border-gray-100">
                  {totalMissing}
                </td>
                <td className="px-1 py-1" />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <div className="print:hidden">
        <CellEditPopover />
        <CompensatoryPopover />
        <EditToast />
        {shortageOpen && (
          <ShortagePopover
            shortage={shortageOpen.shortage}
            anchorRect={shortageOpen.anchorRect}
            onClose={() => setShortageOpen(null)}
          />
        )}
      </div>
    </div>
  )
}
