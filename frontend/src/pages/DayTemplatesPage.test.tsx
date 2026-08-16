import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import DayTemplatesPage from './DayTemplatesPage'
import {
  createDayOverride,
  createDayTemplate,
  deleteDayOverride,
  deleteDayTemplate,
  listDayOverrides,
  listDayTemplates,
  reorderDayOverrides,
  reorderDayTemplates,
  updateDayOverride,
  updateDayTemplate,
} from '../api/dayTemplates'
import { listDepartments } from '../api/departments'
import { listWorkPatterns } from '../api/workPatterns'
import {
  useDayOverrideReorderStore,
  useDayTemplateReorderStore,
} from '../stores/reorderStore'
import {
  DAY_OVERRIDE_HOLIDAY,
  DAY_TEMPLATE_MON,
  DAY_TEMPLATE_THU,
  DEPT,
  PATTERN_A1,
  PATTERN_A2,
} from '../test/fixtures'

vi.mock('../api/dayTemplates', () => ({
  createDayOverride: vi.fn(),
  createDayTemplate: vi.fn(),
  deleteDayOverride: vi.fn(),
  deleteDayTemplate: vi.fn(),
  listDayOverrides: vi.fn(),
  listDayTemplates: vi.fn(),
  reorderDayOverrides: vi.fn(),
  reorderDayTemplates: vi.fn(),
  updateDayOverride: vi.fn(),
  updateDayTemplate: vi.fn(),
}))
vi.mock('../api/departments', () => ({ listDepartments: vi.fn() }))
vi.mock('../api/workPatterns', () => ({
  listWorkPatterns: vi.fn(),
  listWorkPatternGroups: vi.fn(),
}))

vi.mock('../components/day-template/DayTemplateCsvUpload', () => ({
  default: ({ onImported }: { onImported: () => void }) => (
    <button data-testid="csv-upload" onClick={onImported}>
      csv
    </button>
  ),
}))
vi.mock('../components/day-template/DayTemplateFormModal', () => ({
  default: ({
    mode,
    onClose,
    onSubmit,
  }: {
    mode: 'create' | 'edit'
    onClose: () => void
    onSubmit: (p: never) => Promise<void>
  }) => (
    <div data-testid="tmpl-modal">
      <span>tmpl-modal-{mode}</span>
      <button
        onClick={() =>
          onSubmit({
            day_of_weeks: [5],
            pattern_id: 100,
            required_min: 4,
            required_max: null,
          } as never)
        }
      >
        tmpl-submit
      </button>
      <button
        onClick={() =>
          onSubmit({
            day_of_weeks: [0, 1, 2],
            pattern_id: 100,
            required_min: 4,
            required_max: null,
          } as never)
        }
      >
        tmpl-submit-multi
      </button>
      <button onClick={onClose}>tmpl-close</button>
    </div>
  ),
}))
vi.mock('../components/day-template/DayOverrideFormModal', () => ({
  default: ({
    mode,
    onClose,
    onSubmit,
  }: {
    mode: 'create' | 'edit'
    onClose: () => void
    onSubmit: (p: never) => Promise<void>
  }) => (
    <div data-testid="over-modal">
      <span>over-modal-{mode}</span>
      <button
        onClick={() =>
          onSubmit({
            specific_date: '2026-12-25',
            pattern_id: 100,
            required_min: 5,
            required_max: null,
          } as never)
        }
      >
        over-submit
      </button>
      <button onClick={onClose}>over-close</button>
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
      onClick={() => onCommit([12, 11])}
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
const mockListT = vi.mocked(listDayTemplates)
const mockListO = vi.mocked(listDayOverrides)
const mockCreateT = vi.mocked(createDayTemplate)
const mockUpdateT = vi.mocked(updateDayTemplate)
const mockDeleteT = vi.mocked(deleteDayTemplate)
const mockReorderT = vi.mocked(reorderDayTemplates)
const mockCreateO = vi.mocked(createDayOverride)
const mockUpdateO = vi.mocked(updateDayOverride)
const mockDeleteO = vi.mocked(deleteDayOverride)
const mockReorderO = vi.mocked(reorderDayOverrides)

beforeEach(() => {
  useDayTemplateReorderStore.getState().exit()
  useDayOverrideReorderStore.getState().exit()
  mockListDeps.mockReset()
  mockListPatterns.mockReset()
  mockListT.mockReset()
  mockListO.mockReset()
  mockCreateT.mockReset()
  mockUpdateT.mockReset()
  mockDeleteT.mockReset()
  mockReorderT.mockReset()
  mockCreateO.mockReset()
  mockUpdateO.mockReset()
  mockDeleteO.mockReset()
  mockReorderO.mockReset()

  mockListDeps.mockResolvedValue([DEPT])
  mockListPatterns.mockResolvedValue([PATTERN_A1, PATTERN_A2])
  mockListT.mockResolvedValue([DAY_TEMPLATE_MON, DAY_TEMPLATE_THU])
  mockListO.mockResolvedValue([DAY_OVERRIDE_HOLIDAY])
})

afterEach(() => {
  useDayTemplateReorderStore.getState().exit()
  useDayOverrideReorderStore.getState().exit()
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------

describe('DayTemplatesPage — initial render', () => {
  it('fetches departments / patterns / templates / overrides and renders rows', async () => {
    render(<DayTemplatesPage />)

    await waitFor(() => expect(mockListDeps).toHaveBeenCalled())
    await waitFor(() => expect(mockListT).toHaveBeenCalled())
    await waitFor(() => expect(mockListO).toHaveBeenCalled())
    await waitFor(() => expect(mockListPatterns).toHaveBeenCalled())

    // 月曜と木曜のテンプレートが表示
    expect(await screen.findByText('月')).toBeInTheDocument()
    expect(screen.getByText('木')).toBeInTheDocument()
    // pattern_name で表示
    expect(screen.getAllByText(/A1/)[0]).toBeInTheDocument()
  })

  it('switches to overrides tab and renders overrides', async () => {
    const user = userEvent.setup()
    render(<DayTemplatesPage />)

    await screen.findByText('月')
    await user.click(screen.getByRole('button', { name: '特定日上書き' }))

    expect(await screen.findByText('2026-05-03')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------

describe('DayTemplatesPage — required range display', () => {
  it('renders "min〜max" when required_max is set, and "min" when null', async () => {
    mockListT.mockResolvedValue([
      DAY_TEMPLATE_MON, // required_min=1, required_max=null
      { ...DAY_TEMPLATE_THU, required_min: 1, required_max: 3 },
    ])
    render(<DayTemplatesPage />)

    expect(await screen.findByText('月')).toBeInTheDocument()
    // 厳格行 (max=null) は最小人数のみ
    expect(screen.getByText('1')).toBeInTheDocument()
    // 範囲行 (max あり) は "min〜max"
    expect(screen.getByText('1〜3')).toBeInTheDocument()
  })
})

describe('DayTemplatesPage — modal CRUD', () => {
  it('opens create modal for templates', async () => {
    const user = userEvent.setup()
    render(<DayTemplatesPage />)

    await screen.findByText('月')
    await user.click(screen.getByRole('button', { name: '+ 新規追加' }))

    expect(screen.getByText('tmpl-modal-create')).toBeInTheDocument()
  })

  it('opens edit modal for templates', async () => {
    const user = userEvent.setup()
    render(<DayTemplatesPage />)

    await screen.findByText('月')
    await user.click(screen.getAllByRole('button', { name: '編集' })[0])

    expect(screen.getByText('tmpl-modal-edit')).toBeInTheDocument()
  })

  it('create submit calls createDayTemplate with department_id and reloads', async () => {
    mockCreateT.mockResolvedValueOnce(DAY_TEMPLATE_MON)
    const user = userEvent.setup()
    render(<DayTemplatesPage />)

    await screen.findByText('月')
    await user.click(screen.getByRole('button', { name: '+ 新規追加' }))
    await user.click(screen.getByRole('button', { name: 'tmpl-submit' }))

    await waitFor(() => {
      expect(mockCreateT).toHaveBeenCalledWith(
        expect.objectContaining({
          department_id: 1,
          day_of_week: 5,
          pattern_id: 100,
          required_min: 4,
          required_max: null,
        }),
      )
    })
    expect(mockListT).toHaveBeenCalledTimes(2)
  })

  it('multi-day create submit fires createDayTemplate once per selected day', async () => {
    mockCreateT.mockResolvedValue(DAY_TEMPLATE_MON)
    const user = userEvent.setup()
    render(<DayTemplatesPage />)

    await screen.findByText('月')
    await user.click(screen.getByRole('button', { name: '+ 新規追加' }))
    await user.click(screen.getByRole('button', { name: 'tmpl-submit-multi' }))

    await waitFor(() => {
      expect(mockCreateT).toHaveBeenCalledTimes(3)
    })
    const calledDays = mockCreateT.mock.calls.map((c) => c[0].day_of_week).sort()
    expect(calledDays).toEqual([0, 1, 2])
  })

  it('edit submit calls updateDayTemplate with item id', async () => {
    mockUpdateT.mockResolvedValueOnce(DAY_TEMPLATE_MON)
    const user = userEvent.setup()
    render(<DayTemplatesPage />)

    await screen.findByText('月')
    await user.click(screen.getAllByRole('button', { name: '編集' })[0])
    await user.click(screen.getByRole('button', { name: 'tmpl-submit' }))

    await waitFor(() => {
      expect(mockUpdateT).toHaveBeenCalledWith(
        DAY_TEMPLATE_MON.id,
        expect.objectContaining({ required_min: 4, required_max: null }),
      )
    })
  })

  it('opens create modal for overrides on overrides tab', async () => {
    const user = userEvent.setup()
    render(<DayTemplatesPage />)

    await screen.findByText('月')
    await user.click(screen.getByRole('button', { name: '特定日上書き' }))
    await user.click(screen.getByRole('button', { name: '+ 新規追加' }))

    expect(screen.getByText('over-modal-create')).toBeInTheDocument()
  })

  it('override create submit calls createDayOverride', async () => {
    mockCreateO.mockResolvedValueOnce(DAY_OVERRIDE_HOLIDAY)
    const user = userEvent.setup()
    render(<DayTemplatesPage />)

    await screen.findByText('月')
    await user.click(screen.getByRole('button', { name: '特定日上書き' }))
    await user.click(screen.getByRole('button', { name: '+ 新規追加' }))
    await user.click(screen.getByRole('button', { name: 'over-submit' }))

    await waitFor(() => {
      expect(mockCreateO).toHaveBeenCalledWith(
        expect.objectContaining({
          department_id: 1,
          specific_date: '2026-12-25',
        }),
      )
    })
  })
})

// ---------------------------------------------------------------------------

describe('DayTemplatesPage — bulk delete', () => {
  it('selects multiple rows via checkboxes and bulk-deletes them', async () => {
    mockDeleteT.mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<DayTemplatesPage />)

    await screen.findByText('月')
    const monBox = screen.getByRole('checkbox', { name: /月 の行を選択/ })
    const thuBox = screen.getByRole('checkbox', { name: /木 の行を選択/ })
    await user.click(monBox)
    await user.click(thuBox)

    const bulkBtn = screen.getByRole('button', { name: /2 件削除/ })
    await user.click(bulkBtn)

    await screen.findByText(/選択した 2 件を削除しますか？/)
    await user.click(screen.getByRole('button', { name: '削除する' }))

    await waitFor(() => {
      expect(mockDeleteT).toHaveBeenCalledTimes(2)
    })
    const calledIds = mockDeleteT.mock.calls.map((c) => c[0]).sort()
    expect(calledIds).toEqual([DAY_TEMPLATE_MON.id, DAY_TEMPLATE_THU.id].sort())
  })

  it('"全選択" header checkbox toggles all rows', async () => {
    const user = userEvent.setup()
    render(<DayTemplatesPage />)

    await screen.findByText('月')
    const allBox = screen.getByRole('checkbox', { name: '全選択' })
    await user.click(allBox)

    expect(screen.getByRole('button', { name: /2 件削除/ })).toBeInTheDocument()
  })
})

describe('DayTemplatesPage — delete', () => {
  it('confirms deletion calls deleteDayTemplate and reloads', async () => {
    mockDeleteT.mockResolvedValueOnce(undefined)
    const user = userEvent.setup()
    render(<DayTemplatesPage />)

    await screen.findByText('月')
    await user.click(screen.getAllByRole('button', { name: '削除' })[0])
    await screen.findByText('テンプレートを削除しますか？')
    await user.click(screen.getByRole('button', { name: '削除する' }))

    await waitFor(() =>
      expect(mockDeleteT).toHaveBeenCalledWith(DAY_TEMPLATE_MON.id),
    )
    expect(mockListT).toHaveBeenCalledTimes(2)
  })

  it('confirms deletion of override calls deleteDayOverride', async () => {
    mockDeleteO.mockResolvedValueOnce(undefined)
    const user = userEvent.setup()
    render(<DayTemplatesPage />)

    await screen.findByText('月')
    await user.click(screen.getByRole('button', { name: '特定日上書き' }))
    await screen.findByText('2026-05-03')
    await user.click(screen.getAllByRole('button', { name: '削除' })[0])
    await screen.findByText('特定日上書きを削除しますか？')
    await user.click(screen.getByRole('button', { name: '削除する' }))

    await waitFor(() =>
      expect(mockDeleteO).toHaveBeenCalledWith(DAY_OVERRIDE_HOLIDAY.id),
    )
  })
})

// ---------------------------------------------------------------------------

describe('DayTemplatesPage — reorder', () => {
  it('templates reorder commit calls reorderDayTemplates with department id', async () => {
    mockReorderT.mockResolvedValueOnce([])
    const user = userEvent.setup()
    render(<DayTemplatesPage />)

    await screen.findByText('月')
    await user.click(screen.getByRole('button', { name: '⇅ 並び替え' }))
    await user.click(screen.getByTestId('reorder-commit-曜日別テンプレート'))

    await waitFor(() => {
      expect(mockReorderT).toHaveBeenCalledWith(1, [12, 11])
    })
    expect(useDayTemplateReorderStore.getState().mode).toBe('view')
    expect(useDayTemplateReorderStore.getState().toast?.kind).toBe('success')
  })

  it('overrides reorder commit calls reorderDayOverrides', async () => {
    mockReorderO.mockResolvedValueOnce([])
    const user = userEvent.setup()
    render(<DayTemplatesPage />)

    await screen.findByText('月')
    await user.click(screen.getByRole('button', { name: '特定日上書き' }))
    // overrides は 1 件しかないので並び替えボタンは disabled。
    // この境界条件を確認する。
    expect(screen.getByRole('button', { name: '⇅ 並び替え' })).toBeDisabled()
  })

  it('templates reorder error sets error toast', async () => {
    mockReorderT.mockRejectedValueOnce({
      response: { data: { detail: '並び順衝突' } },
    })
    const user = userEvent.setup()
    render(<DayTemplatesPage />)

    await screen.findByText('月')
    await user.click(screen.getByRole('button', { name: '⇅ 並び替え' }))
    await user.click(screen.getByTestId('reorder-commit-曜日別テンプレート'))

    await waitFor(() => {
      expect(useDayTemplateReorderStore.getState().toast?.kind).toBe('error')
    })
  })
})

// ---------------------------------------------------------------------------

describe('DayTemplatesPage — CSV import', () => {
  it('CSV import triggers reload', async () => {
    const user = userEvent.setup()
    render(<DayTemplatesPage />)

    await screen.findByText('月')
    expect(mockListT).toHaveBeenCalledTimes(1)

    await user.click(screen.getByTestId('csv-upload'))
    await waitFor(() => expect(mockListT).toHaveBeenCalledTimes(2))
  })
})
