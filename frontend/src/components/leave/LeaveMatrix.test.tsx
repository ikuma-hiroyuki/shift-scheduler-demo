import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import LeaveMatrix from './LeaveMatrix'
import {
  createLeaveRequest,
  deleteLeaveRequest,
  listLeaveRequests,
  updateLeaveRequest,
} from '../../api/leaveRequests'
import type { Employee, LeaveRequest } from '../../types/api'

vi.mock('../../api/leaveRequests', () => ({
  listLeaveRequests: vi.fn(),
  createLeaveRequest: vi.fn(),
  updateLeaveRequest: vi.fn(),
  deleteLeaveRequest: vi.fn(),
}))
vi.mock('../../api/holidays', () => ({
  listHolidays: vi.fn().mockResolvedValue([]),
}))

const mockList = vi.mocked(listLeaveRequests)
const mockCreate = vi.mocked(createLeaveRequest)
const mockUpdate = vi.mocked(updateLeaveRequest)
const mockDelete = vi.mocked(deleteLeaveRequest)

const EMPLOYEES: Employee[] = [
  {
    id: 1, employee_number: 1001, department_id: 1, name: 'Alice',
    role: 'STAFF', available_days: '0,1,2,3,4,5,6',
    available_shift_types: '1,2,3', consecutive_workable: true, sort_order: 0,
  },
  {
    id: 2, employee_number: 1002, department_id: 1, name: 'Bob',
    role: 'CHIEF', available_days: '0,1,2,3,4,5,6',
    available_shift_types: '1,2,3', consecutive_workable: true, sort_order: 1,
  },
]

const EXISTING: LeaveRequest = {
  id: 100, employee_id: 1, year: 2026, month: 4, day: 15, leave_type: 'REQUESTED',
}

beforeEach(() => {
  mockList.mockReset()
  mockCreate.mockReset()
  mockUpdate.mockReset()
  mockDelete.mockReset()
  mockList.mockResolvedValue([])
})

afterEach(() => {
  vi.clearAllMocks()
})

function defaultProps(over: Partial<React.ComponentProps<typeof LeaveMatrix>> = {}) {
  return {
    departmentId: 1,
    year: 2026,
    month: 4,
    employees: EMPLOYEES,
    query: '',
    reloadToken: 0,
    ...over,
  }
}

// 行 = 従業員、列 = 日付。1セルの select を取得するヘルパ
function selectFor(empId: number, day: number): HTMLSelectElement {
  // 行の特定: row 内に "Alice (1001)" などが見える
  const empName = EMPLOYEES.find((e) => e.id === empId)!.name
  const row = screen.getByText(empName).closest('tr')!
  // tbody の cell index = 1 + (day - 1) （最初は名前列）
  const tds = row.querySelectorAll('td')
  return tds[day].querySelector('select')!
}

// ローディング解除を待つ（行レンダリング完了の合図として従業員名の出現を待つ）
async function waitForRows() {
  await screen.findByText('Alice')
}

// ---------------------------------------------------------------------------

describe('LeaveMatrix — loading / empty', () => {
  it('shows loading message during initial fetch', () => {
    mockList.mockReturnValue(new Promise(() => {})) // never resolves

    render(<LeaveMatrix {...defaultProps()} />)

    expect(screen.getByText('読み込み中…')).toBeInTheDocument()
  })

  it('shows empty message when filtered employees is empty', async () => {
    render(<LeaveMatrix {...defaultProps({ employees: [] })} />)

    expect(await screen.findByText('該当する従業員がいません')).toBeInTheDocument()
  })

  it('filters by search query against name / employee_number / role label', async () => {
    render(<LeaveMatrix {...defaultProps({ query: 'Alice' })} />)

    expect(await screen.findByText('Alice')).toBeInTheDocument()
    expect(screen.queryByText('Bob')).not.toBeInTheDocument()
  })

  it('filters by employee_number string match', async () => {
    render(<LeaveMatrix {...defaultProps({ query: '1002' })} />)

    expect(await screen.findByText('Bob')).toBeInTheDocument()
    expect(screen.queryByText('Alice')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------

describe('LeaveMatrix — initial load', () => {
  it('preloads existing LeaveRequests into cells', async () => {
    mockList.mockResolvedValueOnce([EXISTING])

    render(<LeaveMatrix {...defaultProps()} />)

    await waitFor(() => expect(mockList).toHaveBeenCalledWith({
      department_id: 1, year: 2026, month: 4,
    }))
    await waitForRows()

    const sel = selectFor(1, 15)
    expect(sel.value).toBe('REQUESTED')
  })

  it('reloads when reloadToken changes', async () => {
    const { rerender } = render(<LeaveMatrix {...defaultProps()} />)

    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(1))

    rerender(<LeaveMatrix {...defaultProps({ reloadToken: 1 })} />)

    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2))
  })

  it('fires onCellsChanged with cell count', async () => {
    mockList.mockResolvedValueOnce([
      EXISTING,
      { id: 101, employee_id: 2, year: 2026, month: 4, day: 5, leave_type: 'MANDATORY' },
    ])
    const onChanged = vi.fn()

    render(<LeaveMatrix {...defaultProps({ onCellsChanged: onChanged })} />)

    await waitFor(() => {
      expect(onChanged).toHaveBeenCalledWith(2)
    })
  })
})

// ---------------------------------------------------------------------------

describe('LeaveMatrix — cell editing', () => {
  it('selecting a value on an empty cell calls createLeaveRequest', async () => {
    mockList.mockResolvedValueOnce([])
    mockCreate.mockResolvedValueOnce({
      id: 999, employee_id: 1, year: 2026, month: 4, day: 1, leave_type: 'REQUESTED',
    })

    render(<LeaveMatrix {...defaultProps()} />)

    await waitFor(() => expect(mockList).toHaveBeenCalled())
    await waitForRows()

    const sel = selectFor(1, 1)
    fireEvent.change(sel, { target: { value: 'REQUESTED' } })

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith({
        employee_id: 1, year: 2026, month: 4, day: 1, leave_type: 'REQUESTED',
      })
    })
  })

  it('updating an existing cell to a new leave_type calls updateLeaveRequest', async () => {
    mockList.mockResolvedValueOnce([EXISTING])
    mockUpdate.mockResolvedValueOnce({ ...EXISTING, leave_type: 'MANDATORY' })

    render(<LeaveMatrix {...defaultProps()} />)

    await waitFor(() => {
      expect(selectFor(1, 15).value).toBe('REQUESTED')
    })

    fireEvent.change(selectFor(1, 15), { target: { value: 'MANDATORY' } })

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith(100, { leave_type: 'MANDATORY' })
    })
  })

  it('clearing an existing cell to empty calls deleteLeaveRequest', async () => {
    mockList.mockResolvedValueOnce([EXISTING])
    mockDelete.mockResolvedValueOnce(undefined)

    render(<LeaveMatrix {...defaultProps()} />)

    await waitFor(() => {
      expect(selectFor(1, 15).value).toBe('REQUESTED')
    })

    fireEvent.change(selectFor(1, 15), { target: { value: '' } })

    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith(100))
  })

  it('selecting the same value is a no-op (no API call)', async () => {
    mockList.mockResolvedValueOnce([EXISTING])
    render(<LeaveMatrix {...defaultProps()} />)

    await waitFor(() => {
      expect(selectFor(1, 15).value).toBe('REQUESTED')
    })

    fireEvent.change(selectFor(1, 15), { target: { value: 'REQUESTED' } })

    await new Promise((r) => setTimeout(r, 20))
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockCreate).not.toHaveBeenCalled()
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it('shows error tooltip on save failure', async () => {
    mockList.mockResolvedValueOnce([])
    mockCreate.mockRejectedValueOnce({ response: { data: { detail: '部門 ID 不一致' } } })

    render(<LeaveMatrix {...defaultProps()} />)

    await waitFor(() => expect(mockList).toHaveBeenCalled())
    await waitForRows()

    const sel = selectFor(1, 1)
    fireEvent.change(sel, { target: { value: 'REQUESTED' } })

    await waitFor(() => {
      // td に title 属性でエラーが乗る
      const td = sel.closest('td')!
      expect(td.getAttribute('title')).toBe('部門 ID 不一致')
    })
  })

  it('uses fallback message for opaque errors', async () => {
    mockList.mockResolvedValueOnce([])
    mockCreate.mockRejectedValueOnce(new Error('boom'))

    render(<LeaveMatrix {...defaultProps()} />)

    await waitFor(() => expect(mockList).toHaveBeenCalled())
    await waitForRows()

    const sel = selectFor(1, 1)
    fireEvent.change(sel, { target: { value: 'REQUESTED' } })

    await waitFor(() => {
      expect(sel.closest('td')!.getAttribute('title')).toBe('保存失敗')
    })
  })
})

// ---------------------------------------------------------------------------

describe('LeaveMatrix — mobile overflow', () => {
  // Regression: ISSUE-001 — 30日分の日付列が table-fixed + w-full + 幅未指定の
  // col で狭い画面幅に押し潰され、日付ヘッダーが判読不能になっていた。
  // Found by /qa on 2026-08-16
  // Report: .gstack/qa-reports/qa-report-shift-scheduler-demo-pages-dev-2026-08-16.md
  it('gives every day column an explicit width so the table overflows its wrapper instead of shrinking', async () => {
    render(<LeaveMatrix {...defaultProps()} />)
    await waitForRows()

    const table = screen.getByRole('table')
    expect(table.className).not.toMatch(/(^| )w-full( |$)/)

    const dayCols = table.querySelectorAll('colgroup col + col')
    expect(dayCols.length).toBeGreaterThan(0)
    dayCols.forEach((col) => {
      expect((col as HTMLElement).style.width).not.toBe('')
    })
  })
})
