import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import ShiftPage from './ShiftPage'
import { listDepartments } from '../api/departments'
import { listEmployees } from '../api/employees'
import { listSchedules } from '../api/schedules'
import type { Schedule } from '../types/api'
import { useEditorStore } from '../stores/editor'
import { useShiftSelectionStore } from '../stores/shiftSelection'
import { DEPT, DEPT2, EMP_ALICE } from '../test/fixtures'

// API モック
vi.mock('../api/departments', () => ({ listDepartments: vi.fn() }))
vi.mock('../api/employees', () => ({ listEmployees: vi.fn() }))
vi.mock('../api/schedules', () => ({ listSchedules: vi.fn() }))

// 子コンポーネントは stub。ハンドラ呼び出しはテスト用のクリック起点で発火させる
vi.mock('../components/leave/LeaveMatrix', () => ({
  default: ({ onCellsChanged, year, month }: {
    onCellsChanged?: (n: number) => void
    year: number
    month: number
  }) => (
    <div data-testid="leave-matrix">
      <span>Matrix {year}/{month}</span>
      <button onClick={() => onCellsChanged?.(3)}>matrix-cell-changed</button>
    </div>
  ),
}))
vi.mock('../components/leave/LeaveCsvUpload', () => ({
  default: ({ onImported }: { onImported: () => void }) => (
    <button data-testid="csv-upload" onClick={onImported}>csv</button>
  ),
}))
vi.mock('../components/shift/GenerateButton', () => ({
  default: ({ onGenerated, year, month, disabled }: {
    onGenerated: (s: Schedule) => void
    year: number; month: number; disabled: boolean
  }) => (
    <button
      data-testid="generate-btn"
      disabled={disabled}
      onClick={() => onGenerated({
        id: 999, department_id: 1, year, month, status: 'GENERATING',
        generation_attempt: 1, is_active: false, diagnosis: null,
        created_at: '', started_at: null, finished_at: null, time_limit: 120,
      })}
    >
      generate
    </button>
  ),
}))
vi.mock('../components/shift/GenerationProgress', () => ({
  default: ({ scheduleId, onDone }: { scheduleId: number; onDone: (s: Schedule) => void }) => (
    <button
      data-testid="generation-progress"
      onClick={() => onDone({
        id: scheduleId, department_id: 1, year: 2026, month: 4,
        status: 'GENERATED', generation_attempt: 1, is_active: false,
        diagnosis: null, created_at: '', started_at: null,
        finished_at: null, time_limit: 120,
      })}
    >
      progress
    </button>
  ),
}))
vi.mock('../components/shift/ScheduleList', () => ({
  default: ({ schedules, onSelect, onDeleted }: {
    schedules: Schedule[]
    onSelect: (s: Schedule) => void
    onDeleted: (id: number) => void
  }) => (
    <div data-testid="schedule-list">
      {schedules.map((s) => (
        <div key={s.id}>
          <button onClick={() => onSelect(s)}>select-{s.id}</button>
          <button onClick={() => onDeleted(s.id)}>delete-{s.id}</button>
        </div>
      ))}
    </div>
  ),
}))
vi.mock('../components/shift/ShiftGrid', () => ({
  default: ({ schedule }: { schedule: Schedule }) => (
    <div data-testid="shift-grid">grid-{schedule.id}</div>
  ),
}))

const mockListDeps = vi.mocked(listDepartments)
const mockListEmps = vi.mocked(listEmployees)
const mockListScheds = vi.mocked(listSchedules)

const NOW_YEAR = new Date().getFullYear()
// ShiftPage のデフォルト選択月は翌月 (12月 → 翌年1月)。mock schedule をこれに合わせる。
const DEFAULT_TARGET = new Date(NOW_YEAR, new Date().getMonth() + 1, 1)
const DEFAULT_YEAR = DEFAULT_TARGET.getFullYear()
const DEFAULT_MONTH = DEFAULT_TARGET.getMonth() + 1

function makeSchedule(over: Partial<Schedule> = {}): Schedule {
  return {
    id: 1, department_id: 1, year: DEFAULT_YEAR, month: DEFAULT_MONTH,
    status: 'GENERATED', generation_attempt: 1, is_active: false,
    diagnosis: null, created_at: '', started_at: null, finished_at: null,
    ...over,
  }
}

// ResizeObserver / window.scrollTo polyfill は src/test/setup.ts で共通化済み

beforeEach(() => {
  useEditorStore.getState().reset()
  // shiftSelection は module singleton なので、テスト間の状態リークを防ぐため
  // デフォルト (翌月) に戻す。
  useShiftSelectionStore.setState({ year: DEFAULT_YEAR, month: DEFAULT_MONTH })
  mockListDeps.mockReset()
  mockListEmps.mockReset()
  mockListScheds.mockReset()
  mockListDeps.mockResolvedValue([DEPT, DEPT2])
  mockListEmps.mockResolvedValue([EMP_ALICE])
  mockListScheds.mockResolvedValue([])
})

afterEach(() => {
  useEditorStore.getState().reset()
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Initial fetches and selectors
// ---------------------------------------------------------------------------

describe('ShiftPage — initial render', () => {
  it('renders the page heading "稼働表作成"', () => {
    render(<ShiftPage />)

    expect(
      screen.getByRole('heading', { name: /稼働表作成/, level: 1 }),
    ).toBeInTheDocument()
  })

  it('fetches departments and employees and schedules on mount', async () => {
    render(<ShiftPage />)

    await waitFor(() => expect(mockListDeps).toHaveBeenCalled())
    await waitFor(() => expect(mockListEmps).toHaveBeenCalled())
    await waitFor(() => expect(mockListScheds).toHaveBeenCalledWith(1))
  })

  it('selects the first department by default', async () => {
    render(<ShiftPage />)

    await waitFor(() => {
      const select = document.querySelectorAll('select')[0] as HTMLSelectElement
      expect(select.value).toBe('1')
    })
  })

  it('renders four year options based on current year', async () => {
    render(<ShiftPage />)

    await waitFor(() => expect(mockListDeps).toHaveBeenCalled())
    const yearSelect = document.querySelectorAll('select')[1] as HTMLSelectElement
    const opts = [...yearSelect.options].map((o) => o.value)
    expect(opts).toEqual([
      String(NOW_YEAR - 1),
      String(NOW_YEAR),
      String(NOW_YEAR + 1),
      String(NOW_YEAR + 2),
    ])
  })

  it('renders 12 month options', async () => {
    render(<ShiftPage />)
    await waitFor(() => expect(mockListDeps).toHaveBeenCalled())

    const monthSelect = document.querySelectorAll('select')[2] as HTMLSelectElement
    expect(monthSelect.options.length).toBe(12)
  })

  it('別画面遷移 (再マウント) 後も選択した対象月を保持する', async () => {
    // 翌月デフォルトとは別の月を選ぶ (1月 or 2月)。
    const target = DEFAULT_MONTH === 1 ? 2 : 1
    const { unmount } = render(<ShiftPage />)
    await waitFor(() => expect(mockListDeps).toHaveBeenCalled())

    const monthSelect = document.querySelectorAll('select')[2] as HTMLSelectElement
    fireEvent.change(monthSelect, { target: { value: String(target) } })
    expect(monthSelect.value).toBe(String(target))

    // 別画面へ遷移して戻る = unmount → 再 render。store 保持で翌月に戻らない。
    unmount()
    render(<ShiftPage />)
    await waitFor(() => expect(mockListDeps).toHaveBeenCalled())

    const monthSelectAfter = document.querySelectorAll('select')[2] as HTMLSelectElement
    expect(monthSelectAfter.value).toBe(String(target))
    expect(monthSelectAfter.value).not.toBe(String(DEFAULT_MONTH))
  })
})

// ---------------------------------------------------------------------------
// Schedule lifecycle
// ---------------------------------------------------------------------------

describe('ShiftPage — schedule lifecycle', () => {
  it('handleGenerated appends schedule and shows GenerationProgress', async () => {
    const user = userEvent.setup()
    render(<ShiftPage />)

    await waitFor(() => expect(mockListDeps).toHaveBeenCalled())
    await user.click(screen.getByTestId('generate-btn'))

    expect(await screen.findByTestId('generation-progress')).toBeInTheDocument()
    // schedule id 999 が ScheduleList に渡る → select-999 ボタン描画
    expect(screen.getByText('select-999')).toBeInTheDocument()
  })

  it('handleGenerationDone clears generatingId and reloads schedules', async () => {
    const user = userEvent.setup()
    render(<ShiftPage />)

    await waitFor(() => expect(mockListDeps).toHaveBeenCalled())
    await user.click(screen.getByTestId('generate-btn'))
    expect(await screen.findByTestId('generation-progress')).toBeInTheDocument()

    const reloadCallsBefore = mockListScheds.mock.calls.length
    await user.click(screen.getByTestId('generation-progress'))

    await waitFor(() => {
      expect(screen.queryByTestId('generation-progress')).not.toBeInTheDocument()
    })
    expect(mockListScheds.mock.calls.length).toBeGreaterThan(reloadCallsBefore)
  })

  it('selecting a schedule shows ShiftGrid; selecting again toggles it off', async () => {
    mockListScheds.mockResolvedValue([makeSchedule({ id: 7 })])

    const user = userEvent.setup()
    render(<ShiftPage />)

    await waitFor(() => expect(screen.getByText('select-7')).toBeInTheDocument())

    await user.click(screen.getByText('select-7'))
    expect(await screen.findByTestId('shift-grid')).toBeInTheDocument()

    await user.click(screen.getByText('select-7'))
    expect(screen.queryByTestId('shift-grid')).not.toBeInTheDocument()
  })

  it('deleting the currently selected schedule clears selection and resets editor', async () => {
    mockListScheds.mockResolvedValue([makeSchedule({ id: 7 })])
    const resetSpy = vi.spyOn(useEditorStore.getState(), 'reset')

    const user = userEvent.setup()
    render(<ShiftPage />)

    await waitFor(() => expect(screen.getByText('select-7')).toBeInTheDocument())
    await user.click(screen.getByText('select-7'))
    await screen.findByTestId('shift-grid')

    await user.click(screen.getByText('delete-7'))

    await waitFor(() => {
      expect(screen.queryByTestId('shift-grid')).not.toBeInTheDocument()
    })
    expect(resetSpy).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Year/month/department changes invalidate selection
// ---------------------------------------------------------------------------

describe('ShiftPage — selection invalidation', () => {
  it('changing department clears selectedSchedule when its dept differs', async () => {
    mockListScheds.mockResolvedValue([makeSchedule({ id: 9, department_id: 1 })])

    const user = userEvent.setup()
    render(<ShiftPage />)

    await waitFor(() => expect(screen.getByText('select-9')).toBeInTheDocument())
    await user.click(screen.getByText('select-9'))
    expect(await screen.findByTestId('shift-grid')).toBeInTheDocument()

    // 部門切替 (1 → 2)
    const deptSelect = document.querySelectorAll('select')[0] as HTMLSelectElement
    fireEvent.change(deptSelect, { target: { value: '2' } })

    await waitFor(() => {
      expect(screen.queryByTestId('shift-grid')).not.toBeInTheDocument()
    })
  })

  it('shows generated schedules only for the current year/month', async () => {
    mockListScheds.mockResolvedValue([
      makeSchedule({ id: 5, year: DEFAULT_YEAR, month: DEFAULT_MONTH }),
      makeSchedule({ id: 6, year: DEFAULT_YEAR + 1, month: DEFAULT_MONTH }),
    ])

    render(<ShiftPage />)

    await waitFor(() => {
      expect(screen.getByText('select-5')).toBeInTheDocument()
    })
    expect(screen.queryByText('select-6')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// CSV import + matrix cell count
// ---------------------------------------------------------------------------

describe('ShiftPage — matrix integration', () => {
  it('CSV import bumps matrix reloadToken (matrix re-mounts visually here)', async () => {
    const user = userEvent.setup()
    render(<ShiftPage />)

    await waitFor(() => expect(screen.getByTestId('leave-matrix')).toBeInTheDocument())

    // CSV upload stub の onImported が走り、reloadToken が変わる。観測手段:
    // matrix の identity は stub なので変化しないが、エラー無く動くことを確認
    await user.click(screen.getByTestId('csv-upload'))

    expect(screen.getByTestId('leave-matrix')).toBeInTheDocument()
  })

  it('renders the marked-cell counter from LeaveMatrix.onCellsChanged', async () => {
    const user = userEvent.setup()
    render(<ShiftPage />)

    await waitFor(() => expect(screen.getByTestId('leave-matrix')).toBeInTheDocument())
    await user.click(screen.getByText('matrix-cell-changed'))

    // ヘッダの "Marked / Cells" 数値が 3 に更新される
    await waitFor(() => {
      const header = screen.getByText('Marked / Cells').parentElement!
      expect(header.textContent).toContain('3')
    })
  })
})
