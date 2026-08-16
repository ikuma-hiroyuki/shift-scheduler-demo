import { create } from 'zustand'
import type {
  AssignmentPatchRequest,
  AssignmentType,
  AssignmentsResponse,
  CellPatchResponse,
  CellState,
  CompensatoryProposal,
  EditDelta,
  LeaveType,
  WorkPattern,
} from '../types/api'

export type CellKey = `${number}:${number}` // `${employeeId}:${day}`

export function cellKey(employeeId: number, day: number): CellKey {
  return `${employeeId}:${day}` as CellKey
}

function cellEquals(a: CellState, b: CellState): boolean {
  return (
    a.assignmentType === b.assignmentType &&
    a.patternId === b.patternId &&
    a.leaveType === b.leaveType
  )
}

export interface PendingEdit {
  key: CellKey
  employeeId: number
  day: number
  anchorRect: { top: number; left: number; bottom: number; right: number; width: number; height: number }
  prior: CellState
}

export interface CompensatoryContext {
  employeeId: number
  targetDate: string
  proposals: CompensatoryProposal[]
}

export interface ToastState {
  kind: 'error' | 'info' | 'success'
  message: string
}

interface EditorState {
  mode: 'view' | 'edit'
  scheduleId: number | null
  year: number | null
  month: number | null
  employeeOrder: number[]
  employeeNames: Map<number, string>
  serverCells: Map<CellKey, CellState>
  cells: Map<CellKey, CellState>
  patterns: WorkPattern[]
  patternNameToId: Map<string, number>
  patternIdToName: Map<number, string>
  pendingEdit: PendingEdit | null
  committing: boolean
  compensatoryContext: CompensatoryContext | null
  toast: ToastState | null
  undoStack: EditDelta[]
  redoStack: EditDelta[]

  enterEditMode: () => void
  exitEditMode: () => void
  hydrate: (data: AssignmentsResponse, scheduleId: number, patterns: WorkPattern[]) => void
  openCell: (key: CellKey, anchorRect: PendingEdit['anchorRect']) => void
  closeCell: () => void
  stageEdit: (key: CellKey, next: CellState) => void
  undo: () => void
  redo: () => void
  discardPending: () => void
  applyCommitResults: (results: CellPatchResponse[]) => void
  setCommitting: (v: boolean) => void
  setCompensatoryContext: (ctx: CompensatoryContext | null) => void
  setToast: (t: ToastState | null) => void
  reset: () => void
}

const UNDO_LIMIT = 50

export const useEditorStore = create<EditorState>()((set, get) => ({
  mode: 'view',
  scheduleId: null,
  year: null,
  month: null,
  employeeOrder: [],
  employeeNames: new Map(),
  serverCells: new Map(),
  cells: new Map(),
  patterns: [],
  patternNameToId: new Map(),
  patternIdToName: new Map(),
  pendingEdit: null,
  committing: false,
  compensatoryContext: null,
  toast: null,
  undoStack: [],
  redoStack: [],

  enterEditMode: () => set({ mode: 'edit' }),
  exitEditMode: () => {
    const { cells, serverCells } = get()
    // 未確定 pending が残っていたら破棄して view に戻す
    const hasPending = Array.from(cells.keys()).some(
      (k) => !cellEquals(cells.get(k)!, serverCells.get(k) ?? cells.get(k)!),
    )
    set({
      mode: 'view',
      pendingEdit: null,
      compensatoryContext: null,
      undoStack: [],
      redoStack: [],
      cells: hasPending ? new Map(serverCells) : cells,
    })
  },

  hydrate: (data, scheduleId, patterns) => {
    const patternNameToId = new Map<string, number>()
    const patternIdToName = new Map<number, string>()
    for (const p of patterns) {
      patternNameToId.set(p.pattern_name, p.id)
      patternIdToName.set(p.id, p.pattern_name)
    }
    const cells = new Map<CellKey, CellState>()
    const employeeNames = new Map<number, string>()
    const employeeOrder: number[] = []
    for (const emp of data.employees) {
      employeeOrder.push(emp.id)
      employeeNames.set(emp.id, emp.name)
      for (const d of emp.days) {
        // backend が構造化 field を直接返すため、label の逆引きは行わない（issue #91）。
        // 旧 backend 互換のフォールバックは持たない（同期 deploy 前提）。
        cells.set(cellKey(emp.id, d.day), {
          assignmentType: d.assignment_type ?? null,
          patternId: d.pattern_id ?? null,
          leaveType: d.leave_type ?? null,
          label: d.label,
        })
      }
    }
    set({
      scheduleId,
      year: data.year,
      month: data.month,
      employeeOrder,
      employeeNames,
      serverCells: new Map(cells),
      cells,
      patterns,
      patternNameToId,
      patternIdToName,
      undoStack: [],
      redoStack: [],
    })
  },

  openCell: (key, anchorRect) => {
    const { cells, mode } = get()
    if (mode !== 'edit') return
    const prior = cells.get(key)
    if (!prior) return
    const [empStr, dayStr] = key.split(':')
    set({
      pendingEdit: {
        key,
        employeeId: Number(empStr),
        day: Number(dayStr),
        anchorRect,
        prior,
      },
    })
  },

  closeCell: () => set({ pendingEdit: null }),

  stageEdit: (key, next) => {
    const { cells, undoStack, year, month } = get()
    const prior = cells.get(key)
    if (!prior || year == null || month == null) return
    if (cellEquals(prior, next)) {
      set({ pendingEdit: null })
      return
    }
    const [empStr, dayStr] = key.split(':')
    const day = Number(dayStr)
    const delta: EditDelta = {
      employeeId: Number(empStr),
      day,
      date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      prior: {
        assignmentType: prior.assignmentType ?? 'REST',
        patternId: prior.patternId,
        leaveType: prior.leaveType,
        label: prior.label,
      },
      next: {
        assignmentType: next.assignmentType ?? 'REST',
        patternId: next.patternId,
        leaveType: next.leaveType,
        label: next.label,
      },
    }
    const newCells = new Map(cells)
    newCells.set(key, next)
    set({
      cells: newCells,
      undoStack: [...undoStack, delta].slice(-UNDO_LIMIT),
      redoStack: [],
      pendingEdit: null,
    })
  },

  undo: () => {
    const { undoStack, redoStack, cells, patternIdToName } = get()
    if (undoStack.length === 0) return
    const delta = undoStack[undoStack.length - 1]
    const key = cellKey(delta.employeeId, delta.day)
    const restored: CellState = {
      assignmentType: delta.prior.assignmentType,
      patternId: delta.prior.patternId,
      leaveType: delta.prior.leaveType,
      label: delta.prior.label || labelFromCellLocal(delta.prior, patternIdToName),
    }
    const newCells = new Map(cells)
    newCells.set(key, restored)
    set({
      cells: newCells,
      undoStack: undoStack.slice(0, -1),
      redoStack: [...redoStack, delta].slice(-UNDO_LIMIT),
    })
  },

  redo: () => {
    const { undoStack, redoStack, cells, patternIdToName } = get()
    if (redoStack.length === 0) return
    const delta = redoStack[redoStack.length - 1]
    const key = cellKey(delta.employeeId, delta.day)
    const applied: CellState = {
      assignmentType: delta.next.assignmentType,
      patternId: delta.next.patternId,
      leaveType: delta.next.leaveType,
      label: delta.next.label || labelFromCellLocal(delta.next, patternIdToName),
    }
    const newCells = new Map(cells)
    newCells.set(key, applied)
    set({
      cells: newCells,
      redoStack: redoStack.slice(0, -1),
      undoStack: [...undoStack, delta].slice(-UNDO_LIMIT),
    })
  },

  discardPending: () => {
    const { serverCells } = get()
    set({
      cells: new Map(serverCells),
      undoStack: [],
      redoStack: [],
      pendingEdit: null,
    })
  },

  applyCommitResults: (results) => {
    const { cells, patternIdToName } = get()
    const newCells = new Map(cells)
    for (const r of results) {
      const key = cellKey(r.employee_id, r.day)
      // backend が leave_type を直接返すため、label からの逆引きは行わない（issue #91）。
      newCells.set(key, {
        assignmentType: r.assignment_type,
        patternId: r.pattern_id,
        leaveType: r.leave_type ?? null,
        label: r.label || (r.pattern_id != null ? patternIdToName.get(r.pattern_id) ?? '' : ''),
      })
    }
    set({
      cells: newCells,
      serverCells: new Map(newCells),
      undoStack: [],
      redoStack: [],
    })
  },

  setCommitting: (v) => set({ committing: v }),
  setCompensatoryContext: (ctx) => set({ compensatoryContext: ctx }),
  setToast: (t) => set({ toast: t }),

  reset: () =>
    set({
      mode: 'view',
      scheduleId: null,
      year: null,
      month: null,
      employeeOrder: [],
      employeeNames: new Map(),
      serverCells: new Map(),
      cells: new Map(),
      patterns: [],
      patternNameToId: new Map(),
      patternIdToName: new Map(),
      pendingEdit: null,
      committing: false,
      compensatoryContext: null,
      toast: null,
      undoStack: [],
      redoStack: [],
    }),
}))

function labelFromCellLocal(
  c: { assignmentType: AssignmentType; patternId: number | null; leaveType: LeaveType | null },
  patternIdToName: Map<number, string>,
): string {
  if (c.assignmentType === 'WORK' && c.patternId != null) {
    return patternIdToName.get(c.patternId) ?? '?'
  }
  if (c.assignmentType === 'LEAVE') {
    if (c.leaveType === 'REQUESTED') return '●'
    if (c.leaveType === 'TENTATIVE') return '○'
    if (c.leaveType === 'MANDATORY') return '有給'
    return '●'
  }
  return '割当休日'
}

export function cellStateFromResponse(
  response: { label: string; assignment_type: AssignmentType; pattern_id: number | null },
  leaveType: LeaveType | null,
): CellState {
  return {
    assignmentType: response.assignment_type,
    patternId: response.pattern_id,
    leaveType,
    label: response.label,
  }
}

/**
 * 現状のローカル差分を batch PATCH ペイロードに変換する。
 */
export function buildPendingPayload(
  cells: Map<CellKey, CellState>,
  serverCells: Map<CellKey, CellState>,
  year: number,
  month: number,
): AssignmentPatchRequest[] {
  const edits: AssignmentPatchRequest[] = []
  for (const [key, next] of cells) {
    const server = serverCells.get(key)
    if (server && cellEquals(server, next)) continue
    const [empStr, dayStr] = key.split(':')
    const day = Number(dayStr)
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    edits.push({
      employee_id: Number(empStr),
      date,
      assignment_type: next.assignmentType ?? 'REST',
      pattern_id: next.patternId,
      leave_type: next.leaveType,
    })
  }
  return edits
}

export function hasPendingChanges(
  cells: Map<CellKey, CellState>,
  serverCells: Map<CellKey, CellState>,
): boolean {
  for (const [key, next] of cells) {
    const server = serverCells.get(key)
    if (!server) return true
    if (!cellEquals(server, next)) return true
  }
  return false
}

export function isPending(
  key: CellKey,
  cells: Map<CellKey, CellState>,
  serverCells: Map<CellKey, CellState>,
): boolean {
  const c = cells.get(key)
  const s = serverCells.get(key)
  if (!c || !s) return false
  return !cellEquals(c, s)
}
