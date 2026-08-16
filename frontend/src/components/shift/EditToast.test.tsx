import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import EditToast from './EditToast'
import { useEditorStore } from '../../stores/editor'

beforeEach(() => {
  useEditorStore.getState().reset()
})

afterEach(() => {
  useEditorStore.getState().reset()
  vi.useRealTimers()
})

describe('EditToast', () => {
  it('renders nothing when toast is null', () => {
    const { container } = render(<EditToast />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the message and close button when toast is set', () => {
    useEditorStore.setState({ toast: { kind: 'info', message: 'こんにちは' } })

    render(<EditToast />)

    expect(screen.getByText('こんにちは')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '閉じる' })).toBeInTheDocument()
  })

  it.each([
    ['error', 'bg-red-600'],
    ['success', 'bg-emerald-600'],
    ['info', 'bg-gray-800'],
  ] as const)('applies %s style class', (kind, cls) => {
    useEditorStore.setState({ toast: { kind, message: 'm' } })

    render(<EditToast />)

    const messageEl = screen.getByText('m')
    expect(messageEl.parentElement!.parentElement!.className).toContain(cls)
  })

  it('close button clears the toast', async () => {
    useEditorStore.setState({ toast: { kind: 'info', message: 'temp' } })
    const user = userEvent.setup()
    render(<EditToast />)

    await user.click(screen.getByRole('button', { name: '閉じる' }))

    expect(useEditorStore.getState().toast).toBeNull()
  })

  it('auto-dismisses after 5 seconds', () => {
    vi.useFakeTimers()
    useEditorStore.setState({ toast: { kind: 'info', message: 'auto' } })

    render(<EditToast />)
    expect(useEditorStore.getState().toast).not.toBeNull()

    act(() => {
      vi.advanceTimersByTime(5001)
    })

    expect(useEditorStore.getState().toast).toBeNull()
  })
})
