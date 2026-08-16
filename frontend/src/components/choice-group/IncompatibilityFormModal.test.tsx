import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import IncompatibilityFormModal from './IncompatibilityFormModal'
import { INCOMPAT_AB, PATTERN_A1, PATTERN_A2, PATTERN_B2 } from '../../test/fixtures'

let onClose: ReturnType<typeof vi.fn>
let onSubmit: ReturnType<typeof vi.fn>

beforeEach(() => {
  onClose = vi.fn()
  onSubmit = vi.fn().mockResolvedValue(undefined)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('IncompatibilityFormModal (create mode)', () => {
  it('renders header and two pattern selects', () => {
    render(
      <IncompatibilityFormModal
        mode="create"
        initial={null}
        patterns={[PATTERN_A1, PATTERN_A2, PATTERN_B2]}
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    )
    expect(screen.getByText('非両立ルールを追加')).toBeInTheDocument()
    expect(screen.getByText('New')).toBeInTheDocument()
    expect(screen.getAllByRole('combobox')).toHaveLength(2)
  })

  it('submits A and B and calls onClose', async () => {
    const user = userEvent.setup()
    render(
      <IncompatibilityFormModal
        mode="create"
        initial={null}
        patterns={[PATTERN_A1, PATTERN_A2, PATTERN_B2]}
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    )
    const [selA, selB] = screen.getAllByRole('combobox')
    await user.selectOptions(selA, String(PATTERN_A1.id))
    await user.selectOptions(selB, String(PATTERN_B2.id))
    await user.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        pattern_id_a: PATTERN_A1.id,
        pattern_id_b: PATTERN_B2.id,
      }),
    )
    expect(onClose).toHaveBeenCalled()
  })

  it('rejects submit when A and B are equal', async () => {
    const user = userEvent.setup()
    render(
      <IncompatibilityFormModal
        mode="create"
        initial={null}
        patterns={[PATTERN_A1, PATTERN_A2, PATTERN_B2]}
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    )
    const [selA, selB] = screen.getAllByRole('combobox')
    await user.selectOptions(selA, String(PATTERN_A1.id))
    await user.selectOptions(selB, String(PATTERN_A1.id))
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(
      await screen.findByText('別々のパターンを選択してください'),
    ).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })
})

describe('IncompatibilityFormModal (edit mode)', () => {
  it('prefills initial pattern_id_a / pattern_id_b', () => {
    render(
      <IncompatibilityFormModal
        mode="edit"
        initial={INCOMPAT_AB}
        patterns={[PATTERN_A1, PATTERN_A2, PATTERN_B2]}
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    )
    expect(screen.getByText('非両立ルールを編集')).toBeInTheDocument()
    expect(screen.getByText('Edit')).toBeInTheDocument()
    const [selA, selB] = screen.getAllByRole('combobox') as HTMLSelectElement[]
    // INCOMPAT_AB は pattern_id_a=100 (=PATTERN_A1.id), pattern_id_b=200 (=PATTERN_B2.id)
    expect(selA.value).toBe(String(INCOMPAT_AB.pattern_id_a))
    expect(selB.value).toBe(String(INCOMPAT_AB.pattern_id_b))
  })

  it('submits edited values', async () => {
    const user = userEvent.setup()
    render(
      <IncompatibilityFormModal
        mode="edit"
        initial={INCOMPAT_AB}
        patterns={[PATTERN_A1, PATTERN_A2, PATTERN_B2]}
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    )
    const [selA] = screen.getAllByRole('combobox')
    // パターン A を A1 から A2 に変更
    await user.selectOptions(selA, String(PATTERN_A2.id))
    await user.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        pattern_id_a: PATTERN_A2.id,
        pattern_id_b: INCOMPAT_AB.pattern_id_b,
      }),
    )
    expect(onClose).toHaveBeenCalled()
  })

  it('rejects submit when both selects point to the same pattern', async () => {
    const user = userEvent.setup()
    render(
      <IncompatibilityFormModal
        mode="edit"
        initial={INCOMPAT_AB}
        patterns={[PATTERN_A1, PATTERN_A2, PATTERN_B2]}
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    )
    const [selA, selB] = screen.getAllByRole('combobox')
    // A と B を同じパターンに揃える
    await user.selectOptions(selA, String(PATTERN_A1.id))
    await user.selectOptions(selB, String(PATTERN_A1.id))
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(
      await screen.findByText('別々のパターンを選択してください'),
    ).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
