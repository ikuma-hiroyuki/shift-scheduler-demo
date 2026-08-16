import { useCallback, useEffect, useRef, useState } from 'react'
import ConfirmDialog from '../components/common/ConfirmDialog'

interface UseDirtyDiscardConfirmOptions<T> {
  /**
   * Serializable snapshot of the current form values. Anything passed through `JSON.stringify`:
   * primitives, plain objects, arrays. For Sets/Maps, convert to a sorted array first.
   */
  values: T
  /** Caller's intended close handler — fired only after the user confirms the discard. */
  onClose: () => void
}

/**
 * Modal dirty-discard guard for `<ModalShell>`-based forms (issue #209).
 *
 * Wraps `onClose` with a confirm step that fires only when the form is dirty (current values
 * diverge from the baseline snapshot). Renders a `<ConfirmDialog>` inline when the user attempts
 * to dismiss a dirty form via Esc / overlay click / Cancel button.
 *
 * Usage:
 *   const { attemptClose, dialog } = useDirtyDiscardConfirm({
 *     values: { name, isAux, color },
 *     onClose,
 *   })
 *   return (
 *     <ModalShell onClose={attemptClose} loading={busy}>
 *       <form ...>...</form>
 *       {dialog}
 *     </ModalShell>
 *   )
 *
 * Baseline strategy:
 *   The baseline is captured once, after a `setTimeout(..., 0)` from mount. This deliberately
 *   defers past any mount-time `useEffect` hydration (e.g. `useEffect(() => setX(initial.x), ...)`)
 *   so the baseline reflects the form's actual settled initial state rather than the empty
 *   defaults of `useState('')`. While baseline is null, dirty is false — the brief async window
 *   never reports false-positive dirty. After the timer fires, dirty compares JSON-serialized
 *   current values against the snapshot.
 *
 *   We do NOT re-baseline when `initial` props change later (rare; modal usually unmounts).
 */
export function useDirtyDiscardConfirm<T>({
  values,
  onClose,
}: UseDirtyDiscardConfirmOptions<T>) {
  const [baseline, setBaseline] = useState<string | null>(null)
  const [showConfirm, setShowConfirm] = useState(false)

  // `values` changes every render; capture latest via ref so the deferred baseline reads
  // post-hydration state, not the closure-captured render-1 state.
  const valuesRef = useRef(values)
  valuesRef.current = values

  useEffect(() => {
    const id = window.setTimeout(() => {
      setBaseline(JSON.stringify(valuesRef.current))
    }, 0)
    return () => window.clearTimeout(id)
  }, [])

  const dirty = baseline !== null && JSON.stringify(values) !== baseline

  const attemptClose = useCallback(() => {
    if (dirty) {
      setShowConfirm(true)
    } else {
      onClose()
    }
  }, [dirty, onClose])

  const dialog = showConfirm ? (
    <ConfirmDialog
      tone="warning"
      kicker="Discard"
      title="変更を破棄しますか？"
      description="未保存の変更があります。閉じると失われます。"
      confirmLabel="破棄する"
      cancelLabel="続けて編集"
      onCancel={() => setShowConfirm(false)}
      onConfirm={() => {
        setShowConfirm(false)
        onClose()
      }}
    />
  ) : null

  return { attemptClose, dialog, dirty }
}
