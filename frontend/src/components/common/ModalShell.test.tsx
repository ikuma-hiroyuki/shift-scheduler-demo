import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'

import ModalShell from './ModalShell'
import { isTopmostModal } from '../../hooks/useModalDismiss'

afterEach(() => {
  document.body.style.overflow = ''
  document.documentElement.style.overflow = ''
  document.body.removeAttribute('data-modal-lock-count')
  document.body.removeAttribute('data-modal-lock-prev-body')
  document.body.removeAttribute('data-modal-lock-prev-html')
})

describe('ModalShell', () => {
  it('renders children with the namespaced data-confirm-modal-dismiss attribute', () => {
    render(
      <ModalShell onClose={() => {}}>
        <div data-testid="child">hi</div>
      </ModalShell>,
    )
    expect(screen.getByTestId('child')).toBeInTheDocument()
    const overlay = document.querySelector('[data-confirm-modal-dismiss="true"]')
    expect(overlay).not.toBeNull()
  })

  it('does NOT carry the legacy generic data-modal attribute', () => {
    render(
      <ModalShell onClose={() => {}}>
        <div />
      </ModalShell>,
    )
    expect(document.querySelector('[data-modal="true"]')).toBeNull()
  })

  it('calls onClose on Escape', () => {
    const onClose = vi.fn()
    render(
      <ModalShell onClose={onClose}>
        <div>body</div>
      </ModalShell>,
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('ignores Escape and overlay clicks when loading', () => {
    const onClose = vi.fn()
    render(
      <ModalShell onClose={onClose} loading>
        <div>body</div>
      </ModalShell>,
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    const overlay = document.querySelector(
      '[data-confirm-modal-dismiss="true"]',
    ) as HTMLElement
    fireEvent.mouseDown(overlay, { target: overlay })
    fireEvent.click(overlay, { target: overlay })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes when overlay receives a full mousedown→click sequence', () => {
    const onClose = vi.fn()
    render(
      <ModalShell onClose={onClose}>
        <div>body</div>
      </ModalShell>,
    )
    const overlay = document.querySelector(
      '[data-confirm-modal-dismiss="true"]',
    ) as HTMLElement
    fireEvent.mouseDown(overlay, { target: overlay })
    fireEvent.click(overlay, { target: overlay })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does NOT close when click is initiated inside the dialog and released on overlay', () => {
    const onClose = vi.fn()
    render(
      <ModalShell onClose={onClose}>
        <div data-testid="dialog">body</div>
      </ModalShell>,
    )
    const overlay = document.querySelector(
      '[data-confirm-modal-dismiss="true"]',
    ) as HTMLElement
    const dialog = screen.getByTestId('dialog')
    // Drag started inside dialog → released on overlay should be a no-op (text selection guard).
    fireEvent.mouseDown(overlay, { target: dialog })
    fireEvent.click(overlay, { target: overlay })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('locks scroll while open and restores on unmount', () => {
    document.body.style.overflow = 'auto'
    const { unmount } = render(
      <ModalShell onClose={() => {}}>
        <div />
      </ModalShell>,
    )
    expect(document.body.style.overflow).toBe('hidden')
    unmount()
    expect(document.body.style.overflow).toBe('auto')
  })

  it('routes Escape to the topmost modal only when stacked', () => {
    const onCloseOuter = vi.fn()
    const onCloseInner = vi.fn()
    render(
      <ModalShell onClose={onCloseOuter}>
        <ModalShell onClose={onCloseInner}>
          <div>inner</div>
        </ModalShell>
      </ModalShell>,
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCloseInner).toHaveBeenCalledTimes(1)
    expect(onCloseOuter).not.toHaveBeenCalled()
  })

  it('forwards ref to the overlay element so isTopmostModal works for callers', () => {
    function Probe({ result }: { result: { isTopmost: boolean } }) {
      const overlayRef = useRef<HTMLDivElement>(null)
      return (
        <ModalShell ref={overlayRef} onClose={() => {}}>
          <button
            data-testid="probe"
            onClick={() => {
              result.isTopmost = isTopmostModal(overlayRef.current)
            }}
          >
            check
          </button>
        </ModalShell>
      )
    }
    const result = { isTopmost: false }
    render(<Probe result={result} />)
    fireEvent.click(screen.getByTestId('probe'))
    expect(result.isTopmost).toBe(true)
  })

  it('honors a custom overlayClassName for non-brand dialogs', () => {
    render(
      <ModalShell onClose={() => {}} overlayClassName="custom-overlay">
        <div />
      </ModalShell>,
    )
    const overlay = document.querySelector('[data-confirm-modal-dismiss="true"]')
    expect(overlay?.className).toBe('custom-overlay')
  })
})
