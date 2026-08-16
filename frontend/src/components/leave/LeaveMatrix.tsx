import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  createLeaveRequest,
  deleteLeaveRequest,
  listLeaveRequests,
  updateLeaveRequest,
} from '../../api/leaveRequests'
import { roleLabel } from '../../constants/employee'
import { useHolidays } from '../../hooks/useHolidays'
import type { Employee, LeaveRequest, LeaveType } from '../../types/api'

type CellKey = `${number}:${number}`
type CellStatus = 'idle' | 'saving' | 'saved' | 'error'
type CellValue = '' | LeaveType

interface CellInfo {
  id: number | null
  leave_type: CellValue
}

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'] as const

const LEAVE_TYPE_LABEL: Record<LeaveType, string> = {
  REQUESTED: '●',
  TENTATIVE: '○',
  MANDATORY: '有給',
}

const LEAVE_TYPE_VALUES: CellValue[] = ['', 'REQUESTED', 'TENTATIVE', 'MANDATORY']

function cellLabel(v: CellValue): string {
  return v === '' ? '' : LEAVE_TYPE_LABEL[v]
}

function key(empId: number, day: number): CellKey {
  return `${empId}:${day}`
}

interface Props {
  departmentId: number
  year: number
  month: number
  employees: Employee[]
  query: string
  reloadToken: number
  onCellsChanged?: (count: number) => void
}

export default function LeaveMatrix({
  departmentId,
  year,
  month,
  employees,
  query,
  reloadToken,
  onCellsChanged,
}: Props) {
  const [cells, setCells] = useState<Map<CellKey, CellInfo>>(new Map())
  const [cellState, setCellState] = useState<Map<CellKey, CellStatus>>(new Map())
  const [cellError, setCellError] = useState<Map<CellKey, string>>(new Map())
  const [loading, setLoading] = useState(false)
  const { holidaySet, holidayNameMap } = useHolidays(year, month)

  const daysInMonth = useMemo(() => new Date(year, month, 0).getDate(), [year, month])

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const list: LeaveRequest[] = await listLeaveRequests({
        department_id: departmentId,
        year,
        month,
      })
      const m = new Map<CellKey, CellInfo>()
      for (const r of list) {
        m.set(key(r.employee_id, r.day), { id: r.id, leave_type: r.leave_type })
      }
      setCells(m)
      setCellState(new Map())
      setCellError(new Map())
    } finally {
      setLoading(false)
    }
  }, [departmentId, year, month])

  useEffect(() => {
    reload()
  }, [reload, reloadToken])

  useEffect(() => {
    onCellsChanged?.(cells.size)
  }, [cells, onCellsChanged])

  function setStatus(k: CellKey, s: CellStatus, err = '') {
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

  function clearSavedAfter(k: CellKey) {
    setTimeout(() => {
      setCellState((prev) => {
        if (prev.get(k) !== 'saved') return prev
        const next = new Map(prev)
        next.delete(k)
        return next
      })
    }, 800)
  }

  async function commit(empId: number, day: number, next: CellValue) {
    const k = key(empId, day)
    const current = cells.get(k) ?? { id: null, leave_type: '' as CellValue }
    if (next === current.leave_type) return

    setStatus(k, 'saving')
    try {
      if (next === '' && current.id !== null) {
        await deleteLeaveRequest(current.id)
        setCells((prev) => {
          const m = new Map(prev)
          m.delete(k)
          return m
        })
      } else if (next !== '' && current.id !== null) {
        const updated = await updateLeaveRequest(current.id, { leave_type: next })
        setCells((prev) => {
          const m = new Map(prev)
          m.set(k, { id: updated.id, leave_type: updated.leave_type })
          return m
        })
      } else if (next !== '') {
        const created = await createLeaveRequest({
          employee_id: empId,
          year,
          month,
          day,
          leave_type: next,
        })
        setCells((prev) => {
          const m = new Map(prev)
          m.set(k, { id: created.id, leave_type: created.leave_type })
          return m
        })
      }
      setStatus(k, 'saved')
      clearSavedAfter(k)
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        '保存失敗'
      setStatus(k, 'error', msg)
    }
  }

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

  const dayHeaders = useMemo(
    () =>
      Array.from({ length: daysInMonth }, (_, i) => {
        const day = i + 1
        const weekday = new Date(year, month - 1, day).getDay()
        return { day, weekday }
      }),
    [year, month, daysInMonth],
  )

  return (
    <div className="bg-cream-50 border border-ink/10 rounded-sm overflow-x-auto">
      {loading ? (
        <div className="text-center py-10 text-xs text-ink-muted">読み込み中…</div>
      ) : filteredEmployees.length === 0 ? (
        <div className="text-center py-10 text-sm text-ink-muted">
          該当する従業員がいません
        </div>
      ) : (
        <table className="text-xs border-separate border-spacing-0 table-fixed min-w-full">
          <colgroup>
            <col style={{ width: '110px' }} />
            {dayHeaders.map(({ day }) => (
              <col key={day} style={{ width: '28px' }} />
            ))}
          </colgroup>
          <thead>
            <tr
              className="text-[10px] tracking-[0.2em] uppercase text-ink-muted"
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              <th className="sticky left-0 z-20 bg-cream-50 text-left px-2 py-1.5 font-normal border-b border-ink/10">
                従業員
              </th>
              {dayHeaders.map(({ day, weekday }) => {
                const isHoliday = holidaySet.has(day)
                const isSun = isHoliday || weekday === 0
                const isSat = !isHoliday && weekday === 6
                return (
                  <th
                    key={day}
                    className={`px-0 py-1.5 font-normal border-b border-ink/10 text-center ${
                      isSat ? 'bg-[#3a6b6b]/[0.06]' : isSun ? 'bg-[#a83232]/[0.06]' : ''
                    }`}
                    title={isHoliday ? holidayNameMap.get(day) : undefined}
                  >
                    <div
                      className={`text-[11px] font-medium leading-none tracking-normal ${
                        isSat
                          ? 'text-[#3a6b6b]'
                          : isSun
                            ? 'text-[#a83232]'
                            : 'text-brand-900'
                      }`}
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {day}
                    </div>
                    <div
                      className={`text-[9px] mt-0.5 leading-none ${
                        isSat
                          ? 'text-[#3a6b6b]'
                          : isSun
                            ? 'text-[#a83232]'
                            : 'text-ink-muted'
                      }`}
                    >
                      {WEEKDAY_LABELS[weekday]}
                    </div>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {filteredEmployees.map((emp, i) => {
              const stripe = i % 2 === 1
              return (
                <tr key={emp.id} className={stripe ? 'bg-ink/[0.015]' : ''}>
                  <td
                    className={`sticky left-0 z-10 px-2 py-0.5 border-b border-ink/5 ${
                      stripe ? 'bg-cream-100' : 'bg-cream-50'
                    }`}
                  >
                    <div className="text-brand-900 font-medium whitespace-nowrap text-[12px] leading-tight">
                      {emp.name}
                    </div>
                    <div
                      className="text-[9px] text-ink-muted leading-tight"
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {emp.employee_number} · {roleLabel(emp.role)}
                    </div>
                  </td>
                  {dayHeaders.map(({ day, weekday }) => {
                    const k = key(emp.id, day)
                    const cell = cells.get(k)
                    const value: CellValue = cell?.leave_type ?? ''
                    const status = cellState.get(k) ?? 'idle'
                    const err = cellError.get(k)
                    const isHoliday = holidaySet.has(day)
                    const isSun = isHoliday || weekday === 0
                    const isSat = !isHoliday && weekday === 6
                    return (
                      <td
                        key={day}
                        className={`px-0 py-0.5 border-b border-ink/5 text-center ${
                          isSat
                            ? 'bg-[#3a6b6b]/[0.04]'
                            : isSun
                              ? 'bg-[#a83232]/[0.04]'
                              : ''
                        }`}
                        title={err ?? undefined}
                      >
                        <LeaveCellSelect
                          value={value}
                          status={status}
                          onChange={(v) => commit(emp.id, day, v)}
                        />
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

function LeaveCellSelect({
  value,
  status,
  onChange,
}: {
  value: CellValue
  status: CellStatus
  onChange: (v: CellValue) => void
}) {
  const ring =
    status === 'saving'
      ? 'ring-1 ring-brand-600/40'
      : status === 'saved'
        ? 'ring-1 ring-[#3a6b6b]/40 bg-[#3a6b6b]/5'
        : status === 'error'
          ? 'ring-1 ring-[#a83232]/60 bg-[#a83232]/5'
          : ''

  const tone =
    value === 'REQUESTED'
      ? 'text-brand-900 font-semibold'
      : value === 'TENTATIVE'
        ? 'text-ink-muted font-medium'
        : value === 'MANDATORY'
          ? 'text-brand-600 font-semibold'
          : 'text-ink-muted/30'

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as CellValue)}
      className={`w-full h-7 text-[11px] text-center rounded-sm bg-transparent border border-ink/10 focus:border-brand-600 focus:outline-none transition-all appearance-none cursor-pointer px-0 ${ring} ${tone}`}
      style={{
        fontFamily: 'var(--font-mono)',
        fontVariantNumeric: 'tabular-nums',
        textAlignLast: 'center',
      }}
    >
      {LEAVE_TYPE_VALUES.map((v) => (
        <option key={v} value={v}>
          {cellLabel(v)}
        </option>
      ))}
    </select>
  )
}
