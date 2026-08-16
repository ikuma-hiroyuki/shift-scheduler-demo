import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'

import ReorderToast from './ReorderToast'
import { createReorderStore } from '../../stores/reorderStore'

let store: ReturnType<typeof createReorderStore>

beforeEach(() => {
  store = createReorderStore()
})

afterEach(() => {
  vi.useRealTimers()
})

const renderToast = (durationMs?: number) =>
  render(<ReorderToast useStore={store} durationMs={durationMs} />)

describe('ReorderToast', () => {
  it('renders nothing when toast is null', () => {
    const { container } = renderToast()
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the toast message with role=status and aria-live=polite', () => {
    store.getState().setToast({ kind: 'info', message: '並び替え準備中' })
    renderToast()

    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(status).toHaveTextContent('並び替え準備中')
  })

  it.each([
    ['success', '#3a6b6b'],
    ['error', '#a83232'],
  ] as const)('applies %s tone', (kind, colorHex) => {
    store.getState().setToast({ kind, message: 'm' })
    renderToast()

    const status = screen.getByRole('status')
    expect(status.className).toContain(colorHex)
  })

  it('auto-dismisses after the specified duration', () => {
    vi.useFakeTimers()
    store.getState().setToast({ kind: 'info', message: 'auto' })

    renderToast(2000)
    expect(store.getState().toast).not.toBeNull()

    act(() => {
      vi.advanceTimersByTime(2001)
    })

    expect(store.getState().toast).toBeNull()
  })

  it('default duration is 4000ms', () => {
    vi.useFakeTimers()
    store.getState().setToast({ kind: 'info', message: 'default' })

    renderToast()

    act(() => {
      vi.advanceTimersByTime(3999)
    })
    expect(store.getState().toast).not.toBeNull()

    act(() => {
      vi.advanceTimersByTime(2)
    })
    expect(store.getState().toast).toBeNull()
  })
})
