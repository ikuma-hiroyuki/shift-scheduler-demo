import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import ReorderCommitBar from './ReorderCommitBar'
import { createReorderStore } from '../../stores/reorderStore'

let store: ReturnType<typeof createReorderStore>
let onCommit: ReturnType<typeof vi.fn>

beforeEach(() => {
  store = createReorderStore()
  onCommit = vi.fn()
})

afterEach(() => {
  vi.clearAllMocks()
})

const renderBar = () =>
  render(<ReorderCommitBar useStore={store} label="従業員" onCommit={onCommit} />)

describe('ReorderCommitBar', () => {
  it('renders nothing in view mode', () => {
    const { container } = renderBar()
    expect(container).toBeEmptyDOMElement()
  })

  it('shows "変更なし" with disabled commit when in reorder mode without pending changes', () => {
    store.getState().enter([1, 2, 3])
    renderBar()

    expect(screen.getByText(/Reorder · 従業員/)).toBeInTheDocument()
    expect(screen.getByText('変更なし')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '確定' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'キャンセル' })).toBeEnabled()
  })

  it('shows "未保存の並び替えあり" with enabled commit when there are pending changes', () => {
    store.getState().enter([1, 2, 3])
    store.getState().setDraft([3, 1, 2])
    renderBar()

    expect(screen.getByText('未保存の並び替えあり')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '確定' })).toBeEnabled()
  })

  it('cancel button calls store.exit', async () => {
    store.getState().enter([1, 2, 3])
    const user = userEvent.setup()
    renderBar()

    await user.click(screen.getByRole('button', { name: 'キャンセル' }))

    expect(store.getState().mode).toBe('view')
  })

  it('commit button calls onCommit with current draftOrder and toggles committing state', async () => {
    store.getState().enter([1, 2, 3])
    store.getState().setDraft([2, 3, 1])

    let resolveCommit: () => void = () => {}
    onCommit.mockImplementationOnce(
      () => new Promise<void>((resolve) => { resolveCommit = resolve }),
    )

    const user = userEvent.setup()
    renderBar()

    await user.click(screen.getByRole('button', { name: '確定' }))

    // pending state: button shows "保存中…"
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '保存中…' })).toBeDisabled()
    })
    expect(onCommit).toHaveBeenCalledWith([2, 3, 1])

    resolveCommit()
    await waitFor(() => {
      expect(store.getState().committing).toBe(false)
    })
  })

  it('keeps committing=false even when onCommit throws', async () => {
    store.getState().enter([1, 2, 3])
    store.getState().setDraft([2, 3, 1])
    // 故意に reject される onCommit を「呼ばれた後に確実に catch」できるよう
    // 受け側の実装を含むラッパで wrap し、unhandledrejection の発生を防ぐ。
    onCommit.mockImplementationOnce(async () => {
      throw new Error('boom')
    })
    // process.unhandledRejection を一時抑止
    const original = process.listeners('unhandledRejection')
    process.removeAllListeners('unhandledRejection')
    process.on('unhandledRejection', () => {})

    try {
      const user = userEvent.setup()
      renderBar()

      await user.click(screen.getByRole('button', { name: '確定' }))

      await waitFor(() => {
        expect(store.getState().committing).toBe(false)
      })
    } finally {
      process.removeAllListeners('unhandledRejection')
      original.forEach((h) => process.on('unhandledRejection', h as never))
    }
  })
})
