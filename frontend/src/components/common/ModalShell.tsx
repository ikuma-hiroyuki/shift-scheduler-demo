import { forwardRef, useImperativeHandle, useRef } from 'react'
import type { ReactNode } from 'react'
import { useModalDismiss } from '../../hooks/useModalDismiss'

interface ModalShellProps {
  /** Esc / overlay click handler. Ignored while loading. */
  onClose: () => void
  /** Disable dismiss interactions (Esc + overlay click). */
  loading?: boolean
  /**
   * Full overlay className. Pass when default brand styling is wrong (e.g. ProcessingDialog,
   * ErrorBanner). Default: brand-tinted blur over a fixed-inset flexbox center container.
   */
  overlayClassName?: string
  role?: string
  'aria-live'?: 'off' | 'polite' | 'assertive'
  'aria-label'?: string
  children: ReactNode
}

const DEFAULT_OVERLAY_CLASSNAME =
  'fixed inset-0 z-50 flex items-center justify-center bg-brand-900/50 backdrop-blur-sm px-4'

/**
 * Shared modal overlay shell. Centralizes:
 *  - `useModalDismiss` (Esc handling, scroll lock, focus return, topmost-only routing)
 *  - `data-confirm-modal-dismiss` attribute (avoid generic `data-modal` namespace clash)
 *  - mousedown-from-inside-released-on-overlay drag guard so accidental text-selection drags
 *    that exit the dialog do NOT cancel the modal
 *  - `loading`-gated Esc and overlay-click dismissal
 *
 * Forwards a ref to the overlay element. Pass when callers need `isTopmostModal()` to gate their
 * own keyboard handlers (e.g. `ConfirmDialog`'s Tab focus trap).
 *
 * Children render inside the overlay and should stop click propagation themselves
 * (typically `onClick={(e) => e.stopPropagation()}` on the dialog/form root).
 */
const ModalShell = forwardRef<HTMLDivElement, ModalShellProps>(function ModalShell(
  {
    onClose,
    loading = false,
    overlayClassName = DEFAULT_OVERLAY_CLASSNAME,
    role,
    'aria-live': ariaLive,
    'aria-label': ariaLabel,
    children,
  },
  forwardedRef,
) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const overlayMouseDownRef = useRef(false)

  useImperativeHandle(forwardedRef, () => overlayRef.current as HTMLDivElement, [])
  useModalDismiss({ containerRef: overlayRef, onClose, loading })

  return (
    <div
      ref={overlayRef}
      data-confirm-modal-dismiss="true"
      role={role}
      aria-live={ariaLive}
      aria-label={ariaLabel}
      className={overlayClassName}
      onMouseDown={(e) => {
        overlayMouseDownRef.current = e.target === e.currentTarget
      }}
      onClick={(e) => {
        if (loading) return
        if (e.target !== e.currentTarget) return
        if (!overlayMouseDownRef.current) return
        onClose()
      }}
    >
      {children}
    </div>
  )
})

export default ModalShell
