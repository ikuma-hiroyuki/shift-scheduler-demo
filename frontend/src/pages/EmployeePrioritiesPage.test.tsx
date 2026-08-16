import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import EmployeePrioritiesPage from './EmployeePrioritiesPage'
import { listDepartments } from '../api/departments'
import { listEmployees } from '../api/employees'
import { listWorkPatterns } from '../api/workPatterns'
import {
  createEmployeePriority, listEmployeePriorities, updateEmployeePriority,
} from '../api/employeePriorities'
import type { Department, Employee, WorkPattern } from '../types/api'

vi.mock('../api/departments', () => ({ listDepartments: vi.fn() }))
vi.mock('../api/employees', () => ({ listEmployees: vi.fn() }))
vi.mock('../api/workPatterns', () => ({ listWorkPatterns: vi.fn() }))
vi.mock('../api/employeePriorities', () => ({
  listEmployeePriorities: vi.fn(),
  createEmployeePriority: vi.fn(),
  updateEmployeePriority: vi.fn(),
  deleteEmployeePriority: vi.fn(),
}))
vi.mock('../components/employee-priority/EmployeePriorityCsvUpload', () => ({
  default: ({ onImported }: { onImported: () => void }) => (
    <button data-testid="csv-upload" onClick={onImported}>csv</button>
  ),
}))

const mockDeps = vi.mocked(listDepartments)
const mockEmps = vi.mocked(listEmployees)
const mockPats = vi.mocked(listWorkPatterns)
const mockPrios = vi.mocked(listEmployeePriorities)
const mockCreate = vi.mocked(createEmployeePriority)
const mockUpdate = vi.mocked(updateEmployeePriority)

const DEPT: Department = { id: 1, name: '本店', created_at: '', updated_at: '' }

const ALICE: Employee = {
  id: 1, employee_number: 1001, department_id: 1, name: 'Alice', role: 'STAFF',
  available_days: '0,1,2,3,4,5,6', available_shift_types: '1,2,3',
  consecutive_workable: true, sort_order: 0,
}

const A1: WorkPattern = {
  id: 10, group_id: 1, department_id: 1, pattern_name: 'A1', shift_type: 2,
  shift_start: '09:00', shift_end: '18:00', sort_order: 0, is_auxiliary: false,
}
const B2: WorkPattern = {
  id: 20, group_id: 2, department_id: 1, pattern_name: 'B2', shift_type: 1,
  shift_start: '07:00', shift_end: '15:00', sort_order: 1, is_auxiliary: false,
}

beforeEach(() => {
  mockDeps.mockReset()
  mockEmps.mockReset()
  mockPats.mockReset()
  mockPrios.mockReset()
  mockCreate.mockReset()
  mockUpdate.mockReset()

  mockDeps.mockResolvedValue([DEPT])
  mockEmps.mockResolvedValue([ALICE])
  mockPats.mockResolvedValue([A1, B2])
  mockPrios.mockResolvedValue([])
})

afterEach(() => {
  vi.clearAllMocks()
})

function priorityCell(empName: string, patternName: string): HTMLInputElement {
  const row = screen.getByText(empName).closest('tr')!
  // Header row pattern names map to td index = 1 + pattern column
  // Easier: find input by its row + the pattern column header position.
  const headerRow = document.querySelector('thead tr')!
  const headerCells = Array.from(headerRow.querySelectorAll('th'))
  const colIdx = headerCells.findIndex((h) => h.textContent?.includes(patternName))
  const tds = row.querySelectorAll('td')
  return tds[colIdx].querySelector('input') as HTMLInputElement
}

// ---------------------------------------------------------------------------

describe('EmployeePrioritiesPage — initial render', () => {
  it('fetches deps + emps + patterns + priorities', async () => {
    render(<EmployeePrioritiesPage />)

    await waitFor(() => expect(mockDeps).toHaveBeenCalled())
    await waitFor(() => expect(mockEmps).toHaveBeenCalled())
    await waitFor(() => expect(mockPats).toHaveBeenCalledWith(1))
    await waitFor(() => expect(mockPrios).toHaveBeenCalledWith(1))
    expect(await screen.findByText('Alice')).toBeInTheDocument()
  })

  it('renders pattern column headers (A1, B2)', async () => {
    render(<EmployeePrioritiesPage />)

    await screen.findByText('Alice')
    expect(screen.getByText('A1')).toBeInTheDocument()
    expect(screen.getByText('B2')).toBeInTheDocument()
  })

  it('shows empty patterns message when no patterns', async () => {
    mockPats.mockReset()
    mockPats.mockResolvedValue([])
    render(<EmployeePrioritiesPage />)

    expect(
      await screen.findByText('この部門に作業パターンが登録されていません'),
    ).toBeInTheDocument()
  })

  it('shows no-employees message when filter excludes all', async () => {
    const user = userEvent.setup()
    render(<EmployeePrioritiesPage />)
    await screen.findByText('Alice')

    await user.type(
      screen.getByPlaceholderText('氏名・社員番号で従業員絞り込み'),
      'NoMatch',
    )

    expect(await screen.findByText('該当する従業員がいません')).toBeInTheDocument()
  })

  it('preloads existing priorities into matching cells', async () => {
    mockPrios.mockResolvedValue([
      { id: 50, employee_id: 1, pattern_id: 10, priority: 7 },
    ])

    render(<EmployeePrioritiesPage />)
    await screen.findByText('Alice')

    expect(priorityCell('Alice', 'A1').value).toBe('7')
    expect(priorityCell('Alice', 'B2').value).toBe('')
  })
})

// ---------------------------------------------------------------------------

describe('EmployeePrioritiesPage — cell editing', () => {
  it('typing a value and blurring calls createEmployeePriority for new cells', async () => {
    mockCreate.mockResolvedValueOnce({ id: 99, employee_id: 1, pattern_id: 10, priority: 5 })

    const user = userEvent.setup()
    render(<EmployeePrioritiesPage />)
    await screen.findByText('Alice')

    const cell = priorityCell('Alice', 'A1')
    await user.click(cell)
    await user.keyboard('5')
    fireEvent.blur(cell)

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith({
        employee_id: 1, pattern_id: 10, priority: 5,
      })
    })
  })

  it('Enter key triggers commit (input blur)', async () => {
    mockCreate.mockResolvedValueOnce({ id: 99, employee_id: 1, pattern_id: 10, priority: 8 })

    const user = userEvent.setup()
    render(<EmployeePrioritiesPage />)
    await screen.findByText('Alice')

    const cell = priorityCell('Alice', 'A1')
    await user.click(cell)
    await user.keyboard('8{Enter}')

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith({
        employee_id: 1, pattern_id: 10, priority: 8,
      })
    })
  })

  it('updates existing priority via updateEmployeePriority', async () => {
    mockPrios.mockResolvedValue([
      { id: 50, employee_id: 1, pattern_id: 10, priority: 3 },
    ])
    mockUpdate.mockResolvedValueOnce({ id: 50, employee_id: 1, pattern_id: 10, priority: 9 })

    const user = userEvent.setup()
    render(<EmployeePrioritiesPage />)
    await screen.findByText('Alice')

    const cell = priorityCell('Alice', 'A1')
    await waitFor(() => expect(cell.value).toBe('3'))
    await user.clear(cell)
    await user.type(cell, '9')
    fireEvent.blur(cell)

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith(50, { priority: 9 })
    })
  })

  it('rejects non-numeric input on the client without API call', async () => {
    // issue #91: 値域チェック（0〜10）は backend に集約。client は数値判定のみ。
    const user = userEvent.setup()
    render(<EmployeePrioritiesPage />)
    await screen.findByText('Alice')

    const cell = priorityCell('Alice', 'A1')
    await user.click(cell)
    await user.keyboard('abc')
    fireEvent.blur(cell)

    await waitFor(() => {
      expect(cell.closest('td')!.getAttribute('title')).toBe('数値で入力してください')
    })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('forwards out-of-range values to backend and surfaces server error message (issue #91)', async () => {
    // 値域チェックを backend に委譲した結果、11 など範囲外も API に送る。
    // backend の 422 / 400 応答メッセージを title 属性に表示する。
    mockCreate.mockRejectedValueOnce({
      response: { data: { detail: '入力値が無効です' } },
    })

    const user = userEvent.setup()
    render(<EmployeePrioritiesPage />)
    await screen.findByText('Alice')

    const cell = priorityCell('Alice', 'A1')
    await user.click(cell)
    await user.keyboard('11')
    fireEvent.blur(cell)

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith({
        employee_id: 1, pattern_id: 10, priority: 11,
      })
    })
    await waitFor(() => {
      expect(cell.closest('td')!.getAttribute('title')).toBe('入力値が無効です')
    })
  })

  it('formats pydantic 422 list-shape detail into the first msg', async () => {
    // FastAPI の pydantic validation 422 は detail を list で返す。
    // 旧実装は ?? でしか fallback しないため "[object Object]" が表示される
    // 可能性があった。先頭要素の msg を抽出して表示する。
    mockCreate.mockRejectedValueOnce({
      response: {
        data: {
          detail: [
            {
              loc: ['body', 'priority'],
              msg: 'Input should be less than or equal to 10',
              type: 'less_than_equal',
            },
          ],
        },
      },
    })

    const user = userEvent.setup()
    render(<EmployeePrioritiesPage />)
    await screen.findByText('Alice')

    const cell = priorityCell('Alice', 'A1')
    await user.click(cell)
    await user.keyboard('11')
    fireEvent.blur(cell)

    await waitFor(() => {
      expect(cell.closest('td')!.getAttribute('title')).toBe(
        'Input should be less than or equal to 10',
      )
    })
  })

  it('Escape resets the draft to the original value (no commit)', async () => {
    mockPrios.mockResolvedValue([
      { id: 50, employee_id: 1, pattern_id: 10, priority: 4 },
    ])

    const user = userEvent.setup()
    render(<EmployeePrioritiesPage />)
    await screen.findByText('Alice')

    const cell = priorityCell('Alice', 'A1')
    await waitFor(() => expect(cell.value).toBe('4'))
    await user.click(cell)
    await user.clear(cell)
    await user.type(cell, '99{Escape}')

    expect(cell.value).toBe('4')
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('same value does nothing (no API)', async () => {
    mockPrios.mockResolvedValue([
      { id: 50, employee_id: 1, pattern_id: 10, priority: 5 },
    ])

    render(<EmployeePrioritiesPage />)
    await screen.findByText('Alice')

    const cell = priorityCell('Alice', 'A1')
    await waitFor(() => expect(cell.value).toBe('5'))
    fireEvent.blur(cell)

    await new Promise((r) => setTimeout(r, 20))
    expect(mockCreate).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------

describe('EmployeePrioritiesPage — CSV import', () => {
  it('CSV import triggers reload', async () => {
    const user = userEvent.setup()
    render(<EmployeePrioritiesPage />)
    await screen.findByText('Alice')

    const beforeCount = mockEmps.mock.calls.length
    await user.click(screen.getByTestId('csv-upload'))

    await waitFor(() => {
      expect(mockEmps.mock.calls.length).toBeGreaterThan(beforeCount)
    })
  })
})
