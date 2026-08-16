import { useEffect, useRef } from 'react'

/**
 * DOM contract: every modal that uses this hook must carry this attribute on its outer overlay
 * element. Use a namespaced attribute name (`data-confirm-modal-dismiss`) so unrelated DOM-driven
 * components (popovers, tooltips, command palettes) cannot accidentally participate in the modal
 * stack and steal Esc / scroll-lock state. Prefer `<ModalShell>` which sets the attribute for you.
 */
export const MODAL_SELECTOR = '[data-confirm-modal-dismiss="true"]'
export const MODAL_DISMISS_ATTR = 'data-confirm-modal-dismiss'
export const MODAL_LOCK_COUNT_ATTR = 'data-modal-lock-count'
export const MODAL_LOCK_SCROLL_Y_ATTR = 'data-modal-lock-scroll-y'
export const MODAL_LOCK_PREV_BODY_ATTR = 'data-modal-lock-prev-body'
export const MODAL_LOCK_PREV_HTML_ATTR = 'data-modal-lock-prev-html'
export const MODAL_LOCK_PREV_BODY_POSITION_ATTR = 'data-modal-lock-prev-body-position'
export const MODAL_LOCK_PREV_BODY_TOP_ATTR = 'data-modal-lock-prev-body-top'
export const MODAL_LOCK_PREV_BODY_WIDTH_ATTR = 'data-modal-lock-prev-body-width'

/**
 * State lives in DOM attributes on document.body (not module-level / React state) so the
 * refcount and prior-style snapshot survive Vite HMR and React StrictMode mount-cleanup-mount.
 * Module-level state would reset to 0 on hot-reload mid-modal and leave the page locked forever.
 *
 * iOS Safari (issue #216): `body { overflow: hidden }` alone does NOT prevent the visual
 * viewport from scrolling on iOS Safari, and on close the page can also jump to the top.
 * The reliable cross-browser pattern is `position: fixed; top: -<scrollY>px; width: 100%`,
 * which freezes the document at its current scroll offset without affecting the visual
 * viewport. On unlock we restore the styles and `window.scrollTo` back to the snapshotted
 * offset. Desktop browsers (overflow:hidden was sufficient) keep working — position:fixed
 * + top is a strict superset.
 */
function lockScroll() {
  const body = document.body
  const html = document.documentElement
  const next = (parseInt(body.getAttribute(MODAL_LOCK_COUNT_ATTR) ?? '0', 10) || 0) + 1
  body.setAttribute(MODAL_LOCK_COUNT_ATTR, String(next))
  if (next === 1) {
    // Only the first lock snapshots styles + scroll position. Stacked modals reuse the same lock.
    const scrollY = window.scrollY
    body.setAttribute(MODAL_LOCK_SCROLL_Y_ATTR, String(scrollY))
    body.setAttribute(MODAL_LOCK_PREV_BODY_ATTR, body.style.overflow)
    body.setAttribute(MODAL_LOCK_PREV_HTML_ATTR, html.style.overflow)
    body.setAttribute(MODAL_LOCK_PREV_BODY_POSITION_ATTR, body.style.position)
    body.setAttribute(MODAL_LOCK_PREV_BODY_TOP_ATTR, body.style.top)
    body.setAttribute(MODAL_LOCK_PREV_BODY_WIDTH_ATTR, body.style.width)
    body.style.overflow = 'hidden'
    html.style.overflow = 'hidden'
    body.style.position = 'fixed'
    body.style.top = `-${scrollY}px`
    body.style.width = '100%'
  }
}

function unlockScroll() {
  const body = document.body
  const html = document.documentElement
  const next = (parseInt(body.getAttribute(MODAL_LOCK_COUNT_ATTR) ?? '0', 10) || 0) - 1
  if (next <= 0) {
    const scrollY = parseInt(body.getAttribute(MODAL_LOCK_SCROLL_Y_ATTR) ?? '0', 10) || 0
    body.style.overflow = body.getAttribute(MODAL_LOCK_PREV_BODY_ATTR) ?? ''
    html.style.overflow = body.getAttribute(MODAL_LOCK_PREV_HTML_ATTR) ?? ''
    body.style.position = body.getAttribute(MODAL_LOCK_PREV_BODY_POSITION_ATTR) ?? ''
    body.style.top = body.getAttribute(MODAL_LOCK_PREV_BODY_TOP_ATTR) ?? ''
    body.style.width = body.getAttribute(MODAL_LOCK_PREV_BODY_WIDTH_ATTR) ?? ''
    body.removeAttribute(MODAL_LOCK_COUNT_ATTR)
    body.removeAttribute(MODAL_LOCK_SCROLL_Y_ATTR)
    body.removeAttribute(MODAL_LOCK_PREV_BODY_ATTR)
    body.removeAttribute(MODAL_LOCK_PREV_HTML_ATTR)
    body.removeAttribute(MODAL_LOCK_PREV_BODY_POSITION_ATTR)
    body.removeAttribute(MODAL_LOCK_PREV_BODY_TOP_ATTR)
    body.removeAttribute(MODAL_LOCK_PREV_BODY_WIDTH_ATTR)
    // Restoring scroll BEFORE position style change leaves the page jumping to top on iOS;
    // do it AFTER so the body is no longer fixed when scrollTo runs.
    window.scrollTo(0, scrollY)
  } else {
    body.setAttribute(MODAL_LOCK_COUNT_ATTR, String(next))
  }
}

/**
 * Returns true when `el` is the topmost modal in the DOM (last
 * `[data-confirm-modal-dismiss="true"]` element). Callers can gate their own keyboard handlers
 * (e.g. ConfirmDialog's Tab focus trap) so only the visually-topmost dialog responds.
 */
export function isTopmostModal(el: HTMLElement | null): boolean {
  if (!el) return false
  const all = document.querySelectorAll<HTMLElement>(MODAL_SELECTOR)
  return all.length > 0 && all[all.length - 1] === el
}

interface UseModalDismissOptions {
  /** Outer overlay element ref. Must carry `data-confirm-modal-dismiss="true"` (use `ModalShell`). */
  containerRef: React.RefObject<HTMLElement>
  /** Called on Escape (and what callers should also wire to their cancel/close handler). */
  onClose: () => void
  /** When true, Escape is ignored (e.g., async work in progress). */
  loading?: boolean
  /** Disable hook entirely (e.g., the modal is conditionally rendered without unmount). */
  enabled?: boolean
}

/**
 * Modal dismiss + scroll lock + focus return helper.
 * - Listens for Escape on window; only the topmost (last in DOM)
 *   `[data-confirm-modal-dismiss="true"]` element responds.
 * - Locks scroll using `position: fixed` + `top: -scrollY` so iOS Safari's visual viewport
 *   does not scroll the underlying page (issue #216). Refcounted across stacked modals.
 *   Desktop browsers (overflow:hidden was sufficient) continue to work — the position-fixed
 *   pattern is a strict superset.
 * - Restores focus to the previously focused element on unmount.
 *
 * Does NOT trap Tab focus inside the dialog — callers that need a focus trap (e.g. ConfirmDialog)
 * implement it themselves and gate it with `isTopmostModal()` so stacked modals do not fight.
 *
 * Prefer `<ModalShell>` over calling this hook directly. The shell sets the
 * `data-confirm-modal-dismiss="true"` attribute, mounts the hook, and supplies the overlay /
 * mousedown drag guard. Use this hook directly only when you need to participate in the modal
 * stack without rendering the standard overlay (extremely rare).
 */
export function useModalDismiss({
  containerRef,
  onClose,
  loading = false,
  enabled = true,
}: UseModalDismissOptions) {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const loadingRef = useRef(loading)
  loadingRef.current = loading

  useEffect(() => {
    if (!enabled) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    lockScroll()

    function handleKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (loadingRef.current) return
      if (!isTopmostModal(containerRef.current)) return
      e.preventDefault()
      onCloseRef.current()
    }
    window.addEventListener('keydown', handleKey)

    return () => {
      window.removeEventListener('keydown', handleKey)
      unlockScroll()
      // Restore focus only if the previously-focused element is still in the DOM.
      if (previouslyFocused && previouslyFocused.isConnected) {
        previouslyFocused.focus?.()
      }
    }
  }, [enabled, containerRef])
}
