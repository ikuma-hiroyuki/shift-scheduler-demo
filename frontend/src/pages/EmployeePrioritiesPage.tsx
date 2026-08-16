import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { listDepartments } from '../api/departments'
import { listEmployees } from '../api/employees'
import { listWorkPatterns } from '../api/workPatterns'
import {
  createEmployeePriority,
  deleteEmployeePriority,
  listEmployeePriorities,
  updateEmployeePriority,
} from '../api/employeePriorities'
import EmployeePriorityCsvUpload from '../components/employee-priority/EmployeePriorityCsvUpload'
import PageHeader from '../components/common/PageHeader'
import { roleLabel } from '../constants/employee'
import type { Department, Employee, WorkPattern } from '../types/api'

type CellKey = `${number}:${number}`
type CellState = 'idle' | 'saving' | 'saved' | 'error'

interface CellInfo {
  id: number | null
  priority: number
}

function key(empId: number, patId: number): CellKey {
  return `${empId}:${patId}`
}

/**
 * FastAPI のエラー応答 detail を表示用文字列に整形する。
 * - 文字列: そのまま
 * - { message: ... }: message を取り出す（issue #91 で導入した汎用形式）
 * - pydantic 422 の list 形式 [{loc, msg, type}, ...]: 最初の msg を取り出す
 * - それ以外: 汎用エラー文言
 */
function formatErrorDetail(detail: unknown): string {
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    const first = detail[0]
    if (first && typeof first === 'object' && 'msg' in first) {
      return String((first as { msg: unknown }).msg)
    }
    return '入力値を確認してください'
  }
  if (detail && typeof detail === 'object' && 'message' in detail) {
    return String((detail as { message: unknown }).message)
  }
  return '保存失敗'
}

const SHIFT_TONE: Record<number, string> = {
  1: 'text-[#3a6b6b]',
  2: 'text-brand-900',
  3: 'text-[#7a4a1a]',
}
const SHIFT_LABEL: Record<number, string> = { 1: '早', 2: 'フル', 3: '遅' }

export default function EmployeePrioritiesPage() {
  const [departments, setDepartments] = useState<Department[]>([])
  const [departmentId, setDepartmentId] = useState<number | null>(null)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [patterns, setPatterns] = useState<WorkPattern[]>([])
  const [cells, setCells] = useState<Map<CellKey, CellInfo>>(new Map())
  const [cellState, setCellState] = useState<Map<CellKey, CellState>>(new Map())
  const [cellError, setCellError] = useState<Map<CellKey, string>>(new Map())
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')

  // 初期: 部門一覧
  useEffect(() => {
    listDepartments().then((d) => {
      setDepartments(d)
      if (d.length > 0 && departmentId === null) setDepartmentId(d[0].id)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const reload = useCallback(async () => {
    if (departmentId === null) return
    setLoading(true)
    try {
      const [emps, pats, prios] = await Promise.all([
        listEmployees(),
        listWorkPatterns(departmentId),
        listEmployeePriorities(departmentId),
      ])
      setEmployees(emps.filter((e) => e.department_id === departmentId))
      // パターンは API が group.sort_order, pattern.sort_order 順で返すのでそのまま採用
      setPatterns(pats)
      const m = new Map<CellKey, CellInfo>()
      for (const p of prios) {
        m.set(key(p.employee_id, p.pattern_id), { id: p.id, priority: p.priority })
      }
      setCells(m)
      setCellState(new Map())
      setCellError(new Map())
    } finally {
      setLoading(false)
    }
  }, [departmentId])

  useEffect(() => {
    reload()
  }, [reload])

  const filteredEmployees = useMemo(() => {
    const q = query.trim()
    if (!q) return employees
    return employees.filter(
      (e) =>
        e.name.includes(q) ||
        String(e.employee_number).includes(q) ||
        roleLabel(e.role).includes(q),
    )
  }, [employees, query])

  function setCellStatus(k: CellKey, s: CellState, err = '') {
    setCellState((prev) => {
      const next = new Map(prev)
      next.set(k, s)
      return next
    })
    setCellError((prev) => {
      const next = new Map(prev)
      if (err) next.set(k, err)
      else next.delete(k)
      return next
    })
  }

  async function commit(empId: number, patId: number, raw: string) {
    const k = key(empId, patId)
    const current = cells.get(k) ?? { id: null, priority: 0 }
    const trimmed = raw.trim()
    const parsed = trimmed === '' ? 0 : Number(trimmed)
    // 入力フォーマットの sanity（数値かどうか）のみ client で確認。
    // 値域・整数性は backend の pydantic validator が真の判定者（issue #91）。
    if (Number.isNaN(parsed)) {
      setCellStatus(k, 'error', '数値で入力してください')
      return
    }
    if (parsed === current.priority) return // 変化なし

    setCellStatus(k, 'saving')
    try {
      if (current.id !== null && parsed === 0) {
        // 既存 → 削除
        const updated = await updateEmployeePriority(current.id, { priority: 0 })
        // updated は null
        if (updated !== null) {
          // 念のためフォールバック
          await deleteEmployeePriority(current.id)
        }
        setCells((prev) => {
          const m = new Map(prev)
          m.delete(k)
          return m
        })
      } else if (current.id !== null) {
        // 既存 → 更新
        const updated = await updateEmployeePriority(current.id, { priority: parsed })
        if (updated) {
          setCells((prev) => {
            const m = new Map(prev)
            m.set(k, { id: updated.id, priority: updated.priority })
            return m
          })
        }
      } else if (parsed > 0) {
        // 未登録 → 作成
        const created = await createEmployeePriority({
          employee_id: empId,
          pattern_id: patId,
          priority: parsed,
        })
        setCells((prev) => {
          const m = new Map(prev)
          m.set(k, { id: created.id, priority: created.priority })
          return m
        })
      } else {
        // 未登録 + 0 → no-op
      }
      setCellStatus(k, 'saved')
      // 800ms 後に idle へ戻す
      setTimeout(() => {
        setCellState((prev) => {
          if (prev.get(k) !== 'saved') return prev
          const next = new Map(prev)
          next.delete(k)
          return next
        })
      }, 800)
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
      setCellStatus(k, 'error', formatErrorDetail(detail))
    }
  }

  const currentDept = departments.find((d) => d.id === departmentId)
  const totalSet = useMemo(
    () => Array.from(cells.values()).filter((c) => c.priority > 0).length,
    [cells],
  )

  return (
    <div className="min-h-screen">
      <div className="max-w-[1400px] mx-auto px-8 py-10">
        <PageHeader
          title="優先作業パターン"
          description="従業員ごとの作業パターン優先度（0〜10）。値が高いほど稼働表生成時に優先して割り当てられます。"
          rightSlot={
            <>
              <div
                className="text-[10px] tracking-[0.3em] uppercase text-ink-muted"
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                Set / Cells
              </div>
              <div
                className="text-3xl font-medium text-brand-900 mt-1"
                style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}
              >
                {totalSet}
                <span className="text-base text-ink-muted">
                  /{filteredEmployees.length * patterns.length}
                </span>
              </div>
            </>
          }
        />

        <div className="grid grid-cols-1 gap-6">
          {/* dept + matrix */}
          <div className="space-y-4 min-w-0">
            <div className="bg-cream-50 border border-ink/10 rounded-sm px-6 py-4 flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-3">
                <span
                  className="text-[10px] tracking-[0.3em] uppercase text-ink-muted"
                  style={{ fontFamily: 'var(--font-mono)' }}
                >
                  部門
                </span>
                <select
                  value={departmentId ?? ''}
                  onChange={(e) => setDepartmentId(Number(e.target.value))}
                  className="bg-transparent border-0 border-b border-ink/30 focus:border-brand-600 focus:outline-none px-0 py-1 text-sm font-medium"
                >
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex-1 min-w-[180px]">
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="氏名・社員番号で従業員絞り込み"
                  className="w-full bg-transparent border-0 border-b border-ink/15 focus:border-brand-600 focus:outline-none px-0 py-1 text-sm placeholder:text-ink-muted/60"
                />
              </div>
              <span
                className="text-[10px] tracking-[0.25em] uppercase text-ink-muted"
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                0 = 未設定 · 10 = 最優先
              </span>
            </div>

            {departmentId !== null && currentDept && (
              <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
                <EmployeePriorityCsvUpload
                  departmentId={departmentId}
                  onImported={reload}
                />
                <div className="bg-cream-50 border border-ink/10 rounded-sm px-4 py-3 text-[11px] text-ink-muted leading-relaxed">
                  <span
                    className="block text-[10px] tracking-[0.25em] uppercase text-brand-600 mb-1"
                    style={{ fontFamily: 'var(--font-mono)' }}
                  >
                    Note · CSV 一括インポート
                  </span>
                  選択中の部門「<strong>{currentDept.name}</strong>」の従業員・作業パターンに対して反映します。
                </div>
              </div>
            )}

            <div className="bg-cream-50 border border-ink/10 rounded-sm overflow-x-auto">
              {loading ? (
                <div className="text-center py-10 text-xs text-ink-muted">読み込み中…</div>
              ) : patterns.length === 0 ? (
                <div className="text-center py-10 text-sm text-ink-muted">
                  この部門に作業パターンが登録されていません
                </div>
              ) : filteredEmployees.length === 0 ? (
                <div className="text-center py-10 text-sm text-ink-muted">
                  該当する従業員がいません
                </div>
              ) : (
                <table className="text-sm border-separate border-spacing-0">
                  <thead>
                    <tr
                      className="text-[10px] tracking-[0.2em] uppercase text-ink-muted"
                      style={{ fontFamily: 'var(--font-mono)' }}
                    >
                      <th className="sticky left-0 z-20 bg-cream-50 text-left px-5 py-3 font-normal border-b border-ink/10 min-w-[180px]">
                        従業員
                      </th>
                      {patterns.map((p) => (
                        <th
                          key={p.id}
                          className="px-2 py-3 font-normal border-b border-ink/10 text-center"
                          title={`${p.pattern_name} · ${SHIFT_LABEL[p.shift_type]}番 (${p.shift_start}-${p.shift_end})`}
                        >
                          <div className="text-brand-900 font-medium text-[12px] tracking-normal" style={{ fontFamily: 'var(--font-mono)' }}>
                            {p.pattern_name}
                          </div>
                          <div className={`text-[9px] mt-0.5 ${SHIFT_TONE[p.shift_type] ?? ''}`}>
                            {SHIFT_LABEL[p.shift_type]}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEmployees.map((emp, i) => (
                      <tr
                        key={emp.id}
                        className={i % 2 === 1 ? 'bg-ink/[0.015]' : ''}
                      >
                        <td
                          className={`sticky left-0 z-10 px-5 py-2 border-b border-ink/5 ${
                            i % 2 === 1 ? 'bg-cream-100' : 'bg-cream-50'
                          }`}
                        >
                          <div className="text-brand-900 font-medium whitespace-nowrap">
                            {emp.name}
                          </div>
                          <div
                            className="text-[10px] text-ink-muted"
                            style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}
                          >
                            {emp.employee_number} · {roleLabel(emp.role)}
                          </div>
                        </td>
                        {patterns.map((p) => {
                          const k = key(emp.id, p.id)
                          const cell = cells.get(k)
                          const value = cell?.priority ?? 0
                          const status = cellState.get(k) ?? 'idle'
                          const err = cellError.get(k)
                          return (
                            <td
                              key={p.id}
                              className="px-1 py-1 border-b border-ink/5 text-center"
                              title={err ?? undefined}
                            >
                              <PriorityInput
                                value={value}
                                status={status}
                                onCommit={(raw) => commit(emp.id, p.id, raw)}
                              />
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="text-[11px] text-ink-muted leading-relaxed border-l-2 border-brand-600/40 pl-3">
              <span
                className="block text-[10px] tracking-[0.25em] uppercase text-brand-600 mb-1"
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                Note
              </span>
              セル値の変更は <strong>フォーカスアウトまたは Enter</strong> で保存されます。
              <strong>0</strong> を入力すると、その優先度設定は削除されます。
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}

function PriorityInput({
  value,
  status,
  onCommit,
}: {
  value: number
  status: CellState
  onCommit: (raw: string) => void
}) {
  const [draft, setDraft] = useState<string>(value === 0 ? '' : String(value))
  // Escape 押下後に発生する blur では commit を行わない（cancel 意図の維持）。
  // 旧実装は client 側の値域チェックが Escape 後の commit を握り潰していたが、
  // issue #91 で client validation を削った結果、明示的な抑止が必要になった。
  const cancellingRef = useRef(false)

  // 親 value が外部から変わったら同期
  useEffect(() => {
    setDraft(value === 0 ? '' : String(value))
  }, [value])

  const ring =
    status === 'saving'
      ? 'ring-1 ring-brand-600/40'
      : status === 'saved'
        ? 'ring-1 ring-[#3a6b6b]/40 bg-[#3a6b6b]/5'
        : status === 'error'
          ? 'ring-1 ring-[#a83232]/60 bg-[#a83232]/5'
          : ''
  const tone =
    value >= 8
      ? 'text-brand-600 font-semibold'
      : value >= 5
        ? 'text-brand-900 font-medium'
        : value > 0
          ? 'text-ink-muted'
          : 'text-ink-muted/30'

  return (
    <input
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (cancellingRef.current) {
          cancellingRef.current = false
          return
        }
        onCommit(draft)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          ;(e.target as HTMLInputElement).blur()
        } else if (e.key === 'Escape') {
          cancellingRef.current = true
          setDraft(value === 0 ? '' : String(value))
          ;(e.target as HTMLInputElement).blur()
        }
      }}
      className={`w-12 h-9 text-center rounded-sm bg-transparent border border-ink/10 focus:border-brand-600 focus:outline-none transition-all ${ring} ${tone}`}
      style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}
    />
  )
}
