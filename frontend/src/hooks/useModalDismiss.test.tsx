import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import { useRef } from 'react'

import {
  MODAL_LOCK_COUNT_ATTR,
  MODAL_LOCK_PREV_BODY_ATTR,
  MODAL_LOCK_PREV_BODY_POSITION_ATTR,
  MODAL_LOCK_PREV_BODY_TOP_ATTR,
  MODAL_LOCK_PREV_BODY_WIDTH_ATTR,
  MODAL_LOCK_PREV_HTML_ATTR,
  MODAL_LOCK_SCROLL_Y_ATTR,
  isTopmostModal,
  useModalDismiss,
} from './useModalDismiss'

interface TestModalProps {
  onClose: () => void
  loading?: boolean
  enabled?: boolean
  testId?: string
}

function TestModal({ onClose, loading = false, enabled = true, testId = 'modal' }: TestModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null)
  useModalDismiss({ containerRef: overlayRef, onClose, loading, enabled })
  return (
    <div ref={overlayRef} data-confirm-modal-dismiss="true" data-testid={testId}>
      <button>inner</button>
    </div>
  )
}

afterEach(() => {
  document.body.style.overflow = ''
  document.body.style.position = ''
  document.body.style.top = ''
  document.body.style.width = ''
  document.documentElement.style.overflow = ''
  document.body.removeAttribute(MODAL_LOCK_COUNT_ATTR)
  document.body.removeAttribute(MODAL_LOCK_SCROLL_Y_ATTR)
  document.body.removeAttribute(MODAL_LOCK_PREV_BODY_ATTR)
  document.body.removeAttribute(MODAL_LOCK_PREV_HTML_ATTR)
  document.body.removeAttribute(MODAL_LOCK_PREV_BODY_POSITION_ATTR)
  document.body.removeAttribute(MODAL_LOCK_PREV_BODY_TOP_ATTR)
  document.body.removeAttribute(MODAL_LOCK_PREV_BODY_WIDTH_ATTR)
})

describe('useModalDismiss', () => {
  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn()
    render(<TestModal onClose={onClose} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not call onClose when loading is true', () => {
    const onClose = vi.fn()
    render(<TestModal onClose={onClose} loading />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('does not call onClose for non-Escape keys', () => {
    const onClose = vi.fn()
    render(<TestModal onClose={onClose} />)
    fireEvent.keyDown(window, { key: 'Enter' })
    fireEvent.keyDown(window, { key: 'a' })
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('does not register listener nor lock scroll when enabled is false', () => {
    document.body.style.overflow = 'auto'
    const onClose = vi.fn()
    render(<TestModal onClose={onClose} enabled={false} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    expect(document.body.style.overflow).toBe('auto')
    expect(document.body.hasAttribute(MODAL_LOCK_COUNT_ATTR)).toBe(false)
  })

  it('locks both body and html overflow while open and restores prior values on unmount', () => {
    document.body.style.overflow = 'auto'
    document.documentElement.style.overflow = 'scroll'
    const { unmount } = render(<TestModal onClose={() => {}} />)
    expect(document.body.style.overflow).toBe('hidden')
    expect(document.documentElement.style.overflow).toBe('hidden')
    unmount()
    expect(document.body.style.overflow).toBe('auto')
    expect(document.documentElement.style.overflow).toBe('scroll')
  })

  it('refcounts scroll lock across stacked modals', () => {
    document.body.style.overflow = ''
    document.documentElement.style.overflow = ''
    const { unmount: unmountA } = render(<TestModal onClose={() => {}} testId="a" />)
    const { unmount: unmountB } = render(<TestModal onClose={() => {}} testId="b" />)
    expect(document.body.style.overflow).toBe('hidden')
    unmountB()
    expect(document.body.style.overflow).toBe('hidden')
    unmountA()
    expect(document.body.style.overflow).toBe('')
    expect(document.documentElement.style.overflow).toBe('')
    expect(document.body.hasAttribute(MODAL_LOCK_COUNT_ATTR)).toBe(false)
  })

  it('only the topmost modal responds to Escape when stacked', () => {
    const onCloseA = vi.fn()
    const onCloseB = vi.fn()
    const { unmount: unmountA } = render(<TestModal onClose={onCloseA} testId="a" />)
    const { unmount: unmountB } = render(<TestModal onClose={onCloseB} testId="b" />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCloseB).toHaveBeenCalledTimes(1)
    expect(onCloseA).not.toHaveBeenCalled()
    unmountB()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCloseA).toHaveBeenCalledTimes(1)
    unmountA()
  })

  it('restores focus to the previously focused element on unmount', () => {
    const trigger = document.createElement('button')
    trigger.textContent = 'open'
    document.body.appendChild(trigger)
    trigger.focus()
    expect(document.activeElement).toBe(trigger)

    const { unmount } = render(<TestModal onClose={() => {}} />)
    unmount()
    expect(document.activeElement).toBe(trigger)
    document.body.removeChild(trigger)
  })

  it('does not throw if previously focused element was removed before unmount', () => {
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    trigger.focus()

    const { unmount } = render(<TestModal onClose={() => {}} />)
    document.body.removeChild(trigger)
    expect(() => unmount()).not.toThrow()
    expect(document.activeElement).toBe(document.body)
  })

  it('applies position:fixed + top:-scrollY on lock and restores window.scrollY on unmount', () => {
    // Simulate the page having been scrolled down (e.g., user opened modal mid-page).
    Object.defineProperty(window, 'scrollY', { value: 250, writable: true, configurable: true })
    const scrollSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})

    const { unmount } = render(<TestModal onClose={() => {}} />)
    expect(document.body.style.position).toBe('fixed')
    expect(document.body.style.top).toBe('-250px')
    expect(document.body.style.width).toBe('100%')

    unmount()
    expect(document.body.style.position).toBe('')
    expect(document.body.style.top).toBe('')
    expect(document.body.style.width).toBe('')
    // scrollTo must run AFTER position:fixed is removed; otherwise iOS Safari ignores it.
    expect(scrollSpy).toHaveBeenCalledWith(0, 250)

    scrollSpy.mockRestore()
  })

  it('preserves prior body position/top/width styles on outer-most unmount', () => {
    document.body.style.position = 'relative'
    document.body.style.top = '5px'
    document.body.style.width = '90%'

    const { unmount } = render(<TestModal onClose={() => {}} />)
    expect(document.body.style.position).toBe('fixed')
    unmount()
    expect(document.body.style.position).toBe('relative')
    expect(document.body.style.top).toBe('5px')
    expect(document.body.style.width).toBe('90%')
  })

  it('does not re-snapshot scrollY on the second of stacked modals', () => {
    Object.defineProperty(window, 'scrollY', { value: 100, writable: true, configurable: true })
    const scrollSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})

    const { unmount: unmountA } = render(<TestModal onClose={() => {}} testId="a" />)
    // Simulate that opening A reset scrollY to 0 on iOS (because body became position:fixed).
    Object.defineProperty(window, 'scrollY', { value: 0, writable: true, configurable: true })
    const { unmount: unmountB } = render(<TestModal onClose={() => {}} testId="b" />)

    unmountB()
    // After B closes, A is still on; the page is still locked. scrollTo not called yet.
    expect(scrollSpy).not.toHaveBeenCalled()

    unmountA()
    // Final unlock restores the SNAPSHOT taken at A's lock (100), not the runtime scrollY (0).
    expect(scrollSpy).toHaveBeenCalledWith(0, 100)

    scrollSpy.mockRestore()
  })

  it('reads latest onClose / loading via refs without re-subscribing', () => {
    const first = vi.fn()
    const second = vi.fn()
    function Harness({ onClose }: { onClose: () => void }) {
      const overlayRef = useRef<HTMLDivElement>(null)
      useModalDismiss({ containerRef: overlayRef, onClose })
      return <div ref={overlayRef} data-confirm-modal-dismiss="true" />
    }
    const { rerender } = render(<Harness onClose={first} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(first).toHaveBeenCalledTimes(1)
    rerender(<Harness onClose={second} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(second).toHaveBeenCalledTimes(1)
    expect(first).toHaveBeenCalledTimes(1)
  })
})

describe('isTopmostModal', () => {
  it('returns false for null and for elements not in the modal stack', () => {
    expect(isTopmostModal(null)).toBe(false)
    const stray = document.createElement('div')
    expect(isTopmostModal(stray)).toBe(false)
  })

  it('returns true only for the last [data-confirm-modal-dismiss="true"] in DOM order', () => {
    const a = document.createElement('div')
    a.setAttribute('data-confirm-modal-dismiss', 'true')
    const b = document.createElement('div')
    b.setAttribute('data-confirm-modal-dismiss', 'true')
    document.body.appendChild(a)
    document.body.appendChild(b)
    expect(isTopmostModal(a)).toBe(false)
    expect(isTopmostModal(b)).toBe(true)
    document.body.removeChild(a)
    document.body.removeChild(b)
  })
})
