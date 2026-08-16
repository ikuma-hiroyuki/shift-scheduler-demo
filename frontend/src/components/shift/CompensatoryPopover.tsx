import { cellKey, useEditorStore } from '../../stores/editor'
import type { CompensatoryProposal } from '../../types/api'

export default function CompensatoryPopover() {
  const ctx = useEditorStore((s) => s.compensatoryContext)
  const setCtx = useEditorStore((s) => s.setCompensatoryContext)
  const cells = useEditorStore((s) => s.cells)
  const stageEdit = useEditorStore((s) => s.stageEdit)
  const enterEditMode = useEditorStore((s) => s.enterEditMode)
  const mode = useEditorStore((s) => s.mode)
  const setToast = useEditorStore((s) => s.setToast)

  if (!ctx) return null

  function onPick(prop: CompensatoryProposal) {
    if (!ctx) return
    const d = new Date(prop.date)
    const day = d.getDate()
    const key = cellKey(ctx.employeeId, day)
    const prior = cells.get(key)
    if (!prior) {
      setToast({ kind: 'error', message: '候補日のセル情報が見つかりません' })
      return
    }
    if (mode !== 'edit') enterEditMode()
    stageEdit(key, {
      assignmentType: 'REST',
      patternId: null,
      leaveType: null,
      label: '割当休日',
    })
    setToast({
      kind: 'info',
      message: `${prop.date} を代休として追加しました。「確定」で保存してください。`,
    })
    setCtx(null)
  }

  return (
    <div className="fixed bottom-6 left-6 z-[55] bg-white rounded-lg shadow-xl border border-gray-200 p-4 w-[320px]">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-semibold text-gray-800">代休候補日</h4>
        <button
          type="button"
          onClick={() => setCtx(null)}
          className="text-xs text-gray-500 hover:text-gray-700"
        >
          あとで決める
        </button>
      </div>
      <p className="text-xs text-gray-500 mb-3">
        {ctx.targetDate} を勤務に変更しました。代わりの休日を選択してください。
      </p>
      <div className="space-y-2">
        {ctx.proposals.map((p) => (
          <button
            type="button"
            key={p.date}
            onClick={() => onPick(p)}
            className="w-full text-left px-3 py-2 border border-gray-200 rounded hover:bg-brand-50"
          >
            <div className="text-sm font-medium text-gray-800">{p.date}</div>
            <div className="text-xs text-gray-500">
              スコア {p.score} — {p.reason}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
