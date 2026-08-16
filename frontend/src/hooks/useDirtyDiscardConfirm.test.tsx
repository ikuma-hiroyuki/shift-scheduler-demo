import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'

import { useDirtyDiscardConfirm } from './useDirtyDiscardConfirm'

interface HostProps {
  initialName?: string
  onClose: () => void
}

/**
 * Test harness mimicking a FormModal — owns form state, calls the hook, renders the dialog.
 * The "form" is just a single text input; toggling it makes the form dirty.
 */
function Host({ initialName = '', onClose }: HostProps) {
  const [name, setName] = useState(initialName)
  const { attemptClose, dialog, dirty } = useDirtyDiscardConfirm({
    values: { name },
    onClose,
  })
  return (
    <div>
      <input
        data-testid="name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <button data-testid="cancel" onClick={attemptClose}>
        cancel
      </button>
      <span data-testid="dirty">{String(dirty)}</span>
      {dialog}
    </div>
  )
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  document.body.style.overflow = ''
  document.body.style.position = ''
  document.body.style.top = ''
  document.body.style.width = ''
  document.documentElement.style.overflow = ''
  document.body.removeAttribute('data-modal-lock-count')
  document.body.removeAttribute('data-modal-lock-prev-body')
  document.body.removeAttribute('data-modal-lock-prev-html')
})

describe('useDirtyDiscardConfirm', () => {
  it('calls onClose immediately when the form is clean', async () => {
    const onClose = vi.fn()
    render(<Host onClose={onClose} />)
    // Let the deferred baseline capture run.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    fireEvent.click(screen.getByTestId('cancel'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows the discard confirm when the form is dirty', async () => {
    const onClose = vi.fn()
    render(<Host onClose={onClose} />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    fireEvent.change(screen.getByTestId('name'), { target: { value: 'edited' } })
    expect(screen.getByTestId('dirty').textContent).toBe('true')

    fireEvent.click(screen.getByTestId('cancel'))
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByText('変更を破棄しますか？')).toBeInTheDocument()
  })

  it('keeps the form open when the user cancels the discard confirm', async () => {
    const onClose = vi.fn()
    render(<Host onClose={onClose} />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    fireEvent.change(screen.getByTestId('name'), { target: { value: 'edited' } })
    fireEvent.click(screen.getByTestId('cancel'))
    fireEvent.click(screen.getByRole('button', { name: '続けて編集' }))

    expect(onClose).not.toHaveBeenCalled()
    expect(screen.queryByText('変更を破棄しますか？')).not.toBeInTheDocument()
    expect((screen.getByTestId('name') as HTMLInputElement).value).toBe('edited')
  })

  it('calls onClose when the user confirms the discard', async () => {
    const onClose = vi.fn()
    render(<Host onClose={onClose} />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    fireEvent.change(screen.getByTestId('name'), { target: { value: 'edited' } })
    fireEvent.click(screen.getByTestId('cancel'))
    fireEvent.click(screen.getByRole('button', { name: '破棄する' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('reports dirty=false on initial mount even with non-empty initial values (baseline=initial)', async () => {
    // For FormModals that pass `initial` synchronously via `useState(() => initial.x)`, the
    // baseline must equal those initial values so edit-mode opens with dirty=false.
    const onClose = vi.fn()
    render(<Host initialName="prefilled" onClose={onClose} />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByTestId('dirty').textContent).toBe('false')
    fireEvent.click(screen.getByTestId('cancel'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
