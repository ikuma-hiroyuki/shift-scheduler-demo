import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import ShortagePopover from './ShortagePopover'
import type { ShortageRow } from '../../types/api'

const ANCHOR_RECT = {
  top: 100, left: 100, bottom: 130, right: 180, width: 80, height: 30,
} as DOMRect

const SHORTAGE: ShortageRow = {
  day: 5,
  pattern_id: 11,
  pattern_name: 'B1',
  required: 2,
  assigned: 0,
  missing: 2,
}

describe('ShortagePopover', () => {
  it('renders shortage header info', () => {
    const onClose = vi.fn()
    render(
      <ShortagePopover
        shortage={SHORTAGE}
        anchorRect={ANCHOR_RECT}
        onClose={onClose}
      />,
    )
    expect(screen.getByText(/5日 B1 ポジション 2名不足/)).toBeInTheDocument()
    expect(screen.getByText(/必要 2名 \/ 現在 0名/)).toBeInTheDocument()
  })

  it('does not render any proposal list or extra text', () => {
    const onClose = vi.fn()
    render(
      <ShortagePopover
        shortage={SHORTAGE}
        anchorRect={ANCHOR_RECT}
        onClose={onClose}
      />,
    )
    expect(screen.queryByText(/もっと見る/)).not.toBeInTheDocument()
    expect(screen.queryByText(/希望休を編集/)).not.toBeInTheDocument()
    expect(screen.queryByText(/スワップ/)).not.toBeInTheDocument()
  })

  it('Esc キー押下で onClose が呼ばれる', async () => {
    const onClose = vi.fn()
    render(
      <ShortagePopover
        shortage={SHORTAGE}
        anchorRect={ANCHOR_RECT}
        onClose={onClose}
      />,
    )
    const user = userEvent.setup()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
