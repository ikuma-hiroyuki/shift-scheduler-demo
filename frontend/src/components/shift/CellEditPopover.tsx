import { useEffect, useMemo, useRef, useState } from 'react'
import { cellKey, useEditorStore } from '../../stores/editor'
import type { CellState, LeaveType } from '../../types/api'

type Selection =
  | { kind: 'REST' }
  | { kind: 'LEAVE'; leaveType: LeaveType }
  | { kind: 'WORK'; patternId: number }

function selectionFromCell(cell: CellState): Selection {
  if (cell.assignmentType === 'WORK' && cell.patternId != null) {
    return { kind: 'WORK', patternId: cell.patternId }
  }
  if (cell.assignmentType === 'LEAVE') {
    return { kind: 'LEAVE', leaveType: cell.leaveType ?? 'REQUESTED' }
  }
  return { kind: 'REST' }
}

function selectionEquals(a: Selection, b: Selection): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'WORK' && b.kind === 'WORK') return a.patternId === b.patternId
  if (a.kind === 'LEAVE' && b.kind === 'LEAVE') return a.leaveType === b.leaveType
  return true
}

function cellStateFromSelection(
  sel: Selection,
  patternIdToName: Map<number, string>,
): CellState {
  if (sel.kind === 'REST') {
    return { assignmentType: 'REST', patternId: null, leaveType: null, label: '割当休日' }
  }
  if (sel.kind === 'LEAVE') {
    const label =
      sel.leaveType === 'MANDATORY' ? '有給' : sel.leaveType === 'TENTATIVE' ? '○' : '●'
    return { assignmentType: 'LEAVE', patternId: null, leaveType: sel.leaveType, label }
  }
  return {
    assignmentType: 'WORK',
    patternId: sel.patternId,
    leaveType: null,
    label: patternIdToName.get(sel.patternId) ?? '?',
  }
}

export default function CellEditPopover() {
  const pending = useEditorStore((s) => s.pendingEdit)
  const patterns = useEditorStore((s) => s.patterns)
  const patternIdToName = useEditorStore((s) => s.patternIdToName)
  const cells = useEditorStore((s) => s.cells)
  const employeeOrder = useEditorStore((s) => s.employeeOrder)
  const employeeNames = useEditorStore((s) => s.employeeNames)
  const closeCell = useEditorStore((s) => s.closeCell)
  const stageEdit = useEditorStore((s) => s.stageEdit)

  const [selection, setSelection] = useState<Selection | null>(null)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const popRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(
    null,
  )

  // 編集中日の「各作業パターンが誰に割り当たっているか」を引く (編集中の従業員は除外)
  const patternAssignees = useMemo(() => {
    const map = new Map<number, string>()
    if (!pending) return map
    for (const empId of employeeOrder) {
      if (empId === pending.employeeId) continue
      const c = cells.get(cellKey(empId, pending.day))
      if (!c || c.assignmentType !== 'WORK' || c.patternId == null) continue
      const name = employeeNames.get(empId) ?? `#${empId}`
      const existing = map.get(c.patternId)
      map.set(c.patternId, existing ? `${existing}, ${name}` : name)
    }
    return map
  }, [pending, cells, employeeOrder, employeeNames])

  useEffect(() => {
    if (pending) setSelection(selectionFromCell(pending.prior))
    else setSelection(null)
    setOffset({ x: 0, y: 0 })
  }, [pending])

  useEffect(() => {
    if (!pending) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') closeCell()
    }
    function onClick(e: MouseEvent) {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        closeCell()
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onClick)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onClick)
    }
  }, [pending, closeCell])

  const style = useMemo(() => {
    if (!pending) return null
    const { anchorRect } = pending
    const POP_WIDTH = 260
    const left = Math.min(
      Math.max(8, anchorRect.left),
      window.innerWidth - POP_WIDTH - 8,
    )
    const top = anchorRect.bottom + 4
    const overflow = top + 320 > window.innerHeight
    return overflow
      ? { position: 'fixed' as const, left, bottom: window.innerHeight - anchorRect.top + 4, width: POP_WIDTH, zIndex: 50 }
      : { position: 'fixed' as const, left, top, width: POP_WIDTH, zIndex: 50 }
  }, [pending])

  if (!pending || !selection || !style) return null

  const priorSel = selectionFromCell(pending.prior)
  const unchanged = selectionEquals(priorSel, selection)

  function onApply() {
    if (!pending || !selection) return
    const next = cellStateFromSelection(selection, patternIdToName)
    stageEdit(pending.key, next)
  }

  function onHeaderPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      baseX: offset.x,
      baseY: offset.y,
    }
  }

  function onHeaderPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return
    setOffset({
      x: dragRef.current.baseX + (e.clientX - dragRef.current.startX),
      y: dragRef.current.baseY + (e.clientY - dragRef.current.startY),
    })
  }

  function onHeaderPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    dragRef.current = null
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  return (
    <div
      ref={popRef}
      style={{ ...style, transform: `translate(${offset.x}px, ${offset.y}px)` }}
      className="bg-white rounded-lg shadow-xl border border-gray-200 p-3 text-sm"
    >
      <div
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
        onPointerCancel={onHeaderPointerUp}
        className="flex items-center justify-between text-xs text-gray-500 mb-2 -mx-3 -mt-3 px-3 pt-2 pb-2 border-b border-gray-100 cursor-move select-none"
        title="ドラッグで移動"
      >
        <span>
          従業員 ID {pending.employeeId} / {pending.day} 日
        </span>
        <span className="text-gray-300 text-[10px]">⋮⋮ 移動</span>
      </div>

      <div className="space-y-1 max-h-[260px] overflow-y-auto">
        <OptionRow
          checked={selection.kind === 'REST'}
          onSelect={() => setSelection({ kind: 'REST' })}
          label="割当休日"
        />
        <OptionRow
          checked={selection.kind === 'LEAVE' && selection.leaveType === 'REQUESTED'}
          onSelect={() => setSelection({ kind: 'LEAVE', leaveType: 'REQUESTED' })}
          label="● 希望休"
        />
        <OptionRow
          checked={selection.kind === 'LEAVE' && selection.leaveType === 'TENTATIVE'}
          onSelect={() => setSelection({ kind: 'LEAVE', leaveType: 'TENTATIVE' })}
          label="○ 仮休"
        />
        <OptionRow
          checked={selection.kind === 'LEAVE' && selection.leaveType === 'MANDATORY'}
          onSelect={() => setSelection({ kind: 'LEAVE', leaveType: 'MANDATORY' })}
          label="有給"
        />
        <div className="border-t border-gray-100 my-2" />
        {patterns.length === 0 && (
          <div className="text-xs text-gray-400 px-2 py-1">作業パターン未ロード</div>
        )}
        {patterns.map((p) => (
          <OptionRow
            key={p.id}
            checked={selection.kind === 'WORK' && selection.patternId === p.id}
            onSelect={() => setSelection({ kind: 'WORK', patternId: p.id })}
            label={p.pattern_name}
            hint={patternAssignees.get(p.id)}
          />
        ))}
      </div>

      <div className="flex justify-end gap-2 mt-3">
        <button
          type="button"
          onClick={closeCell}
          className="px-3 py-1 text-xs text-gray-600 hover:text-gray-800"
        >
          キャンセル
        </button>
        <button
          type="button"
          onClick={onApply}
          disabled={unchanged}
          className="px-3 py-1 text-xs font-semibold rounded bg-brand-600 text-white disabled:bg-gray-300"
        >
          反映
        </button>
      </div>
      <p className="text-[10px] text-gray-400 mt-2">
        ※ まだ保存されません。変更内容は「確定」ボタンで一括反映されます。
      </p>
    </div>
  )
}

function OptionRow({
  checked,
  onSelect,
  label,
  hint,
}: {
  checked: boolean
  onSelect: () => void
  label: string
  hint?: string
}) {
  return (
    <label
      className={
        'flex items-center gap-2 px-2 py-1 rounded cursor-pointer hover:bg-gray-50 ' +
        (checked ? 'bg-brand-50' : '')
      }
    >
      <input type="radio" checked={checked} onChange={onSelect} />
      <span>{label}</span>
      {hint && (
        <span className="ml-auto text-[10px] text-gray-400 truncate max-w-[140px]">
          {hint}
        </span>
      )}
    </label>
  )
}
