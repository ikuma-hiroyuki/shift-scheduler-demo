import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import EmployeesPage from './EmployeesPage'
import {
  createEmployee, deleteEmployee, getEmployeeUsage,
  listEmployees, reorderEmployees, updateEmployee,
} from '../api/employees'
import { listDepartments } from '../api/departments'
import { useEmployeeReorderStore } from '../stores/reorderStore'
import { DEPT, DEPT2, EMP_ALICE as ALICE, EMP_BOB as BOB } from '../test/fixtures'

vi.mock('../api/employees', () => ({
  createEmployee: vi.fn(),
  deleteEmployee: vi.fn(),
  getEmployeeUsage: vi.fn(),
  listEmployees: vi.fn(),
  reorderEmployees: vi.fn(),
  updateEmployee: vi.fn(),
}))
vi.mock('../api/departments', () => ({ listDepartments: vi.fn() }))

vi.mock('../components/employee/EmployeeCsvUpload', () => ({
  default: ({ onImported }: { onImported: () => void }) => (
    <button data-testid="csv-upload" onClick={onImported}>csv</button>
  ),
}))
vi.mock('../components/employee/EmployeeFormModal', () => ({
  default: ({ mode, onClose, onSubmit }: {
    mode: 'create' | 'edit'
    onClose: () => void
    onSubmit: (p: never) => Promise<void>
  }) => (
    <div data-testid="employee-form-modal">
      <span>modal-{mode}</span>
      <button
        onClick={() => onSubmit({
          employee_number: 9999, name: 'Test', role: 'STAFF',
          available_days: '0,1,2,3,4,5,6', available_shift_types: '1,2,3',
          consecutive_workable: true,
        } as never)}
      >
        modal-submit
      </button>
      <button onClick={onClose}>modal-close</button>
    </div>
  ),
}))
vi.mock('../components/reorder/ReorderCommitBar', () => ({
  default: ({ onCommit }: { onCommit: (ids: number[]) => Promise<void> | void }) => (
    <button data-testid="reorder-commit" onClick={() => onCommit([2, 1])}>
      commit-reorder
    </button>
  ),
}))
vi.mock('../components/reorder/ReorderToast', () => ({
  default: () => <div data-testid="reorder-toast" />,
}))
vi.mock('../components/reorder/SortableContainer', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
vi.mock('../components/reorder/SortableRow', () => {
  return {
    default: ({ children, className }: {
      children: (h: { attributes: object; listeners: undefined; isDragging: false }) => React.ReactNode
      className?: string
    }) => (
      <tr className={className}>
        {children({ attributes: {}, listeners: undefined, isDragging: false })}
      </tr>
    ),
    DragHandle: () => <span data-testid="drag-handle" />,
  }
})

const mockListDeps = vi.mocked(listDepartments)
const mockListEmps = vi.mocked(listEmployees)
const mockCreate = vi.mocked(createEmployee)
const mockUpdate = vi.mocked(updateEmployee)
const mockDelete = vi.mocked(deleteEmployee)
const mockUsage = vi.mocked(getEmployeeUsage)
const mockReorder = vi.mocked(reorderEmployees)

beforeEach(() => {
  useEmployeeReorderStore.getState().exit()
  mockListDeps.mockReset()
  mockListEmps.mockReset()
  mockCreate.mockReset()
  mockUpdate.mockReset()
  mockDelete.mockReset()
  mockUsage.mockReset()
  mockReorder.mockReset()

  mockListDeps.mockResolvedValue([DEPT])
  mockListEmps.mockResolvedValue([ALICE, BOB])
})

afterEach(() => {
  useEmployeeReorderStore.getState().exit()
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------

describe('EmployeesPage — initial render', () => {
  it('fetches departments and employees, renders rows', async () => {
    render(<EmployeesPage />)

    await waitFor(() => expect(mockListDeps).toHaveBeenCalled())
    await waitFor(() => expect(mockListEmps).toHaveBeenCalled())

    expect(await screen.findByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
  })

  it('shows empty state when filter excludes all employees', async () => {
    const user = userEvent.setup()
    render(<EmployeesPage />)

    await screen.findByText('Alice')
    await user.type(screen.getByPlaceholderText('氏名・社員番号で検索'), 'NoMatch')

    expect(await screen.findByText('該当する従業員がいません')).toBeInTheDocument()
  })

  it('filters by query string against name / number / role', async () => {
    const user = userEvent.setup()
    render(<EmployeesPage />)

    await screen.findByText('Alice')
    await user.type(screen.getByPlaceholderText('氏名・社員番号で検索'), '主任')

    // 主任 = CHIEF = Bob
    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.queryByText('Alice')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------

describe('EmployeesPage — modal CRUD', () => {
  it('+ 新規追加 opens the create modal', async () => {
    const user = userEvent.setup()
    render(<EmployeesPage />)

    await screen.findByText('Alice')
    await user.click(screen.getByRole('button', { name: '+ 新規追加' }))

    expect(screen.getByText('modal-create')).toBeInTheDocument()
  })

  it('編集 opens the edit modal', async () => {
    const user = userEvent.setup()
    render(<EmployeesPage />)

    await screen.findByText('Alice')
    await user.click(screen.getAllByRole('button', { name: '編集' })[0])

    expect(screen.getByText('modal-edit')).toBeInTheDocument()
  })

  it('create submit calls createEmployee with department_id and reloads', async () => {
    mockCreate.mockResolvedValueOnce(ALICE)
    const user = userEvent.setup()
    render(<EmployeesPage />)

    await screen.findByText('Alice')
    await user.click(screen.getByRole('button', { name: '+ 新規追加' }))
    await user.click(screen.getByRole('button', { name: 'modal-submit' }))

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
        department_id: 1, employee_number: 9999, name: 'Test',
      }))
    })
    expect(mockListEmps).toHaveBeenCalledTimes(2)
  })

  it('edit submit calls updateEmployee with employee id', async () => {
    mockUpdate.mockResolvedValueOnce(ALICE)
    const user = userEvent.setup()
    render(<EmployeesPage />)

    await screen.findByText('Alice')
    await user.click(screen.getAllByRole('button', { name: '編集' })[0])
    await user.click(screen.getByRole('button', { name: 'modal-submit' }))

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith(1, expect.objectContaining({
        name: 'Test', role: 'STAFF',
      }))
    })
  })
})

// ---------------------------------------------------------------------------

describe('EmployeesPage — delete confirmation', () => {
  it('opens confirm with usage info', async () => {
    mockUsage.mockResolvedValueOnce({ assignment_count: 3, schedule_count: 1, leave_request_count: 2 })

    const user = userEvent.setup()
    render(<EmployeesPage />)

    await screen.findByText('Alice')
    await user.click(screen.getAllByRole('button', { name: '削除' })[0])

    expect(await screen.findByText('本当に削除しますか？')).toBeInTheDocument()
    expect(await screen.findByText('3')).toBeInTheDocument() // assignment_count
  })

  it('shows "影響範囲を確認中…" while usage fetch pending', async () => {
    mockUsage.mockReturnValue(new Promise(() => {})) // never resolves
    const user = userEvent.setup()
    render(<EmployeesPage />)

    await screen.findByText('Alice')
    await user.click(screen.getAllByRole('button', { name: '削除' })[0])

    expect(await screen.findByText('影響範囲を確認中…')).toBeInTheDocument()
  })

  it('confirms deletion calls deleteEmployee and reloads', async () => {
    mockUsage.mockResolvedValueOnce({ assignment_count: 0, schedule_count: 0, leave_request_count: 0 })
    mockDelete.mockResolvedValueOnce(undefined)

    const user = userEvent.setup()
    render(<EmployeesPage />)

    await screen.findByText('Alice')
    await user.click(screen.getAllByRole('button', { name: '削除' })[0])

    const confirmBtn = await screen.findByRole('button', { name: '削除する' })
    await waitFor(() => expect(confirmBtn).toBeEnabled())
    await user.click(confirmBtn)

    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith(1))
    expect(mockListEmps).toHaveBeenCalledTimes(2) // initial + reload
  })

  it('cancel closes the dialog without deleting', async () => {
    mockUsage.mockResolvedValueOnce({ assignment_count: 0, schedule_count: 0, leave_request_count: 0 })

    const user = userEvent.setup()
    render(<EmployeesPage />)

    await screen.findByText('Alice')
    await user.click(screen.getAllByRole('button', { name: '削除' })[0])

    await screen.findByText('本当に削除しますか？')
    await user.click(screen.getAllByRole('button', { name: 'キャンセル' })[0])

    await waitFor(() => {
      expect(screen.queryByText('本当に削除しますか？')).not.toBeInTheDocument()
    })
    expect(mockDelete).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------

describe('EmployeesPage — reorder mode', () => {
  it('⇅ 並び替え enters reorder mode (replaces buttons with reorder-mode label)', async () => {
    const user = userEvent.setup()
    render(<EmployeesPage />)

    await screen.findByText('Alice')
    await user.click(screen.getByRole('button', { name: '⇅ 並び替え' }))

    expect(screen.getByText('並び替えモード中')).toBeInTheDocument()
    expect(useEmployeeReorderStore.getState().mode).toBe('reorder')
  })

  it('⇅ 並び替え is disabled when fewer than 2 employees', async () => {
    mockListEmps.mockReset()
    mockListEmps.mockResolvedValue([ALICE])

    render(<EmployeesPage />)

    await screen.findByText('Alice')
    expect(screen.getByRole('button', { name: '⇅ 並び替え' })).toBeDisabled()
  })

  it('reorder commit calls reorderEmployees(deptId, draftOrder), reloads, exits, fires toast', async () => {
    mockReorder.mockResolvedValueOnce(undefined)
    const user = userEvent.setup()
    render(<EmployeesPage />)

    await screen.findByText('Alice')
    await user.click(screen.getByRole('button', { name: '⇅ 並び替え' }))
    await user.click(screen.getByRole('button', { name: 'commit-reorder' }))

    await waitFor(() => {
      expect(mockReorder).toHaveBeenCalledWith(1, [2, 1])
    })
    expect(useEmployeeReorderStore.getState().mode).toBe('view')
    expect(useEmployeeReorderStore.getState().toast?.kind).toBe('success')
  })

  it('reorder commit error sets error toast', async () => {
    mockReorder.mockRejectedValueOnce({ response: { data: { detail: '並び順衝突' } } })
    const user = userEvent.setup()
    render(<EmployeesPage />)

    await screen.findByText('Alice')
    await user.click(screen.getByRole('button', { name: '⇅ 並び替え' }))
    await user.click(screen.getByRole('button', { name: 'commit-reorder' }))

    await waitFor(() => {
      expect(useEmployeeReorderStore.getState().toast?.kind).toBe('error')
    })
    expect(useEmployeeReorderStore.getState().toast?.message).toContain('並び順衝突')
  })
})

// ---------------------------------------------------------------------------

describe('EmployeesPage — CSV import + dept change', () => {
  it('CSV import triggers reload', async () => {
    const user = userEvent.setup()
    render(<EmployeesPage />)

    await screen.findByText('Alice')
    expect(mockListEmps).toHaveBeenCalledTimes(1)

    await user.click(screen.getByTestId('csv-upload'))
    await waitFor(() => expect(mockListEmps).toHaveBeenCalledTimes(2))
  })

  it('changing department triggers re-filter (no reload on dept change alone)', async () => {
    mockListDeps.mockReset()
    mockListDeps.mockResolvedValue([DEPT, DEPT2])

    render(<EmployeesPage />)
    await screen.findByText('Alice')

    const select = document.querySelector('select') as HTMLSelectElement
    fireEvent.change(select, { target: { value: '2' } })

    // 支店所属は無いので空表示
    await waitFor(() => {
      expect(screen.getByText('該当する従業員がいません')).toBeInTheDocument()
    })
  })
})
