import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import WorkPatternsPage from './WorkPatternsPage'
import {
  createWorkPattern, createWorkPatternGroup,
  deleteWorkPattern, deleteWorkPatternGroup,
  downloadWorkPatternsCsv,
  listWorkPatternGroups, listWorkPatterns,
  reorderWorkPatternGroups, reorderWorkPatterns,
  updateWorkPattern, updateWorkPatternGroup,
} from '../api/workPatterns'
import { listDepartments } from '../api/departments'
import {
  useGroupReorderStore, usePatternReorderStore,
} from '../stores/reorderStore'
import {
  DEPT, GROUP_A, GROUP_B,
  PATTERN_A1 as A1, PATTERN_A2 as A2,
} from '../test/fixtures'

vi.mock('../api/departments', () => ({ listDepartments: vi.fn() }))
vi.mock('../api/workPatterns', () => ({
  createWorkPattern: vi.fn(),
  createWorkPatternGroup: vi.fn(),
  deleteWorkPattern: vi.fn(),
  deleteWorkPatternGroup: vi.fn(),
  downloadWorkPatternsCsv: vi.fn(),
  listWorkPatternGroups: vi.fn(),
  listWorkPatterns: vi.fn(),
  reorderWorkPatternGroups: vi.fn(),
  reorderWorkPatterns: vi.fn(),
  updateWorkPattern: vi.fn(),
  updateWorkPatternGroup: vi.fn(),
}))

vi.mock('../components/work-pattern/WorkPatternGroupFormModal', () => ({
  default: ({ mode, onClose, onSubmit }: {
    mode: 'create' | 'edit'
    onClose: () => void
    onSubmit: (p: never) => Promise<void>
  }) => (
    <div data-testid="group-modal">
      <span>group-modal-{mode}</span>
      <button onClick={() => onSubmit({ name: 'Z', is_auxiliary: false } as never)}>
        group-submit
      </button>
      <button onClick={onClose}>group-close</button>
    </div>
  ),
}))
vi.mock('../components/work-pattern/WorkPatternFormModal', () => ({
  default: ({ mode, onClose, onSubmit }: {
    mode: 'create' | 'edit'
    onClose: () => void
    onSubmit: (p: never) => Promise<void>
  }) => (
    <div data-testid="pattern-modal">
      <span>pattern-modal-{mode}</span>
      <button onClick={() => onSubmit({
        pattern_name: 'Z1', shift_type: 2, shift_start: '09:00', shift_end: '18:00',
      } as never)}>
        pattern-submit
      </button>
      <button onClick={onClose}>pattern-close</button>
    </div>
  ),
}))
vi.mock('../components/reorder/ReorderCommitBar', () => ({
  default: ({ label, onCommit, useStore }: {
    label: string
    onCommit: (ids: number[]) => Promise<void> | void
    useStore: () => { mode: string }
  }) => {
    if (useStore().mode !== 'reorder') return null
    return (
      <button
        data-testid={`reorder-commit-${label}`}
        onClick={() => onCommit([2, 1])}
      >
        commit-{label}
      </button>
    )
  },
}))
vi.mock('../components/reorder/ReorderToast', () => ({
  default: () => <div data-testid="reorder-toast" />,
}))
vi.mock('../components/reorder/SortableContainer', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
vi.mock('../components/reorder/SortableRow', () => ({
  default: ({ children, className, as = 'tr' }: {
    children: (h: { attributes: object; listeners: undefined; isDragging: false }) => React.ReactNode
    className?: string
    as?: 'tr' | 'li' | 'div'
  }) => {
    const Tag = as
    return (
      <Tag className={className}>
        {children({ attributes: {}, listeners: undefined, isDragging: false })}
      </Tag>
    )
  },
  DragHandle: () => <span data-testid="drag-handle" />,
}))

const mockDeps = vi.mocked(listDepartments)
const mockListGroups = vi.mocked(listWorkPatternGroups)
const mockListPats = vi.mocked(listWorkPatterns)
const mockCreateGroup = vi.mocked(createWorkPatternGroup)
const mockUpdateGroup = vi.mocked(updateWorkPatternGroup)
const mockDeleteGroup = vi.mocked(deleteWorkPatternGroup)
const mockCreatePat = vi.mocked(createWorkPattern)
const mockUpdatePat = vi.mocked(updateWorkPattern)
const mockDeletePat = vi.mocked(deleteWorkPattern)
const mockExport = vi.mocked(downloadWorkPatternsCsv)
const mockReorderGroups = vi.mocked(reorderWorkPatternGroups)
const mockReorderPats = vi.mocked(reorderWorkPatterns)

beforeEach(() => {
  useGroupReorderStore.getState().exit()
  usePatternReorderStore.getState().exit()
  mockDeps.mockReset()
  mockListGroups.mockReset()
  mockListPats.mockReset()
  mockCreateGroup.mockReset()
  mockUpdateGroup.mockReset()
  mockDeleteGroup.mockReset()
  mockCreatePat.mockReset()
  mockUpdatePat.mockReset()
  mockDeletePat.mockReset()
  mockExport.mockReset()
  mockReorderGroups.mockReset()
  mockReorderPats.mockReset()

  mockDeps.mockResolvedValue([DEPT])
  mockListGroups.mockResolvedValue([GROUP_A, GROUP_B])
  mockListPats.mockResolvedValue([A1, A2])
})

afterEach(() => {
  useGroupReorderStore.getState().exit()
  usePatternReorderStore.getState().exit()
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------

describe('WorkPatternsPage — initial render', () => {
  it('fetches deps + groups + patterns; selects first group; lists its patterns', async () => {
    render(<WorkPatternsPage />)

    await waitFor(() => expect(mockDeps).toHaveBeenCalled())
    await waitFor(() => expect(mockListGroups).toHaveBeenCalledWith(1))
    await waitFor(() => expect(mockListPats).toHaveBeenCalledWith(1))

    expect(await screen.findByText('A')).toBeInTheDocument()
    expect(screen.getByText('B')).toBeInTheDocument()
    // pattern column
    expect(screen.getByText('A1')).toBeInTheDocument()
    expect(screen.getByText('A2')).toBeInTheDocument()
  })

  it('clicking another group changes the pattern list', async () => {
    const user = userEvent.setup()
    render(<WorkPatternsPage />)

    expect(await screen.findByText('A1')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'グループ B を選択' }))

    // B グループには pattern が無い → 空状態
    expect(await screen.findByText('作業パターンがまだありません')).toBeInTheDocument()
  })

  it('shows "グループがまだありません" when no groups', async () => {
    mockListGroups.mockReset()
    mockListGroups.mockResolvedValue([])
    mockListPats.mockReset()
    mockListPats.mockResolvedValue([])

    render(<WorkPatternsPage />)

    expect(await screen.findByText('グループがまだありません')).toBeInTheDocument()
  })

  it('shows pattern count badge per group', async () => {
    render(<WorkPatternsPage />)

    expect(await screen.findByText('パターン 2件')).toBeInTheDocument()
    expect(screen.getByText('パターン 0件')).toBeInTheDocument()
  })

  it('renders 補助 badge for auxiliary groups', async () => {
    render(<WorkPatternsPage />)

    expect(await screen.findByText('補助')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------

describe('WorkPatternsPage — group CRUD', () => {
  it('Group + 新規 opens create modal; submit calls createWorkPatternGroup with department_id', async () => {
    mockCreateGroup.mockResolvedValueOnce(GROUP_A)
    const user = userEvent.setup()
    render(<WorkPatternsPage />)
    await screen.findByText('A')

    // Group 列の "+ 新規" ボタン (first one in DOM)
    const newButtons = screen.getAllByRole('button', { name: '+ 新規' })
    await user.click(newButtons[0])

    expect(screen.getByText('group-modal-create')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'group-submit' }))

    await waitFor(() => {
      expect(mockCreateGroup).toHaveBeenCalledWith({
        name: 'Z', is_auxiliary: false, department_id: 1,
      })
    })
  })

  it('Group 編集 button opens edit modal; submit calls updateWorkPatternGroup', async () => {
    mockUpdateGroup.mockResolvedValueOnce(GROUP_A)
    const user = userEvent.setup()
    render(<WorkPatternsPage />)
    await screen.findByText('A')

    await user.click(screen.getByRole('button', { name: 'グループ A を編集' }))
    await user.click(screen.getByRole('button', { name: 'group-submit' }))

    await waitFor(() => {
      expect(mockUpdateGroup).toHaveBeenCalledWith(10, { name: 'Z', is_auxiliary: false })
    })
  })

  it('Group 削除 opens cascade dialog with child count', async () => {
    const user = userEvent.setup()
    render(<WorkPatternsPage />)
    await screen.findByText('A')

    await user.click(screen.getByRole('button', { name: 'グループ A を削除' }))

    expect(await screen.findByText('Cascade Impact')).toBeInTheDocument()
    // cascade パネル内の childCount=2 を含む説明文
    expect(
      screen.getByText(/件の作業パターンも同時に削除されます/),
    ).toBeInTheDocument()
  })

  it('confirming group delete calls deleteWorkPatternGroup', async () => {
    mockDeleteGroup.mockResolvedValueOnce(undefined)
    const user = userEvent.setup()
    render(<WorkPatternsPage />)
    await screen.findByText('A')

    await user.click(screen.getByRole('button', { name: 'グループ B を削除' }))
    await user.click(screen.getByRole('button', { name: '削除する' }))

    await waitFor(() => expect(mockDeleteGroup).toHaveBeenCalledWith(20))
  })
})

// ---------------------------------------------------------------------------

describe('WorkPatternsPage — pattern CRUD', () => {
  it('Pattern + 新規 opens create modal; submit calls createWorkPattern with selectedGroup.id', async () => {
    mockCreatePat.mockResolvedValueOnce(A1)
    const user = userEvent.setup()
    render(<WorkPatternsPage />)
    await screen.findByText('A1')

    // Pattern 列の "+ 新規" ボタン (second)
    const newButtons = screen.getAllByRole('button', { name: '+ 新規' })
    await user.click(newButtons[1])

    expect(screen.getByText('pattern-modal-create')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'pattern-submit' }))

    await waitFor(() => {
      expect(mockCreatePat).toHaveBeenCalledWith({
        group_id: 10, pattern_name: 'Z1', shift_type: 2,
        shift_start: '09:00', shift_end: '18:00',
      })
    })
  })

  it('Pattern 編集 opens edit modal; submit calls updateWorkPattern', async () => {
    mockUpdatePat.mockResolvedValueOnce(A1)
    const user = userEvent.setup()
    render(<WorkPatternsPage />)
    await screen.findByText('A1')

    await user.click(screen.getByRole('button', { name: '作業パターン A1 を編集' }))
    await user.click(screen.getByRole('button', { name: 'pattern-submit' }))

    await waitFor(() => {
      expect(mockUpdatePat).toHaveBeenCalledWith(100, expect.objectContaining({
        pattern_name: 'Z1',
      }))
    })
  })

  it('Pattern 削除 opens dialog without cascade panel and confirms with deleteWorkPattern', async () => {
    mockDeletePat.mockResolvedValueOnce(undefined)
    const user = userEvent.setup()
    render(<WorkPatternsPage />)
    await screen.findByText('A1')

    await user.click(screen.getByRole('button', { name: '作業パターン A1 を削除' }))
    expect(screen.queryByText('Cascade Impact')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '削除する' }))
    await waitFor(() => expect(mockDeletePat).toHaveBeenCalledWith(100))
  })
})

// ---------------------------------------------------------------------------

describe('WorkPatternsPage — reorder modes', () => {
  it('Group reorder enters mode and commits via reorderWorkPatternGroups', async () => {
    mockReorderGroups.mockResolvedValueOnce(undefined)
    const user = userEvent.setup()
    render(<WorkPatternsPage />)
    await screen.findByText('A')

    // Group 列の ⇅ 並び替え (first)
    await user.click(screen.getAllByRole('button', { name: '⇅ 並び替え' })[0])
    expect(useGroupReorderStore.getState().mode).toBe('reorder')

    await user.click(screen.getByTestId('reorder-commit-グループ'))

    await waitFor(() => {
      expect(mockReorderGroups).toHaveBeenCalledWith(1, [2, 1])
    })
    expect(useGroupReorderStore.getState().mode).toBe('view')
    expect(useGroupReorderStore.getState().toast?.kind).toBe('success')
  })

  it('Pattern reorder enters mode and commits via reorderWorkPatterns', async () => {
    mockReorderPats.mockResolvedValueOnce(undefined)
    const user = userEvent.setup()
    render(<WorkPatternsPage />)
    await screen.findByText('A1')

    // Pattern 列の ⇅ 並び替え（順序的に最初の ⇅）
    // Group 列にも同名ボタンがある。まず group の reorder ボタンは groups.length=2 なので有効。
    // 順序: button 配列 [0]=group 並び替え, [1]=pattern 並び替え
    const reorderBtns = screen.getAllByRole('button', { name: '⇅ 並び替え' })
    await user.click(reorderBtns[1])
    expect(usePatternReorderStore.getState().mode).toBe('reorder')

    await user.click(screen.getByTestId('reorder-commit-作業パターン'))

    await waitFor(() => {
      expect(mockReorderPats).toHaveBeenCalledWith(10, [2, 1])
    })
    expect(usePatternReorderStore.getState().mode).toBe('view')
  })
})

// ---------------------------------------------------------------------------

describe('WorkPatternsPage — Export CSV', () => {
  it('Export CSV button calls downloadWorkPatternsCsv', async () => {
    mockExport.mockResolvedValueOnce(undefined)
    const user = userEvent.setup()
    render(<WorkPatternsPage />)
    await screen.findByText('A1')

    await user.click(screen.getByRole('button', { name: /Export CSV/ }))

    await waitFor(() => expect(mockExport).toHaveBeenCalledWith(1))
  })

  it('Export CSV is disabled when there are no patterns', async () => {
    mockListPats.mockReset()
    mockListPats.mockResolvedValue([])

    render(<WorkPatternsPage />)
    // groups なし時のメッセージ等は出るが、ボタン disabled が分かれば OK
    await waitFor(() => expect(mockListGroups).toHaveBeenCalled())

    expect(screen.getByRole('button', { name: /Export CSV/ })).toBeDisabled()
  })
})
