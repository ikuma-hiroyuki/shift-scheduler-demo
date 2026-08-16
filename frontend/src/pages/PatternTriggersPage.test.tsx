import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import PatternTriggersPage from './PatternTriggersPage'
import {
  createPatternTrigger,
  deletePatternTrigger,
  listPatternTriggers,
  reorderPatternTriggers,
  updatePatternTrigger,
} from '../api/patternTriggers'
import { listDepartments } from '../api/departments'
import { listWorkPatternGroups } from '../api/workPatterns'
import { usePatternTriggerReorderStore } from '../stores/reorderStore'
import {
  DEPT,
  GROUP_A,
  GROUP_AUX,
  GROUP_B,
  GROUP_C_REQ,
  PATTERN_TRIGGER_AUX_AC,
} from '../test/fixtures'

vi.mock('../api/patternTriggers', () => ({
  createPatternTrigger: vi.fn(),
  deletePatternTrigger: vi.fn(),
  listPatternTriggers: vi.fn(),
  reorderPatternTriggers: vi.fn(),
  updatePatternTrigger: vi.fn(),
}))
vi.mock('../api/departments', () => ({ listDepartments: vi.fn() }))
vi.mock('../api/workPatterns', () => ({
  listWorkPatternGroups: vi.fn(),
}))

vi.mock('../components/pattern-trigger/PatternTriggerCsvUpload', () => ({
  default: ({ onImported }: { onImported: () => void }) => (
    <button data-testid="csv-upload" onClick={onImported}>
      csv
    </button>
  ),
}))
vi.mock('../components/pattern-trigger/PatternTriggerFormModal', () => ({
  default: ({
    mode,
    onClose,
    onSubmit,
  }: {
    mode: 'create' | 'edit'
    onClose: () => void
    onSubmit: (p: never) => Promise<void>
  }) => (
    <div data-testid="pt-modal">
      <span>pt-modal-{mode}</span>
      <button
        onClick={() =>
          onSubmit({
            auxiliary_group_id: 40,
            required_group_ids: [10, 30],
          } as never)
        }
      >
        pt-submit
      </button>
      <button onClick={onClose}>pt-close</button>
    </div>
  ),
}))

const mockListDepartments = vi.mocked(listDepartments)
const mockListWorkPatternGroups = vi.mocked(listWorkPatternGroups)
const mockListTriggers = vi.mocked(listPatternTriggers)
const mockCreate = vi.mocked(createPatternTrigger)
const mockUpdate = vi.mocked(updatePatternTrigger)
const mockDelete = vi.mocked(deletePatternTrigger)
const mockReorder = vi.mocked(reorderPatternTriggers)

beforeEach(() => {
  mockListDepartments.mockResolvedValue([DEPT])
  mockListWorkPatternGroups.mockResolvedValue([GROUP_A, GROUP_B, GROUP_C_REQ, GROUP_AUX])
  mockListTriggers.mockResolvedValue([PATTERN_TRIGGER_AUX_AC])
  mockCreate.mockResolvedValue(PATTERN_TRIGGER_AUX_AC)
  mockUpdate.mockResolvedValue(PATTERN_TRIGGER_AUX_AC)
  mockDelete.mockResolvedValue(undefined)
  mockReorder.mockResolvedValue([PATTERN_TRIGGER_AUX_AC])
})

afterEach(() => {
  vi.clearAllMocks()
  // reorder store をクリア（並び替えモード残留を防ぐ）
  usePatternTriggerReorderStore.getState().exit()
})

describe('PatternTriggersPage', () => {
  it('renders trigger row with aux + required group names', async () => {
    render(<PatternTriggersPage />)
    await waitFor(() => expect(mockListTriggers).toHaveBeenCalled())
    expect(await screen.findByText('AUX')).toBeInTheDocument()
    expect(screen.getByText('A / C')).toBeInTheDocument()
  })

  it('opens create modal and submits create payload', async () => {
    const user = userEvent.setup()
    render(<PatternTriggersPage />)
    await waitFor(() => expect(mockListTriggers).toHaveBeenCalled())
    await user.click(await screen.findByRole('button', { name: '+ 新規追加' }))
    expect(await screen.findByTestId('pt-modal')).toHaveTextContent('pt-modal-create')
    await user.click(screen.getByRole('button', { name: 'pt-submit' }))
    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith({
        department_id: DEPT.id,
        auxiliary_group_id: 40,
        required_group_ids: [10, 30],
      }),
    )
  })

  it('opens edit modal and submits update payload', async () => {
    const user = userEvent.setup()
    render(<PatternTriggersPage />)
    await waitFor(() => expect(mockListTriggers).toHaveBeenCalled())
    await user.click(await screen.findByRole('button', { name: '編集' }))
    expect(await screen.findByTestId('pt-modal')).toHaveTextContent('pt-modal-edit')
    await user.click(screen.getByRole('button', { name: 'pt-submit' }))
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith(PATTERN_TRIGGER_AUX_AC.id, {
        auxiliary_group_id: 40,
        required_group_ids: [10, 30],
      }),
    )
  })

  it('confirms and deletes a single trigger', async () => {
    const user = userEvent.setup()
    render(<PatternTriggersPage />)
    await waitFor(() => expect(mockListTriggers).toHaveBeenCalled())
    await user.click(await screen.findByRole('button', { name: '削除' }))
    expect(
      await screen.findByText('発生条件を削除しますか？'),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '削除する' }))
    await waitFor(() =>
      expect(mockDelete).toHaveBeenCalledWith(PATTERN_TRIGGER_AUX_AC.id),
    )
  })

  it('disables 並び替え button when only 1 trigger exists', async () => {
    render(<PatternTriggersPage />)
    await waitFor(() => expect(mockListTriggers).toHaveBeenCalled())
    const reorderBtn = await screen.findByRole('button', { name: '⇅ 並び替え' })
    expect(reorderBtn).toBeDisabled()
  })
})
