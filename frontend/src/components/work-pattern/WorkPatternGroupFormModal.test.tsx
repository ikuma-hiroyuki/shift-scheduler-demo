import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import WorkPatternGroupFormModal from './WorkPatternGroupFormModal'
import type { WorkPatternGroup } from '../../types/api'

let onClose: ReturnType<typeof vi.fn>
let onSubmit: ReturnType<typeof vi.fn>

beforeEach(() => {
  onClose = vi.fn()
  onSubmit = vi.fn().mockResolvedValue(undefined)
})

afterEach(() => {
  vi.clearAllMocks()
})

const EXISTING: WorkPatternGroup = {
  id: 5, department_id: 1, name: 'A', sort_order: 0, is_auxiliary: false,
  color: '#dcfce7',
}

describe('WorkPatternGroupFormModal — create mode', () => {
  it('shows "グループを追加" header in create mode', () => {
    render(
      <WorkPatternGroupFormModal mode="create" initial={null} onClose={onClose} onSubmit={onSubmit} />,
    )

    expect(screen.getByText('グループを追加')).toBeInTheDocument()
  })

  it('rejects empty name with inline error', async () => {
    const user = userEvent.setup()
    render(
      <WorkPatternGroupFormModal mode="create" initial={null} onClose={onClose} onSubmit={onSubmit} />,
    )

    // 必須属性のため form 提出は止まる。空白のみで自前バリデーション発火させる
    const input = screen.getByPlaceholderText(/例:/) as HTMLInputElement
    await user.type(input, '   ')
    await user.click(screen.getByRole('button', { name: '保存' }))

    expect(await screen.findByText('グループ名を入力してください')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submits trimmed name, is_auxiliary, and default color, then calls onClose', async () => {
    const user = userEvent.setup()
    render(
      <WorkPatternGroupFormModal mode="create" initial={null} onClose={onClose} onSubmit={onSubmit} />,
    )

    await user.type(screen.getByPlaceholderText(/例:/), '  補助  ')
    await user.click(screen.getByLabelText('補助ポジション'))
    await user.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        name: '補助',
        is_auxiliary: true,
        color: '#dcfce7',
      }),
    )
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('defaults to first unused preset color when existingGroups provided', async () => {
    const user = userEvent.setup()
    // 緑(#dcfce7) と 青(#dbeafe) は使用済み → 黄(#fef9c3) が初期選択になる
    const used: WorkPatternGroup[] = [
      { id: 1, department_id: 1, name: 'X', sort_order: 0, is_auxiliary: false, color: '#dcfce7' },
      { id: 2, department_id: 1, name: 'Y', sort_order: 1, is_auxiliary: false, color: '#dbeafe' },
    ]
    render(
      <WorkPatternGroupFormModal
        mode="create"
        initial={null}
        existingGroups={used}
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    )

    await user.type(screen.getByPlaceholderText(/例:/), 'C')
    await user.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        name: 'C',
        is_auxiliary: false,
        color: '#fef9c3',
      }),
    )
  })

  it('preset swatch click updates submitted color', async () => {
    const user = userEvent.setup()
    render(
      <WorkPatternGroupFormModal mode="create" initial={null} onClose={onClose} onSubmit={onSubmit} />,
    )

    // aria-label="紫" の swatch を選択
    await user.click(screen.getByRole('radio', { name: '紫' }))
    await user.type(screen.getByPlaceholderText(/例:/), 'P')
    await user.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        name: 'P',
        is_auxiliary: false,
        color: '#f3e4ff',
      }),
    )
  })

  it('custom hex picker propagates to submit payload', async () => {
    const user = userEvent.setup()
    render(
      <WorkPatternGroupFormModal mode="create" initial={null} onClose={onClose} onSubmit={onSubmit} />,
    )

    const picker = screen.getByLabelText('カスタム色') as HTMLInputElement
    // <input type="color"> は user.type 不可、fireEvent 経由で値変更
    const { fireEvent } = await import('@testing-library/react')
    fireEvent.input(picker, { target: { value: '#abc123' } })
    await user.type(screen.getByPlaceholderText(/例:/), 'Q')
    await user.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        name: 'Q',
        is_auxiliary: false,
        color: '#abc123',
      }),
    )
  })

  it('roving tabindex: only the selected swatch is in tab order', () => {
    render(
      <WorkPatternGroupFormModal mode="create" initial={null} onClose={onClose} onSubmit={onSubmit} />,
    )
    // create モードは preset[0] (緑) が default 選択 → tabIndex=0
    expect(screen.getByRole('radio', { name: '緑' })).toHaveAttribute('tabindex', '0')
    // 他は -1
    expect(screen.getByRole('radio', { name: '青' })).toHaveAttribute('tabindex', '-1')
    expect(screen.getByRole('radio', { name: '空' })).toHaveAttribute('tabindex', '-1')
  })

  it('arrow keys move focus and auto-select the next swatch', async () => {
    const user = userEvent.setup()
    render(
      <WorkPatternGroupFormModal mode="create" initial={null} onClose={onClose} onSubmit={onSubmit} />,
    )

    const green = screen.getByRole('radio', { name: '緑' })
    green.focus()
    await user.keyboard('{ArrowRight}')
    // 青 が自動選択 + focus
    expect(screen.getByRole('radio', { name: '青' })).toHaveAttribute('aria-checked', 'true')
    // ArrowLeft で 緑 に戻る
    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('radio', { name: '緑' })).toHaveAttribute('aria-checked', 'true')
    // End で末尾(空)
    await user.keyboard('{End}')
    expect(screen.getByRole('radio', { name: '空' })).toHaveAttribute('aria-checked', 'true')
    // Home で先頭
    await user.keyboard('{Home}')
    expect(screen.getByRole('radio', { name: '緑' })).toHaveAttribute('aria-checked', 'true')
    // ArrowLeft from 緑 wraps to 空
    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('radio', { name: '空' })).toHaveAttribute('aria-checked', 'true')
  })

  it('lowercases hex before submit (Chrome/Edge picker may emit uppercase)', async () => {
    const user = userEvent.setup()
    render(
      <WorkPatternGroupFormModal mode="create" initial={null} onClose={onClose} onSubmit={onSubmit} />,
    )

    const picker = screen.getByLabelText('カスタム色') as HTMLInputElement
    const { fireEvent } = await import('@testing-library/react')
    // 一部ブラウザは uppercase を返すので、その状態をシミュレート
    fireEvent.input(picker, { target: { value: '#ABCDEF' } })
    await user.type(screen.getByPlaceholderText(/例:/), 'R')
    await user.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        name: 'R',
        is_auxiliary: false,
        color: '#abcdef',
      }),
    )
  })
})

describe('WorkPatternGroupFormModal — edit mode', () => {
  it('preloads name, is_auxiliary, and color from initial', () => {
    render(
      <WorkPatternGroupFormModal
        mode="edit"
        initial={{ ...EXISTING, name: 'C', is_auxiliary: true, color: '#ffedd5' }}
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    )

    expect(screen.getByText('グループを編集')).toBeInTheDocument()
    const input = screen.getByPlaceholderText(/例:/) as HTMLInputElement
    expect(input.value).toBe('C')
    const checkbox = screen.getByLabelText('補助ポジション') as HTMLInputElement
    expect(checkbox.checked).toBe(true)
    // 橙(#ffedd5) swatch が selected
    expect(screen.getByRole('radio', { name: '橙' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByLabelText('カスタム色')).toHaveValue('#ffedd5')
  })

  it('preserves color when only name is changed in edit mode', async () => {
    const user = userEvent.setup()
    render(
      <WorkPatternGroupFormModal
        mode="edit"
        initial={{ ...EXISTING, color: '#fef9c3' }}
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    )

    const input = screen.getByPlaceholderText(/例:/) as HTMLInputElement
    await user.clear(input)
    await user.type(input, 'Renamed')
    await user.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        name: 'Renamed',
        is_auxiliary: false,
        color: '#fef9c3',
      }),
    )
  })
})

describe('WorkPatternGroupFormModal — error handling', () => {
  it('shows server detail on rejection', async () => {
    onSubmit.mockRejectedValueOnce({ response: { data: { detail: '同名グループ存在' } } })
    const user = userEvent.setup()
    render(
      <WorkPatternGroupFormModal mode="create" initial={null} onClose={onClose} onSubmit={onSubmit} />,
    )

    await user.type(screen.getByPlaceholderText(/例:/), 'A')
    await user.click(screen.getByRole('button', { name: '保存' }))

    expect(await screen.findByText('同名グループ存在')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('falls back to generic message on opaque error', async () => {
    onSubmit.mockRejectedValueOnce(new Error('boom'))
    const user = userEvent.setup()
    render(
      <WorkPatternGroupFormModal mode="create" initial={null} onClose={onClose} onSubmit={onSubmit} />,
    )

    await user.type(screen.getByPlaceholderText(/例:/), 'A')
    await user.click(screen.getByRole('button', { name: '保存' }))

    expect(await screen.findByText('保存に失敗しました')).toBeInTheDocument()
  })
})

describe('WorkPatternGroupFormModal — close interactions', () => {
  it('cancel button calls onClose', async () => {
    const user = userEvent.setup()
    render(
      <WorkPatternGroupFormModal mode="create" initial={null} onClose={onClose} onSubmit={onSubmit} />,
    )

    await user.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('inner form click does not close (stopPropagation)', async () => {
    const user = userEvent.setup()
    render(
      <WorkPatternGroupFormModal mode="create" initial={null} onClose={onClose} onSubmit={onSubmit} />,
    )

    await user.click(screen.getByPlaceholderText(/例:/))
    expect(onClose).not.toHaveBeenCalled()
  })
})
