import { afterEach, describe, expect, it } from 'vitest'
import type {
  AssignmentsResponse,
  CellPatchResponse,
  CellState,
  WorkPattern,
} from '../types/api'
import {
  buildPendingPayload,
  cellKey,
  cellStateFromResponse,
  hasPendingChanges,
  isPending,
  useEditorStore,
} from './editor'

// ---------------------------------------------------------------------------
// テスト用フィクスチャ
// ---------------------------------------------------------------------------

const A1: WorkPattern = {
  id: 10,
  group_id: 1,
  department_id: 1,
  pattern_name: 'A1',
  shift_type: 2,
  shift_start: '09:00',
  shift_end: '18:00',
  sort_order: 0,
  is_auxiliary: false,
}

const B2: WorkPattern = {
  id: 20,
  group_id: 2,
  department_id: 1,
  pattern_name: 'B2',
  shift_type: 1,
  shift_start: '07:00',
  shift_end: '15:00',
  sort_order: 0,
  is_auxiliary: false,
}

const PATTERNS = [A1, B2]

function sampleAssignments(): AssignmentsResponse {
  // backend は構造化 field（assignment_type / pattern_id / leave_type）を直接返す（issue #91）。
  // label は表示用のみ。
  return {
    year: 2026,
    month: 4,
    employees: [
      {
        id: 1,
        name: 'Alice',
        role: 'STAFF',
        days: [
          { day: 1, label: 'A1', assignment_type: 'WORK', pattern_id: 10, leave_type: null },
          { day: 2, label: '割当休日', assignment_type: 'REST', pattern_id: null, leave_type: null },
          { day: 3, label: '●', assignment_type: 'LEAVE', pattern_id: null, leave_type: 'REQUESTED' },
          { day: 4, label: '○', assignment_type: 'LEAVE', pattern_id: null, leave_type: 'TENTATIVE' },
          { day: 5, label: '有給', assignment_type: 'LEAVE', pattern_id: null, leave_type: 'MANDATORY' },
          { day: 6, label: '', assignment_type: null, pattern_id: null, leave_type: null },
          { day: 7, label: '', assignment_type: null, pattern_id: null, leave_type: null },
        ],
      },
      {
        id: 2,
        name: 'Bob',
        role: 'CHIEF',
        days: [{ day: 1, label: 'B2', assignment_type: 'WORK', pattern_id: 20, leave_type: null }],
      },
    ],
  }
}

const ANCHOR = {
  top: 0,
  left: 0,
  bottom: 30,
  right: 80,
  width: 80,
  height: 30,
}

afterEach(() => {
  useEditorStore.getState().reset()
})

// ---------------------------------------------------------------------------
// cellKey ヘルパ
// ---------------------------------------------------------------------------

describe('cellKey', () => {
  it('formats as `${employeeId}:${day}`', () => {
    expect(cellKey(7, 15)).toBe('7:15')
    expect(cellKey(0, 0)).toBe('0:0')
  })
})

// ---------------------------------------------------------------------------
// hydrate — backend が構造化 field を直接返す前提（issue #91）
// ---------------------------------------------------------------------------

describe('hydrate', () => {
  it('populates cells, employeeOrder and pattern maps', () => {
    useEditorStore.getState().hydrate(sampleAssignments(), 99, PATTERNS)

    const s = useEditorStore.getState()
    expect(s.scheduleId).toBe(99)
    expect(s.year).toBe(2026)
    expect(s.month).toBe(4)
    expect(s.employeeOrder).toEqual([1, 2])
    expect(s.employeeNames.get(1)).toBe('Alice')
    expect(s.patternNameToId.get('A1')).toBe(10)
    expect(s.patternIdToName.get(10)).toBe('A1')
  })

  it('uses backend assignment_type/pattern_id directly for WORK cells', () => {
    useEditorStore.getState().hydrate(sampleAssignments(), 1, PATTERNS)

    const c = useEditorStore.getState().cells.get(cellKey(1, 1))!
    expect(c.assignmentType).toBe('WORK')
    expect(c.patternId).toBe(10)
    expect(c.leaveType).toBeNull()
    expect(c.label).toBe('A1')
  })

  it('uses backend assignment_type=REST directly', () => {
    useEditorStore.getState().hydrate(sampleAssignments(), 1, PATTERNS)

    const c = useEditorStore.getState().cells.get(cellKey(1, 2))!
    expect(c.assignmentType).toBe('REST')
    expect(c.patternId).toBeNull()
    expect(c.leaveType).toBeNull()
  })

  it.each([
    [3, 'REQUESTED'],
    [4, 'TENTATIVE'],
    [5, 'MANDATORY'],
  ] as const)('uses backend leave_type directly for day=%i', (day, leaveType) => {
    useEditorStore.getState().hydrate(sampleAssignments(), 1, PATTERNS)

    const c = useEditorStore.getState().cells.get(cellKey(1, day))!
    expect(c.assignmentType).toBe('LEAVE')
    expect(c.leaveType).toBe(leaveType)
  })

  it('treats null assignment_type as null in cell state', () => {
    useEditorStore.getState().hydrate(sampleAssignments(), 1, PATTERNS)

    const empty = useEditorStore.getState().cells.get(cellKey(1, 6))!
    const blank = useEditorStore.getState().cells.get(cellKey(1, 7))!
    expect(empty.assignmentType).toBeNull()
    expect(blank.assignmentType).toBeNull()
  })

  it('snapshots a separate serverCells map (mutating cells does not change serverCells)', () => {
    useEditorStore.getState().hydrate(sampleAssignments(), 1, PATTERNS)

    const newCell: CellState = {
      assignmentType: 'WORK',
      patternId: 20,
      leaveType: null,
      label: 'B2',
    }
    useEditorStore.getState().enterEditMode()
    useEditorStore.getState().stageEdit(cellKey(1, 1), newCell)

    const s = useEditorStore.getState()
    expect(s.cells.get(cellKey(1, 1))!.patternId).toBe(20)
    expect(s.serverCells.get(cellKey(1, 1))!.patternId).toBe(10)
  })

  it('clears undo/redo stacks on rehydrate', () => {
    useEditorStore.getState().hydrate(sampleAssignments(), 1, PATTERNS)
    useEditorStore.getState().enterEditMode()
    useEditorStore.getState().stageEdit(cellKey(1, 1), {
      assignmentType: 'WORK', patternId: 20, leaveType: null, label: 'B2',
    })
    expect(useEditorStore.getState().undoStack).toHaveLength(1)

    useEditorStore.getState().hydrate(sampleAssignments(), 1, PATTERNS)

    expect(useEditorStore.getState().undoStack).toHaveLength(0)
    expect(useEditorStore.getState().redoStack).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// enter / exit edit mode
// ---------------------------------------------------------------------------

describe('enterEditMode / exitEditMode', () => {
  it('enterEditMode sets mode to edit', () => {
    useEditorStore.getState().enterEditMode()
    expect(useEditorStore.getState().mode).toBe('edit')
  })

  it('exitEditMode discards pending changes by reverting cells to serverCells', () => {
    useEditorStore.getState().hydrate(sampleAssignments(), 1, PATTERNS)
    useEditorStore.getState().enterEditMode()
    useEditorStore.getState().stageEdit(cellKey(1, 1), {
      assignmentType: 'WORK', patternId: 20, leaveType: null, label: 'B2',
    })

    useEditorStore.getState().exitEditMode()

    const s = useEditorStore.getState()
    expect(s.mode).toBe('view')
    expect(s.cells.get(cellKey(1, 1))!.patternId).toBe(10)
    expect(s.undoStack).toHaveLength(0)
    expect(s.redoStack).toHaveLength(0)
    expect(s.pendingEdit).toBeNull()
  })

  it('exitEditMode does not touch cells when nothing is pending', () => {
    useEditorStore.getState().hydrate(sampleAssignments(), 1, PATTERNS)
    const before = useEditorStore.getState().cells

    useEditorStore.getState().enterEditMode()
    useEditorStore.getState().exitEditMode()

    expect(useEditorStore.getState().cells).toBe(before)
  })
})

// ---------------------------------------------------------------------------
// openCell / closeCell
// ---------------------------------------------------------------------------

describe('openCell / closeCell', () => {
  it('openCell sets pendingEdit with anchor and prior cell when in edit mode', () => {
    useEditorStore.getState().hydrate(sampleAssignments(), 1, PATTERNS)
    useEditorStore.getState().enterEditMode()
    useEditorStore.getState().openCell(cellKey(1, 1), ANCHOR)

    const pe = useEditorStore.getState().pendingEdit
    expect(pe).not.toBeNull()
    expect(pe!.employeeId).toBe(1)
    expect(pe!.day).toBe(1)
    expect(pe!.prior.patternId).toBe(10)
    expect(pe!.anchorRect).toEqual(ANCHOR)
  })

  it('openCell is a no-op in view mode', () => {
    useEditorStore.getState().hydrate(sampleAssignments(), 1, PATTERNS)
    useEditorStore.getState().openCell(cellKey(1, 1), ANCHOR)

    expect(useEditorStore.getState().pendingEdit).toBeNull()
  })

  it('openCell is a no-op for missing cell key', () => {
    useEditorStore.getState().hydrate(sampleAssignments(), 1, PATTERNS)
    useEditorStore.getState().enterEditMode()
    useEditorStore.getState().openCell(cellKey(999, 1), ANCHOR)

    expect(useEditorStore.getState().pendingEdit).toBeNull()
  })

  it('closeCell clears pendingEdit', () => {
    useEditorStore.getState().hydrate(sampleAssignments(), 1, PATTERNS)
    useEditorStore.getState().enterEditMode()
    useEditorStore.getState().openCell(cellKey(1, 1), ANCHOR)
    useEditorStore.getState().closeCell()

    expect(useEditorStore.getState().pendingEdit).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// stageEdit
// ---------------------------------------------------------------------------

describe('stageEdit', () => {
  it('records a delta and updates the cell', () => {
    useEditorStore.getState().hydrate(sampleAssignments(), 1, PATTERNS)
    useEditorStore.getState().enterEditMode()
    useEditorStore.getState().stageEdit(cellKey(1, 1), {
      assignmentType: 'WORK', patternId: 20, leaveType: null, label: 'B2',
    })

    const s = useEditorStore.getState()
    expect(s.cells.get(cellKey(1, 1))!.patternId).toBe(20)
    expect(s.undoStack).toHaveLength(1)
    expect(s.undoStack[0].date).toBe('2026-04-01')
    expect(s.redoStack).toHaveLength(0)
    expect(s.pendingEdit).toBeNull()
  })

  it('does not record a delta when next is identical to prior', () => {
    useEditorStore.getState().hydrate(sampleAssignments(), 1, PATTERNS)
    useEditorStore.getState().enterEditMode()
    const prior = useEditorStore.getState().cells.get(cellKey(1, 1))!
    useEditorStore.getState().stageEdit(cellKey(1, 1), prior)

    expect(useEditorStore.getState().undoStack).toHaveLength(0)
    expect(useEditorStore.getState().pendingEdit).toBeNull()
  })

  it('clears redoStack on a new edit', () => {
    useEditorStore.getState().hydrate(sampleAssignments(), 1, PATTERNS)
    useEditorStore.getState().enterEditMode()
    useEditorStore.getState().stageEdit(cellKey(1, 1), {
      assignmentType: 'WORK', patternId: 20, leaveType: null, label: 'B2',
    })
    useEditorStore.getState().undo()
    expect(useEditorStore.getState().redoStack).toHaveLength(1)

    useEditorStore.getState().stageEdit(cellKey(1, 1), {
      assignmentType: 'REST', patternId: null, leaveType: null, label: '割当休日',
    })

    expect(useEditorStore.getState().redoStack).toHaveLength(0)
  })

  it('does nothing when scheduleId / year / month are not loaded', () => {
    useEditorStore.getState().enterEditMode()
    useEditorStore.getState().stageEdit(cellKey(1, 1), {
      assignmentType: 'REST', patternId: null, leaveType: null, label: '割当休日',
    })

    expect(useEditorStore.getState().undoStack).toHaveLength(0)
  })

  it('caps the undo stack at 50 entries (UNDO_LIMIT)', () => {
    useEditorStore.getState().hydrate(sampleAssignments(), 1, PATTERNS)
    useEditorStore.getState().enterEditMode()
    // 60 回入れ替えても 50 を超えない
    for (let i = 0; i < 60; i++) {
      const target = i % 2 === 0 ? B2 : A1
      useEditorStore.getState().stageEdit(cellKey(1, 1), {
        assignmentType: 'WORK', patternId: target.id, leaveType: null, label: target.pattern_name,
      })
    }
    expect(useEditorStore.getState().undoStack).toHaveLength(50)
  })
})

// ---------------------------------------------------------------------------
// undo / redo
// ---------------------------------------------------------------------------

describe('undo / redo', () => {
  it('undo restores the prior cell state', () => {
    useEditorStore.getState().hydrate(sampleAssignments(), 1, PATTERNS)
    useEditorStore.getState().enterEditMode()
    useEditorStore.getState().stageEdit(cellKey(1, 1), {
      assignmentType: 'WORK', patternId: 20, leaveType: null, label: 'B2',
    })
    useEditorStore.getState().undo()

    const s = useEditorStore.getState()
    expect(s.cells.get(cellKey(1, 1))!.patternId).toBe(10)
    expect(s.undoStack).toHaveLength(0)
    expect(s.redoStack).toHaveLength(1)
  })

  it('undo is a no-op on empty stack', () => {
    useEditorStore.getState().hydrate(sampleAssignments(), 1, PATTERNS)
    useEditorStore.getState().undo()

    expect(useEditorStore.getState().redoStack).toHaveLength(0)
  })

  it('redo re-applies the next state', () => {
    useEditorStore.getState().hydrate(sampleAssignments(), 1, PATTERNS)
    useEditorStore.getState().enterEditMode()
    useEditorStore.getState().stageEdit(cellKey(1, 1), {
      assignmentType: 'WORK', patternId: 20, leaveType: null, label: 'B2',
    })
    useEditorStore.getState().undo()
    useEditorStore.getState().redo()

    const s = useEditorStore.getState()
    expect(s.cells.get(cellKey(1, 1))!.patternId).toBe(20)
    expect(s.undoStack).toHaveLength(1)
    expect(s.redoStack).toHaveLength(0)
  })

  it('redo is a no-op on empty stack', () => {
    useEditorStore.getState().hydrate(sampleAssignments(), 1, PATTERNS)
    useEditorStore.getState().redo()

    expect(useEditorStore.getState().undoStack).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// discardPending
// ---------------------------------------------------------------------------

describe('discardPending', () => {
  it('reverts cells to serverCells and clears stacks/pendingEdit', () => {
    useEditorStore.getState().hydrate(sampleAssignments(), 1, PATTERNS)
    useEditorStore.getState().enterEditMode()
    useEditorStore.getState().openCell(cellKey(1, 1), ANCHOR)
    useEditorStore.getState().stageEdit(cellKey(1, 1), {
      assignmentType: 'WORK', patternId: 20, leaveType: null, label: 'B2',
    })

    useEditorStore.getState().discardPending()

    const s = useEditorStore.getState()
    expect(s.cells.get(cellKey(1, 1))!.patternId).toBe(10)
    expect(s.undoStack).toHaveLength(0)
    expect(s.redoStack).toHaveLength(0)
    expect(s.pendingEdit).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// applyCommitResults
// ---------------------------------------------------------------------------

describe('applyCommitResults', () => {
  it('updates cells and serverCells, clearing undo/redo stacks', () => {
    useEditorStore.getState().hydrate(sampleAssignments(), 1, PATTERNS)
    useEditorStore.getState().enterEditMode()
    useEditorStore.getState().stageEdit(cellKey(1, 1), {
      assignmentType: 'WORK', patternId: 20, leaveType: null, label: 'B2',
    })

    const result: CellPatchResponse = {
      employee_id: 1, day: 1, label: 'B2', assignment_type: 'WORK', pattern_id: 20,
    }
    useEditorStore.getState().applyCommitResults([result])

    const s = useEditorStore.getState()
    expect(s.cells.get(cellKey(1, 1))!.patternId).toBe(20)
    expect(s.serverCells.get(cellKey(1, 1))!.patternId).toBe(20)
    expect(s.undoStack).toHaveLength(0)
    expect(s.redoStack).toHaveLength(0)
  })

  it.each([
    ['●', 'REQUESTED'],
    ['○', 'TENTATIVE'],
    ['有給', 'MANDATORY'],
  ] as const)('uses backend leave_type=%s directly (label=%s for display only)', (label, leaveType) => {
    useEditorStore.getState().hydrate(sampleAssignments(), 1, PATTERNS)
    useEditorStore.getState().applyCommitResults([{
      employee_id: 1, day: 2, label, assignment_type: 'LEAVE', pattern_id: null,
      leave_type: leaveType,
    }])

    expect(useEditorStore.getState().cells.get(cellKey(1, 2))!.leaveType).toBe(leaveType)
  })

  it('falls back to patternIdToName lookup when label is empty', () => {
    useEditorStore.getState().hydrate(sampleAssignments(), 1, PATTERNS)
    useEditorStore.getState().applyCommitResults([{
      employee_id: 1, day: 2, label: '', assignment_type: 'WORK', pattern_id: 10,
    }])

    expect(useEditorStore.getState().cells.get(cellKey(1, 2))!.label).toBe('A1')
  })
})

// ---------------------------------------------------------------------------
// 簡易セッタ
// ---------------------------------------------------------------------------

describe('simple setters', () => {
  it('setCommitting toggles flag', () => {
    useEditorStore.getState().setCommitting(true)
    expect(useEditorStore.getState().committing).toBe(true)

    useEditorStore.getState().setCommitting(false)
    expect(useEditorStore.getState().committing).toBe(false)
  })

  it('setCompensatoryContext stores ctx', () => {
    useEditorStore.getState().setCompensatoryContext({
      employeeId: 5,
      targetDate: '2026-04-10',
      proposals: [{ date: '2026-04-12', score: 0.8, reason: 'low load' }],
    })

    expect(useEditorStore.getState().compensatoryContext?.employeeId).toBe(5)

    useEditorStore.getState().setCompensatoryContext(null)
    expect(useEditorStore.getState().compensatoryContext).toBeNull()
  })

  it('setToast sets and clears the toast', () => {
    useEditorStore.getState().setToast({ kind: 'success', message: 'saved' })
    expect(useEditorStore.getState().toast?.kind).toBe('success')

    useEditorStore.getState().setToast(null)
    expect(useEditorStore.getState().toast).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// reset
// ---------------------------------------------------------------------------

describe('reset', () => {
  it('returns the store to its initial state', () => {
    useEditorStore.getState().hydrate(sampleAssignments(), 1, PATTERNS)
    useEditorStore.getState().enterEditMode()
    useEditorStore.getState().setToast({ kind: 'info', message: 'hi' })

    useEditorStore.getState().reset()

    const s = useEditorStore.getState()
    expect(s.mode).toBe('view')
    expect(s.scheduleId).toBeNull()
    expect(s.cells.size).toBe(0)
    expect(s.serverCells.size).toBe(0)
    expect(s.patterns).toEqual([])
    expect(s.toast).toBeNull()
    expect(s.undoStack).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 純粋関数ヘルパ
// ---------------------------------------------------------------------------

describe('cellStateFromResponse', () => {
  it('maps response shape into CellState passing through leaveType', () => {
    const cs = cellStateFromResponse(
      { label: 'A1', assignment_type: 'WORK', pattern_id: 10 },
      null,
    )
    expect(cs).toEqual({
      assignmentType: 'WORK', patternId: 10, leaveType: null, label: 'A1',
    })

    const cs2 = cellStateFromResponse(
      { label: '●', assignment_type: 'LEAVE', pattern_id: null },
      'REQUESTED',
    )
    expect(cs2.leaveType).toBe('REQUESTED')
  })
})

describe('buildPendingPayload', () => {
  it('emits a patch row only for diffs and formats the date', () => {
    const server = new Map<string, CellState>([
      ['1:1', { assignmentType: 'WORK', patternId: 10, leaveType: null, label: 'A1' }],
      ['1:2', { assignmentType: 'REST', patternId: null, leaveType: null, label: '割当休日' }],
    ])
    const cells = new Map<string, CellState>([
      ['1:1', { assignmentType: 'WORK', patternId: 20, leaveType: null, label: 'B2' }],  // edited
      ['1:2', { assignmentType: 'REST', patternId: null, leaveType: null, label: '割当休日' }],  // unchanged
    ])

    const payload = buildPendingPayload(cells as any, server as any, 2026, 4)

    expect(payload).toHaveLength(1)
    expect(payload[0]).toEqual({
      employee_id: 1,
      date: '2026-04-01',
      assignment_type: 'WORK',
      pattern_id: 20,
      leave_type: null,
    })
  })

  it('defaults assignmentType to REST when null', () => {
    const server = new Map<string, CellState>([
      ['1:5', { assignmentType: 'WORK', patternId: 10, leaveType: null, label: 'A1' }],
    ])
    const cells = new Map<string, CellState>([
      ['1:5', { assignmentType: null, patternId: null, leaveType: null, label: '' }],
    ])

    const payload = buildPendingPayload(cells as any, server as any, 2026, 4)

    expect(payload[0].assignment_type).toBe('REST')
  })
})

describe('hasPendingChanges', () => {
  it('is true when any cell differs from serverCells', () => {
    const server = new Map<string, CellState>([
      ['1:1', { assignmentType: 'WORK', patternId: 10, leaveType: null, label: 'A1' }],
    ])
    const cells = new Map<string, CellState>([
      ['1:1', { assignmentType: 'WORK', patternId: 20, leaveType: null, label: 'B2' }],
    ])

    expect(hasPendingChanges(cells as any, server as any)).toBe(true)
  })

  it('is false when all cells match', () => {
    const same = new Map<string, CellState>([
      ['1:1', { assignmentType: 'WORK', patternId: 10, leaveType: null, label: 'A1' }],
    ])
    expect(hasPendingChanges(same as any, same as any)).toBe(false)
  })

  it('is true when a cell exists in cells but not in serverCells', () => {
    const server = new Map<string, CellState>()
    const cells = new Map<string, CellState>([
      ['1:1', { assignmentType: 'REST', patternId: null, leaveType: null, label: '割当休日' }],
    ])
    expect(hasPendingChanges(cells as any, server as any)).toBe(true)
  })
})

describe('isPending', () => {
  it('returns true for an edited cell, false otherwise', () => {
    const server = new Map<string, CellState>([
      ['1:1', { assignmentType: 'WORK', patternId: 10, leaveType: null, label: 'A1' }],
      ['1:2', { assignmentType: 'REST', patternId: null, leaveType: null, label: '割当休日' }],
    ])
    const cells = new Map<string, CellState>([
      ['1:1', { assignmentType: 'WORK', patternId: 20, leaveType: null, label: 'B2' }],
      ['1:2', { assignmentType: 'REST', patternId: null, leaveType: null, label: '割当休日' }],
    ])

    expect(isPending('1:1' as any, cells as any, server as any)).toBe(true)
    expect(isPending('1:2' as any, cells as any, server as any)).toBe(false)
  })

  it('returns false for missing keys', () => {
    const empty = new Map<string, CellState>()
    expect(isPending('1:1' as any, empty as any, empty as any)).toBe(false)
  })
})
