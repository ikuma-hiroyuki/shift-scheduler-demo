import { useEditorStore } from '../../stores/editor'

export default function EditModeToggle() {
  const mode = useEditorStore((s) => s.mode)
  const enter = useEditorStore((s) => s.enterEditMode)
  const exit = useEditorStore((s) => s.exitEditMode)
  const undoCount = useEditorStore((s) => s.undoStack.length)
  const redoCount = useEditorStore((s) => s.redoStack.length)

  const active = mode === 'edit'
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={active ? exit : enter}
        className={
          'px-3 py-1.5 text-xs font-semibold rounded-full border transition-colors ' +
          (active
            ? 'bg-amber-500 text-white border-amber-500 hover:bg-amber-600'
            : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50')
        }
      >
        {active ? '編集モード ON' : '編集モード OFF'}
      </button>
      {active && (
        <span className="text-[11px] text-gray-500">
          セルをクリックで編集 / Ctrl+Z: 取消 ({undoCount}) / Ctrl+Y: やり直し ({redoCount})
        </span>
      )}
    </div>
  )
}
