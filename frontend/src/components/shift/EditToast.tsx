import { useEffect } from 'react'
import { useEditorStore } from '../../stores/editor'

export default function EditToast() {
  const toast = useEditorStore((s) => s.toast)
  const setToast = useEditorStore((s) => s.setToast)

  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(id)
  }, [toast, setToast])

  if (!toast) return null
  const cls =
    toast.kind === 'error'
      ? 'bg-red-600 text-white border-red-700'
      : toast.kind === 'success'
      ? 'bg-emerald-600 text-white border-emerald-700'
      : 'bg-gray-800 text-white border-gray-900'
  return (
    <div className="fixed bottom-6 right-6 z-[60]">
      <div className={`rounded-lg shadow-lg px-4 py-2 text-sm border ${cls}`}>
        <div className="flex items-center gap-3">
          <span className="whitespace-pre-wrap">{toast.message}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="text-xs opacity-80 hover:opacity-100"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  )
}
