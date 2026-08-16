import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import ConfirmDialog from './ConfirmDialog'

afterEach(() => {
  // Defensive: ensure scroll lock unwinds between tests if any test bails early.
  document.body.style.overflow = ''
  document.documentElement.style.overflow = ''
  document.body.removeAttribute('data-modal-lock-count')
  document.body.removeAttribute('data-modal-lock-prev-body')
  document.body.removeAttribute('data-modal-lock-prev-html')
})

describe('ConfirmDialog', () => {
  it('renders title and description', () => {
    render(
      <ConfirmDialog
        title="削除確認"
        description="この操作は元に戻せません"
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    )
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('削除確認')
    expect(screen.getByText('この操作は元に戻せません')).toBeInTheDocument()
  })

  it('renders ReactNode description', () => {
    render(
      <ConfirmDialog
        title="X"
        description={<span data-testid="desc">rich</span>}
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    )
    expect(screen.getByTestId('desc').textContent).toBe('rich')
  })

  it('uses delete tone defaults', () => {
    render(
      <ConfirmDialog
        title="X"
        description="d"
        tone="delete"
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    )
    expect(screen.getByText('Delete')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '削除する' })).toBeInTheDocument()
  })

  it('uses warning tone defaults', () => {
    render(
      <ConfirmDialog
        title="X"
        description="d"
        tone="warning"
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    )
    expect(screen.getByText('Confirm')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '実行する' })).toBeInTheDocument()
  })

  it('overrides labels and kicker', () => {
    render(
      <ConfirmDialog
        title="X"
        description="d"
        kicker="Overwrite"
        confirmLabel="上書き"
        cancelLabel="やめる"
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    )
    expect(screen.getByText('Overwrite')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '上書き' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'やめる' })).toBeInTheDocument()
  })

  it('calls onConfirm when confirm clicked', () => {
    const onConfirm = vi.fn()
    render(
      <ConfirmDialog
        title="X"
        description="d"
        onCancel={() => {}}
        onConfirm={onConfirm}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '実行する' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('calls onCancel when cancel clicked', () => {
    const onCancel = vi.fn()
    render(
      <ConfirmDialog
        title="X"
        description="d"
        onCancel={onCancel}
        onConfirm={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('calls onCancel on overlay click (mousedown + click both on overlay)', () => {
    const onCancel = vi.fn()
    const { container } = render(
      <ConfirmDialog
        title="X"
        description="d"
        onCancel={onCancel}
        onConfirm={() => {}}
      />,
    )
    const overlay = container.firstChild as HTMLElement
    fireEvent.mouseDown(overlay, { target: overlay })
    fireEvent.click(overlay, { target: overlay })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('does not call onCancel when mousedown starts inside the dialog and ends on overlay', () => {
    const onCancel = vi.fn()
    const { container } = render(
      <ConfirmDialog
        title="X"
        description="d"
        onCancel={onCancel}
        onConfirm={() => {}}
      />,
    )
    const overlay = container.firstChild as HTMLElement
    const dialog = container.querySelector('[role="dialog"]') as HTMLElement
    fireEvent.mouseDown(dialog)
    fireEvent.click(overlay, { target: overlay })
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('calls onCancel on Escape key', () => {
    const onCancel = vi.fn()
    render(
      <ConfirmDialog
        title="X"
        description="d"
        onCancel={onCancel}
        onConfirm={() => {}}
      />,
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('does not call onCancel on overlay click when loading', () => {
    const onCancel = vi.fn()
    const { container } = render(
      <ConfirmDialog
        title="X"
        description="d"
        loading
        onCancel={onCancel}
        onConfirm={() => {}}
      />,
    )
    const overlay = container.firstChild as HTMLElement
    fireEvent.mouseDown(overlay, { target: overlay })
    fireEvent.click(overlay, { target: overlay })
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('does not call onCancel on Escape when loading', () => {
    const onCancel = vi.fn()
    render(
      <ConfirmDialog
        title="X"
        description="d"
        loading
        onCancel={onCancel}
        onConfirm={() => {}}
      />,
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('disables both buttons and shows loadingLabel when loading', () => {
    render(
      <ConfirmDialog
        title="X"
        description="d"
        tone="delete"
        loading
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    )
    const confirmBtn = screen.getByRole('button', { name: '削除中…' })
    const cancelBtn = screen.getByRole('button', { name: 'キャンセル' })
    expect(confirmBtn).toBeDisabled()
    expect(cancelBtn).toBeDisabled()
  })

  it('uses custom loadingLabel', () => {
    render(
      <ConfirmDialog
        title="X"
        description="d"
        loading
        loadingLabel="アップロード中…"
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: 'アップロード中…' })).toBeInTheDocument()
  })

  it('locks body and html scroll while open and restores on unmount', () => {
    document.body.style.overflow = 'auto'
    document.documentElement.style.overflow = 'scroll'
    const { unmount } = render(
      <ConfirmDialog
        title="X"
        description="d"
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    )
    expect(document.body.style.overflow).toBe('hidden')
    expect(document.documentElement.style.overflow).toBe('hidden')
    unmount()
    expect(document.body.style.overflow).toBe('auto')
    expect(document.documentElement.style.overflow).toBe('scroll')
  })

  it('keeps scroll locked while at least one of two stacked dialogs is open', () => {
    document.body.style.overflow = ''
    document.documentElement.style.overflow = ''
    const { unmount: unmountA } = render(
      <ConfirmDialog title="A" description="a" onCancel={() => {}} onConfirm={() => {}} />,
    )
    const { unmount: unmountB } = render(
      <ConfirmDialog title="B" description="b" onCancel={() => {}} onConfirm={() => {}} />,
    )
    expect(document.body.style.overflow).toBe('hidden')
    expect(document.documentElement.style.overflow).toBe('hidden')
    unmountB()
    expect(document.body.style.overflow).toBe('hidden')
    expect(document.documentElement.style.overflow).toBe('hidden')
    unmountA()
    expect(document.body.style.overflow).toBe('')
    expect(document.documentElement.style.overflow).toBe('')
  })

  it('Escape closes only the topmost dialog when two are stacked', () => {
    const onCancelA = vi.fn()
    const onCancelB = vi.fn()
    const { unmount: unmountA } = render(
      <ConfirmDialog title="A" description="a" onCancel={onCancelA} onConfirm={() => {}} />,
    )
    const { unmount: unmountB } = render(
      <ConfirmDialog title="B" description="b" onCancel={onCancelB} onConfirm={() => {}} />,
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCancelB).toHaveBeenCalledTimes(1)
    expect(onCancelA).not.toHaveBeenCalled()
    unmountB()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCancelA).toHaveBeenCalledTimes(1)
    unmountA()
  })

  it('Tab cycles focus between cancel and confirm (no escape into background)', () => {
    render(
      <ConfirmDialog title="X" description="d" onCancel={() => {}} onConfirm={() => {}} />,
    )
    const cancelBtn = screen.getByRole('button', { name: 'キャンセル' })
    const confirmBtn = screen.getByRole('button', { name: '実行する' })
    expect(document.activeElement).toBe(confirmBtn)
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(document.activeElement).toBe(cancelBtn)
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(confirmBtn)
  })

  it('applies focus-visible ring classes on both buttons', () => {
    render(
      <ConfirmDialog title="X" description="d" onCancel={() => {}} onConfirm={() => {}} />,
    )
    const cancelBtn = screen.getByRole('button', { name: 'キャンセル' })
    const confirmBtn = screen.getByRole('button', { name: '実行する' })
    expect(cancelBtn.className).toContain('focus-visible:ring-2')
    expect(confirmBtn.className).toContain('focus-visible:ring-2')
  })

  it('restores focus to the previously focused element on unmount', () => {
    const trigger = document.createElement('button')
    trigger.textContent = 'open'
    document.body.appendChild(trigger)
    trigger.focus()
    expect(document.activeElement).toBe(trigger)

    const { unmount } = render(
      <ConfirmDialog title="X" description="d" onCancel={() => {}} onConfirm={() => {}} />,
    )
    expect(document.activeElement).not.toBe(trigger)
    unmount()
    expect(document.activeElement).toBe(trigger)
    document.body.removeChild(trigger)
  })

  it('has dialog role and aria-labelledby', () => {
    render(
      <ConfirmDialog
        title="My Title"
        description="d"
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    )
    const dialog = screen.getByRole('dialog')
    const titleId = dialog.getAttribute('aria-labelledby')
    expect(titleId).toBeTruthy()
    expect(document.getElementById(titleId!)?.textContent).toBe('My Title')
  })
})
