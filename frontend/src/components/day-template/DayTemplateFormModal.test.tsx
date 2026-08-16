import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import DayTemplateFormModal from './DayTemplateFormModal'
import { DAY_TEMPLATE_MON, PATTERN_A1, PATTERN_A2 } from '../../test/fixtures'

let onClose: ReturnType<typeof vi.fn>
let onSubmit: ReturnType<typeof vi.fn>

const PATTERNS = [PATTERN_A1, PATTERN_A2]

beforeEach(() => {
  onClose = vi.fn()
  onSubmit = vi.fn().mockResolvedValue(undefined)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('DayTemplateFormModal — required_min / required_max', () => {
  it('submits required_max=null when 最大人数 is left empty (strict)', async () => {
    const user = userEvent.setup()
    render(
      <DayTemplateFormModal
        mode="create"
        initial={null}
        patterns={PATTERNS}
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    )
    await user.click(screen.getByRole('button', { name: '月' }))
    await user.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          day_of_weeks: [0],
          required_min: 1,
          required_max: null,
        }),
      ),
    )
  })

  it('submits required_max when both 最小人数 and 最大人数 are given (range)', async () => {
    const user = userEvent.setup()
    render(
      <DayTemplateFormModal
        mode="create"
        initial={null}
        patterns={PATTERNS}
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    )
    const [minInput, maxInput] = screen.getAllByRole('spinbutton')
    await user.clear(minInput)
    await user.type(minInput, '1')
    await user.type(maxInput, '3')
    await user.click(screen.getByRole('button', { name: '火' }))
    await user.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          required_min: 1,
          required_max: 3,
        }),
      ),
    )
  })

  it('rejects submit when 最大人数 < 最小人数', async () => {
    const user = userEvent.setup()
    render(
      <DayTemplateFormModal
        mode="create"
        initial={null}
        patterns={PATTERNS}
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    )
    const [minInput, maxInput] = screen.getAllByRole('spinbutton')
    await user.clear(minInput)
    await user.type(minInput, '3')
    await user.type(maxInput, '1')
    await user.click(screen.getByRole('button', { name: '月' }))
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(
      await screen.findByText('最大人数は最小人数以上で入力してください'),
    ).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('prefills 最小人数 from initial and leaves 最大人数 empty for strict rows', () => {
    render(
      <DayTemplateFormModal
        mode="edit"
        initial={DAY_TEMPLATE_MON}
        patterns={PATTERNS}
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    )
    const [minInput, maxInput] = screen.getAllByRole('spinbutton')
    expect(minInput).toHaveValue(DAY_TEMPLATE_MON.required_min)
    expect(maxInput).toHaveValue(null)
  })
})
