import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import PatternTriggerFormModal from './PatternTriggerFormModal'
import {
  GROUP_A,
  GROUP_AUX,
  GROUP_B,
  GROUP_C_REQ,
  PATTERN_TRIGGER_AUX_AC,
} from '../../test/fixtures'

let onClose: ReturnType<typeof vi.fn>
let onSubmit: ReturnType<typeof vi.fn>

// GROUP_A (id=10, non-aux), GROUP_B (id=20, aux), GROUP_C_REQ (id=30, non-aux), GROUP_AUX (id=40, aux)
const GROUPS = [GROUP_A, GROUP_B, GROUP_C_REQ, GROUP_AUX]

beforeEach(() => {
  onClose = vi.fn()
  onSubmit = vi.fn().mockResolvedValue(undefined)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('PatternTriggerFormModal — create mode', () => {
  it('renders header and lists only auxiliary groups in the select', () => {
    render(
      <PatternTriggerFormModal
        mode="create"
        initial={null}
        groups={GROUPS}
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    )
    expect(screen.getByText('発生条件を追加')).toBeInTheDocument()
    const select = screen.getByRole('combobox') as HTMLSelectElement
    const optionTexts = Array.from(select.options).map((o) => o.textContent)
    expect(optionTexts).toEqual(['B', 'AUX'])
  })

  it('renders only non-auxiliary groups as required candidates', () => {
    render(
      <PatternTriggerFormModal
        mode="create"
        initial={null}
        groups={GROUPS}
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    )
    expect(screen.getByRole('button', { name: 'A' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'C' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'B' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'AUX' })).not.toBeInTheDocument()
  })

  it('rejects submit when no required group is selected', async () => {
    const user = userEvent.setup()
    render(
      <PatternTriggerFormModal
        mode="create"
        initial={null}
        groups={GROUPS}
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    )
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(
      await screen.findByText('必須グループを 1 つ以上選択してください'),
    ).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submits selected aux + required ids', async () => {
    const user = userEvent.setup()
    render(
      <PatternTriggerFormModal
        mode="create"
        initial={null}
        groups={GROUPS}
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    )
    await user.selectOptions(screen.getByRole('combobox'), '40')
    await user.click(screen.getByRole('button', { name: 'A' }))
    await user.click(screen.getByRole('button', { name: 'C' }))
    await user.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        auxiliary_group_id: 40,
        required_group_ids: [10, 30],
      }),
    )
    expect(onClose).toHaveBeenCalled()
  })
})

describe('PatternTriggerFormModal — edit mode', () => {
  it('prefills aux selection and pre-checks required groups', () => {
    render(
      <PatternTriggerFormModal
        mode="edit"
        initial={PATTERN_TRIGGER_AUX_AC}
        groups={GROUPS}
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    )
    expect(screen.getByText('発生条件を編集')).toBeInTheDocument()
    const select = screen.getByRole('combobox') as HTMLSelectElement
    expect(select.value).toBe('40')
    // Required groups A (id=10) and C (id=30) のボタンが選択状態 (bg-brand-600)
    const aBtn = screen.getByRole('button', { name: 'A' })
    expect(aBtn.className).toContain('bg-brand-600')
    const cBtn = screen.getByRole('button', { name: 'C' })
    expect(cBtn.className).toContain('bg-brand-600')
  })

  it('submits with updated required selection', async () => {
    const user = userEvent.setup()
    render(
      <PatternTriggerFormModal
        mode="edit"
        initial={PATTERN_TRIGGER_AUX_AC}
        groups={GROUPS}
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    )
    // Toggle off A, leaving only C
    await user.click(screen.getByRole('button', { name: 'A' }))
    await user.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        auxiliary_group_id: 40,
        required_group_ids: [30],
      }),
    )
  })
})
