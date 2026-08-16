import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import ChoiceGroupsPage from './ChoiceGroupsPage'
import {
  createChoiceGroup,
  createIncompatibility,
  deleteChoiceGroup,
  deleteIncompatibility,
  listChoiceGroups,
  listIncompatibilities,
  reorderChoiceGroups,
  reorderIncompatibilities,
  updateChoiceGroup,
  updateIncompatibility,
} from '../api/choiceGroups'
import { listDepartments } from '../api/departments'
import { listWorkPatterns } from '../api/workPatterns'
import {
  useChoiceGroupReorderStore,
  useIncompatibilityReorderStore,
} from '../stores/reorderStore'
import {
  CHOICE_GROUP_DAILY,
  CHOICE_GROUP_THU,
  DEPT,
  INCOMPAT_AB,
  PATTERN_A1,
  PATTERN_A2,
  PATTERN_B2,
} from '../test/fixtures'

vi.mock('../api/choiceGroups', () => ({
  createChoiceGroup: vi.fn(),
  createIncompatibility: vi.fn(),
  deleteChoiceGroup: vi.fn(),
  deleteIncompatibility: vi.fn(),
  listChoiceGroups: vi.fn(),
  listIncompatibilities: vi.fn(),
  reorderChoiceGroups: vi.fn(),
  reorderIncompatibilities: vi.fn(),
  updateChoiceGroup: vi.fn(),
  updateIncompatibility: vi.fn(),
}))
vi.mock('../api/departments', () => ({ listDepartments: vi.fn() }))
vi.mock('../api/workPatterns', () => ({
  listWorkPatterns: vi.fn(),
  listWorkPatternGroups: vi.fn(),
}))

vi.mock('../components/choice-group/ChoiceGroupCsvUpload', () => ({
  default: ({ onImported }: { onImported: () => void }) => (
    <button data-testid="csv-upload" onClick={onImported}>
      csv
    </button>
  ),
}))
vi.mock('../components/choice-group/ChoiceGroupFormModal', () => ({
  default: ({
    mode,
    onClose,
    onSubmit,
  }: {
    mode: 'create' | 'edit'
    onClose: () => void
    onSubmit: (p: never) => Promise<void>
  }) => (
    <div data-testid="group-modal">
      <span>group-modal-{mode}</span>
      <button
        onClick={() =>
          onSubmit({
            day_of_weeks: [4],
            min_count: 1,
            max_count: 2,
            candidate_pattern_ids: [100, 101],
          } as never)
        }
      >
        group-submit
      </button>
      <button
        onClick={() =>
          onSubmit({
            day_of_weeks: [0, 3, null],
            min_count: 1,
            max_count: 1,
            candidate_pattern_ids: [100],
          } as never)
        }
      >
        group-submit-multi
      </button>
      <button onClick={onClose}>group-close</button>
    </div>
  ),
}))
vi.mock('../components/choice-group/IncompatibilityFormModal', () => ({
  default: ({
    mode,
    onClose,
    onSubmit,
  }: {
    mode: 'create' | 'edit'
    onClose: () => void
    onSubmit: (p: never) => Promise<void>
  }) => (
    <div data-testid="incomp-modal">
      <span>incomp-modal-{mode}</span>
      <button
        onClick={() =>
          onSubmit({ pattern_id_a: 100, pattern_id_b: 200 } as never)
        }
      >
        incomp-submit
      </button>
      <button onClick={onClose}>incomp-close</button>
    </div>
  ),
}))
vi.mock('../components/reorder/ReorderCommitBar', () => ({
  default: ({
    onCommit,
    label,
  }: {
    onCommit: (ids: number[]) => Promise<void> | void
    label: string
  }) => (
    <button
      data-testid={`reorder-commit-${label}`}
      onClick={() => onCommit([32, 31])}
    >
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
    default: ({
      children,
      className,
    }: {
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
const mockListPatterns = vi.mocked(listWorkPatterns)
const mockListG = vi.mocked(listChoiceGroups)
const mockListI = vi.mocked(listIncompatibilities)
const mockCreateG = vi.mocked(createChoiceGroup)
const mockUpdateG = vi.mocked(updateChoiceGroup)
const mockDeleteG = vi.mocked(deleteChoiceGroup)
const mockReorderG = vi.mocked(reorderChoiceGroups)
const mockCreateI = vi.mocked(createIncompatibility)
const mockDeleteI = vi.mocked(deleteIncompatibility)
const mockReorderI = vi.mocked(reorderIncompatibilities)
const mockUpdateIncomp = vi.mocked(updateIncompatibility)

beforeEach(() => {
  useChoiceGroupReorderStore.getState().exit()
  useIncompatibilityReorderStore.getState().exit()
  mockListDeps.mockReset()
  mockListPatterns.mockReset()
  mockListG.mockReset()
  mockListI.mockReset()
  mockCreateG.mockReset()
  mockUpdateG.mockReset()
  mockDeleteG.mockReset()
  mockReorderG.mockReset()
  mockCreateI.mockReset()
  mockDeleteI.mockReset()
  mockReorderI.mockReset()
  mockUpdateIncomp.mockReset()

  mockListDeps.mockResolvedValue([DEPT])
  mockListPatterns.mockResolvedValue([PATTERN_A1, PATTERN_A2, PATTERN_B2])
  mockListG.mockResolvedValue([CHOICE_GROUP_DAILY, CHOICE_GROUP_THU])
  mockListI.mockResolvedValue([INCOMPAT_AB])
})

afterEach(() => {
  useChoiceGroupReorderStore.getState().exit()
  useIncompatibilityReorderStore.getState().exit()
  vi.clearAllMocks()
})

describe('ChoiceGroupsPage — initial render', () => {
  it('fetches lookups and renders rows', async () => {
    render(<ChoiceGroupsPage />)
    await waitFor(() => expect(mockListG).toHaveBeenCalled())
    await waitFor(() => expect(mockListI).toHaveBeenCalled())
    expect(await screen.findByText('毎日')).toBeInTheDocument()
    expect(screen.getByText('木')).toBeInTheDocument()
    // 候補パターンが「A1 / A2」のように表示される
    expect(screen.getByText(/A1 \/ A2/)).toBeInTheDocument()
  })

  it('switches to incompat tab and renders rules', async () => {
    const user = userEvent.setup()
    render(<ChoiceGroupsPage />)
    await screen.findByText('毎日')
    await user.click(screen.getByRole('button', { name: '非両立ルール' }))
    expect(await screen.findByText('A1')).toBeInTheDocument()
    expect(screen.getByText('B2')).toBeInTheDocument()
  })

  it('選択数を1列で表示し、min==maxは単一値・範囲は "min〜max"', async () => {
    render(<ChoiceGroupsPage />)
    expect(await screen.findByText('毎日')).toBeInTheDocument()
    // 範囲 (木, min=0/max=2) は "0〜2"
    const thuRow = screen.getByText('木').closest('tr') as HTMLElement
    expect(within(thuRow).getByText('0〜2')).toBeInTheDocument()
    // 固定 (毎日, min=max=1) は "1" のみ ("1〜1" にしない)
    const dailyRow = screen.getByText('毎日').closest('tr') as HTMLElement
    expect(within(dailyRow).getByText('1')).toBeInTheDocument()
    expect(within(dailyRow).queryByText('1〜1')).not.toBeInTheDocument()
  })
})

describe('ChoiceGroupsPage — modal CRUD', () => {
  it('opens create modal for groups', async () => {
    const user = userEvent.setup()
    render(<ChoiceGroupsPage />)
    await screen.findByText('毎日')
    await user.click(screen.getByRole('button', { name: '+ 新規追加' }))
    expect(screen.getByText('group-modal-create')).toBeInTheDocument()
  })

  it('opens edit modal for groups', async () => {
    const user = userEvent.setup()
    render(<ChoiceGroupsPage />)
    await screen.findByText('毎日')
    await user.click(screen.getAllByRole('button', { name: '編集' })[0])
    expect(screen.getByText('group-modal-edit')).toBeInTheDocument()
  })

  it('group create submit calls createChoiceGroup with department_id', async () => {
    mockCreateG.mockResolvedValueOnce(CHOICE_GROUP_DAILY)
    const user = userEvent.setup()
    render(<ChoiceGroupsPage />)
    await screen.findByText('毎日')
    await user.click(screen.getByRole('button', { name: '+ 新規追加' }))
    await user.click(screen.getByRole('button', { name: 'group-submit' }))
    await waitFor(() => {
      expect(mockCreateG).toHaveBeenCalledWith(
        expect.objectContaining({
          department_id: 1,
          day_of_week: 4,
          min_count: 1,
          max_count: 2,
          candidate_pattern_ids: [100, 101],
        }),
      )
    })
    expect(mockListG).toHaveBeenCalledTimes(2)
  })

  it('multi-day create fires createChoiceGroup once per selected day with null=毎日', async () => {
    mockCreateG.mockResolvedValue(CHOICE_GROUP_DAILY)
    const user = userEvent.setup()
    render(<ChoiceGroupsPage />)
    await screen.findByText('毎日')
    await user.click(screen.getByRole('button', { name: '+ 新規追加' }))
    await user.click(screen.getByRole('button', { name: 'group-submit-multi' }))
    await waitFor(() => {
      expect(mockCreateG).toHaveBeenCalledTimes(3)
    })
    const calledDows = mockCreateG.mock.calls.map((c) => c[0].day_of_week)
    // 順序保持（FormModal が Array.from(Set) の順で渡す）
    expect(calledDows).toEqual([0, 3, null])
  })

  it('group edit submit calls updateChoiceGroup with item id and day_of_week (issue #115)', async () => {
    mockUpdateG.mockResolvedValueOnce(CHOICE_GROUP_DAILY)
    const user = userEvent.setup()
    render(<ChoiceGroupsPage />)
    await screen.findByText('毎日')
    await user.click(screen.getAllByRole('button', { name: '編集' })[0])
    await user.click(screen.getByRole('button', { name: 'group-submit' }))
    await waitFor(() => {
      expect(mockUpdateG).toHaveBeenCalledWith(
        CHOICE_GROUP_DAILY.id,
        expect.objectContaining({
          day_of_week: 4,
          min_count: 1,
          max_count: 2,
          candidate_pattern_ids: [100, 101],
        }),
      )
    })
  })

  it('opens create modal for incompat on incompat tab', async () => {
    const user = userEvent.setup()
    render(<ChoiceGroupsPage />)
    await screen.findByText('毎日')
    await user.click(screen.getByRole('button', { name: '非両立ルール' }))
    await user.click(screen.getByRole('button', { name: '+ 新規追加' }))
    expect(screen.getByText('incomp-modal-create')).toBeInTheDocument()
  })

  it('opens edit modal for incompat from row 編集 button', async () => {
    const user = userEvent.setup()
    render(<ChoiceGroupsPage />)
    await screen.findByText('毎日')
    await user.click(screen.getByRole('button', { name: '非両立ルール' }))
    await screen.findByText('A1')
    await user.click(screen.getAllByRole('button', { name: '編集' })[0])
    expect(screen.getByText('incomp-modal-edit')).toBeInTheDocument()
  })

  it('incomp edit submit calls updateIncompatibility with item id', async () => {
    mockUpdateIncomp.mockResolvedValueOnce(INCOMPAT_AB)
    const user = userEvent.setup()
    render(<ChoiceGroupsPage />)
    await screen.findByText('毎日')
    await user.click(screen.getByRole('button', { name: '非両立ルール' }))
    await screen.findByText('A1')
    await user.click(screen.getAllByRole('button', { name: '編集' })[0])
    await user.click(screen.getByRole('button', { name: 'incomp-submit' }))
    await waitFor(() =>
      expect(mockUpdateIncomp).toHaveBeenCalledWith(
        INCOMPAT_AB.id,
        expect.objectContaining({ pattern_id_a: 100, pattern_id_b: 200 }),
      ),
    )
  })

  it('incomp create submit calls createIncompatibility', async () => {
    mockCreateI.mockResolvedValueOnce(INCOMPAT_AB)
    const user = userEvent.setup()
    render(<ChoiceGroupsPage />)
    await screen.findByText('毎日')
    await user.click(screen.getByRole('button', { name: '非両立ルール' }))
    await user.click(screen.getByRole('button', { name: '+ 新規追加' }))
    await user.click(screen.getByRole('button', { name: 'incomp-submit' }))
    await waitFor(() => {
      expect(mockCreateI).toHaveBeenCalledWith(
        expect.objectContaining({
          department_id: 1,
          pattern_id_a: 100,
          pattern_id_b: 200,
        }),
      )
    })
  })

  it('incompat tab now renders 編集 buttons (PUT endpoint added)', async () => {
    const user = userEvent.setup()
    render(<ChoiceGroupsPage />)
    await screen.findByText('毎日')
    await user.click(screen.getByRole('button', { name: '非両立ルール' }))
    await screen.findByText('A1')
    // 1 行 1 編集ボタン
    expect(screen.getAllByRole('button', { name: '編集' }).length).toBeGreaterThan(0)
  })
})

describe('ChoiceGroupsPage — bulk delete', () => {
  it('selects multiple group rows and bulk-deletes them', async () => {
    mockDeleteG.mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<ChoiceGroupsPage />)
    await screen.findByText('毎日')
    const dailyBox = screen.getByRole('checkbox', { name: /毎日 の行を選択/ })
    const thuBox = screen.getByRole('checkbox', { name: /木 の行を選択/ })
    await user.click(dailyBox)
    await user.click(thuBox)
    await user.click(screen.getByRole('button', { name: /2 件削除/ }))
    await screen.findByText(/選択した 2 件を削除しますか？/)
    await user.click(screen.getByRole('button', { name: '削除する' }))
    await waitFor(() => expect(mockDeleteG).toHaveBeenCalledTimes(2))
    const calledIds = mockDeleteG.mock.calls.map((c) => c[0]).sort()
    expect(calledIds).toEqual([CHOICE_GROUP_DAILY.id, CHOICE_GROUP_THU.id].sort())
  })
})

describe('ChoiceGroupsPage — delete', () => {
  it('confirms group deletion calls deleteChoiceGroup', async () => {
    mockDeleteG.mockResolvedValueOnce(undefined)
    const user = userEvent.setup()
    render(<ChoiceGroupsPage />)
    await screen.findByText('毎日')
    await user.click(screen.getAllByRole('button', { name: '削除' })[0])
    await screen.findByText('選択グループを削除しますか？')
    await user.click(screen.getByRole('button', { name: '削除する' }))
    await waitFor(() =>
      expect(mockDeleteG).toHaveBeenCalledWith(CHOICE_GROUP_DAILY.id),
    )
  })

  it('confirms incompat deletion calls deleteIncompatibility', async () => {
    mockDeleteI.mockResolvedValueOnce(undefined)
    const user = userEvent.setup()
    render(<ChoiceGroupsPage />)
    await screen.findByText('毎日')
    await user.click(screen.getByRole('button', { name: '非両立ルール' }))
    await screen.findByText('A1')
    await user.click(screen.getAllByRole('button', { name: '削除' })[0])
    await screen.findByText('非両立ルールを削除しますか？')
    await user.click(screen.getByRole('button', { name: '削除する' }))
    await waitFor(() =>
      expect(mockDeleteI).toHaveBeenCalledWith(INCOMPAT_AB.id),
    )
  })
})

describe('ChoiceGroupsPage — reorder', () => {
  it('groups reorder commit calls reorderChoiceGroups', async () => {
    mockReorderG.mockResolvedValueOnce([])
    const user = userEvent.setup()
    render(<ChoiceGroupsPage />)
    await screen.findByText('毎日')
    await user.click(screen.getByRole('button', { name: '⇅ 並び替え' }))
    await user.click(screen.getByTestId('reorder-commit-選択グループ'))
    await waitFor(() => expect(mockReorderG).toHaveBeenCalledWith(1, [32, 31]))
    expect(useChoiceGroupReorderStore.getState().mode).toBe('view')
    expect(useChoiceGroupReorderStore.getState().toast?.kind).toBe('success')
  })

  it('incomp reorder is disabled with single row', async () => {
    const user = userEvent.setup()
    render(<ChoiceGroupsPage />)
    await screen.findByText('毎日')
    await user.click(screen.getByRole('button', { name: '非両立ルール' }))
    expect(screen.getByRole('button', { name: '⇅ 並び替え' })).toBeDisabled()
  })

  it('groups reorder error sets error toast', async () => {
    mockReorderG.mockRejectedValueOnce({
      response: { data: { detail: '並び順衝突' } },
    })
    const user = userEvent.setup()
    render(<ChoiceGroupsPage />)
    await screen.findByText('毎日')
    await user.click(screen.getByRole('button', { name: '⇅ 並び替え' }))
    await user.click(screen.getByTestId('reorder-commit-選択グループ'))
    await waitFor(() => {
      expect(useChoiceGroupReorderStore.getState().toast?.kind).toBe('error')
    })
  })
})

describe('ChoiceGroupsPage — CSV import', () => {
  it('CSV import triggers reload', async () => {
    const user = userEvent.setup()
    render(<ChoiceGroupsPage />)
    await screen.findByText('毎日')
    expect(mockListG).toHaveBeenCalledTimes(1)
    await user.click(screen.getByTestId('csv-upload'))
    await waitFor(() => expect(mockListG).toHaveBeenCalledTimes(2))
  })
})
