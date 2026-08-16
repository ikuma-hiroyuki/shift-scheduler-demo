import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import ChoiceGroupFormModal from './ChoiceGroupFormModal'
import {
  CHOICE_GROUP_DAILY,
  PATTERN_A1,
  PATTERN_A2,
  PATTERN_B2,
} from '../../test/fixtures'

let onClose: ReturnType<typeof vi.fn>
let onSubmit: ReturnType<typeof vi.fn>

const PATTERNS = [PATTERN_A1, PATTERN_A2, PATTERN_B2]

beforeEach(() => {
  onClose = vi.fn()
  onSubmit = vi.fn().mockResolvedValue(undefined)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('ChoiceGroupFormModal — create mode', () => {
  it('renders header, weekday checkboxes (毎日 + 月-日), and candidate buttons', () => {
    render(
      <ChoiceGroupFormModal
        mode="create"
        initial={null}
        patterns={PATTERNS}
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    )
    expect(screen.getByText('選択グループを追加')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '毎日' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '月' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '日' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'A1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'B2' })).toBeInTheDocument()
  })

  it('rejects submit when no candidate is selected', async () => {
    const user = userEvent.setup()
    render(
      <ChoiceGroupFormModal
        mode="create"
        initial={null}
        patterns={PATTERNS}
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    )
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(
      await screen.findByText('候補パターンを 1 つ以上選択してください'),
    ).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('rejects submit when min > max', async () => {
    const user = userEvent.setup()
    render(
      <ChoiceGroupFormModal
        mode="create"
        initial={null}
        patterns={PATTERNS}
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    )
    const inputs = screen.getAllByRole('spinbutton')
    await user.clear(inputs[0])
    await user.type(inputs[0], '3')
    await user.clear(inputs[1])
    await user.type(inputs[1], '1')
    await user.click(screen.getByRole('button', { name: 'A1' }))
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(
      await screen.findByText('min_count は max_count 以下で入力してください'),
    ).toBeInTheDocument()
  })

  it('rejects submit when no weekday is selected', async () => {
    const user = userEvent.setup()
    render(
      <ChoiceGroupFormModal
        mode="create"
        initial={null}
        patterns={PATTERNS}
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'A1' }))
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(
      await screen.findByText('曜日を 1 つ以上選択してください'),
    ).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submits with day_of_weeks=[null] when 毎日 is selected', async () => {
    const user = userEvent.setup()
    render(
      <ChoiceGroupFormModal
        mode="create"
        initial={null}
        patterns={PATTERNS}
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    )
    await user.click(screen.getByRole('button', { name: '毎日' }))
    await user.click(screen.getByRole('button', { name: 'A1' }))
    await user.click(screen.getByRole('button', { name: 'A2' }))
    await user.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        day_of_weeks: [null],
        min_count: 1,
        max_count: 1,
        candidate_pattern_ids: [PATTERN_A1.id, PATTERN_A2.id],
      }),
    )
    expect(onClose).toHaveBeenCalled()
  })

  it('submits with day_of_weeks containing multiple weekdays', async () => {
    const user = userEvent.setup()
    render(
      <ChoiceGroupFormModal
        mode="create"
        initial={null}
        patterns={PATTERNS}
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    )
    await user.click(screen.getByRole('button', { name: '月' }))
    await user.click(screen.getByRole('button', { name: '木' }))
    await user.click(screen.getByRole('button', { name: 'B2' }))
    await user.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          day_of_weeks: expect.arrayContaining([0, 3]),
          candidate_pattern_ids: [PATTERN_B2.id],
        }),
      ),
    )
    const call = onSubmit.mock.calls[0][0]
    expect(call.day_of_weeks).toHaveLength(2)
  })

  it('「毎日」is mutually exclusive with specific weekdays', async () => {
    const user = userEvent.setup()
    render(
      <ChoiceGroupFormModal
        mode="create"
        initial={null}
        patterns={PATTERNS}
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    )
    await user.click(screen.getByRole('button', { name: '月' }))
    await user.click(screen.getByRole('button', { name: '毎日' }))
    await user.click(screen.getByRole('button', { name: 'A1' }))
    await user.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ day_of_weeks: [null] }),
      ),
    )
  })
})

describe('ChoiceGroupFormModal — edit mode', () => {
  it('prefills initial values and keeps weekday selector enabled (issue #115)', () => {
    render(
      <ChoiceGroupFormModal
        mode="edit"
        initial={CHOICE_GROUP_DAILY}
        patterns={PATTERNS}
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    )
    expect(screen.getByText('選択グループを編集')).toBeInTheDocument()
    // edit モードで曜日 select が有効になっている (issue #115)
    expect(screen.getByRole('combobox')).not.toBeDisabled()
    // 「曜日は編集できません」の補足文が削除されている
    expect(
      screen.queryByText(/曜日は編集できません/),
    ).not.toBeInTheDocument()
  })

  it('submits with changed day_of_weeks when user picks another weekday', async () => {
    const user = userEvent.setup()
    render(
      <ChoiceGroupFormModal
        mode="edit"
        initial={CHOICE_GROUP_DAILY}
        patterns={PATTERNS}
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    )
    // 「毎日」(null=-1) から「水(2)」へ変更して保存
    await user.selectOptions(screen.getByRole('combobox'), '2')
    await user.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          day_of_weeks: [2],
          candidate_pattern_ids: expect.arrayContaining([100, 101]),
        }),
      ),
    )
  })

  it('submits with id-loaded candidates intact and day_of_weeks length=1', async () => {
    const user = userEvent.setup()
    render(
      <ChoiceGroupFormModal
        mode="edit"
        initial={CHOICE_GROUP_DAILY}
        patterns={PATTERNS}
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    )
    await user.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          day_of_weeks: [null],
          candidate_pattern_ids: expect.arrayContaining([100, 101]),
        }),
      ),
    )
  })
})
