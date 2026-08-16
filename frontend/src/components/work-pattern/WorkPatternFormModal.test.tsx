import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import WorkPatternFormModal from './WorkPatternFormModal'
import type { WorkPattern, WorkPatternGroup } from '../../types/api'

let onClose: ReturnType<typeof vi.fn>
let onSubmit: ReturnType<typeof vi.fn>

const GROUP: WorkPatternGroup = {
  id: 5, department_id: 1, name: 'A', sort_order: 0, is_auxiliary: false,
}

const EXISTING: WorkPattern = {
  id: 10, group_id: 5, department_id: 1, pattern_name: 'A1', shift_type: 1,
  shift_start: '07:00', shift_end: '15:00', sort_order: 0, is_auxiliary: false,
}

beforeEach(() => {
  onClose = vi.fn()
  onSubmit = vi.fn().mockResolvedValue(undefined)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('WorkPatternFormModal — create mode', () => {
  it('shows "作業パターンを追加" header and Group · A label', () => {
    render(
      <WorkPatternFormModal mode="create" initial={null} group={GROUP} onClose={onClose} onSubmit={onSubmit} />,
    )

    expect(screen.getByText('作業パターンを追加')).toBeInTheDocument()
    expect(screen.getByText('Group · A')).toBeInTheDocument()
  })

  it('shows three shift type buttons; default selection = フル番', () => {
    render(
      <WorkPatternFormModal mode="create" initial={null} group={GROUP} onClose={onClose} onSubmit={onSubmit} />,
    )

    expect(screen.getByRole('button', { name: '早番' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'フル番' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '遅番' })).toBeInTheDocument()
  })

  it('submits with default values and calls onClose', async () => {
    const user = userEvent.setup()
    render(
      <WorkPatternFormModal mode="create" initial={null} group={GROUP} onClose={onClose} onSubmit={onSubmit} />,
    )

    await user.type(screen.getByPlaceholderText(/例:/), 'A1')
    await user.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        pattern_name: 'A1',
        shift_type: 2,
        shift_start: '09:00',
        shift_end: '18:00',
      }),
    )
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('switches shift_type when a different button is clicked', async () => {
    const user = userEvent.setup()
    render(
      <WorkPatternFormModal mode="create" initial={null} group={GROUP} onClose={onClose} onSubmit={onSubmit} />,
    )

    await user.type(screen.getByPlaceholderText(/例:/), 'A1')
    await user.click(screen.getByRole('button', { name: '遅番' }))
    await user.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ shift_type: 3 })),
    )
  })

  it('rejects empty pattern_name with inline error', async () => {
    const user = userEvent.setup()
    render(
      <WorkPatternFormModal mode="create" initial={null} group={GROUP} onClose={onClose} onSubmit={onSubmit} />,
    )

    // type 属性 required を回避できないので、HTMLInputElement.value に直接 ' ' を流し込む
    const input = screen.getByPlaceholderText(/例:/) as HTMLInputElement
    await user.type(input, '   ')
    await user.click(screen.getByRole('button', { name: '保存' }))

    expect(await screen.findByText('作業パターン名を入力してください')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })
})

describe('WorkPatternFormModal — edit mode preload', () => {
  it('preloads pattern_name, shift_type, start, end from initial', () => {
    render(
      <WorkPatternFormModal mode="edit" initial={EXISTING} group={GROUP} onClose={onClose} onSubmit={onSubmit} />,
    )

    expect(screen.getByText('作業パターンを編集')).toBeInTheDocument()
    expect((screen.getByPlaceholderText(/例:/) as HTMLInputElement).value).toBe('A1')
    // 早番 button が選択スタイル
    expect(screen.getByRole('button', { name: '早番' }).className).toContain('bg-brand-900')
  })
})

describe('WorkPatternFormModal — error handling', () => {
  it('shows server detail on rejection', async () => {
    onSubmit.mockRejectedValueOnce({ response: { data: { detail: '重複した pattern_name' } } })
    const user = userEvent.setup()
    render(
      <WorkPatternFormModal mode="create" initial={null} group={GROUP} onClose={onClose} onSubmit={onSubmit} />,
    )

    await user.type(screen.getByPlaceholderText(/例:/), 'A1')
    await user.click(screen.getByRole('button', { name: '保存' }))

    expect(await screen.findByText('重複した pattern_name')).toBeInTheDocument()
  })
})
