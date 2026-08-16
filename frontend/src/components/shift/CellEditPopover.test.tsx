import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import CellEditPopover from './CellEditPopover'
import { cellKey, useEditorStore } from '../../stores/editor'
import type { CellState, WorkPattern } from '../../types/api'

const A1: WorkPattern = {
  id: 10, group_id: 1, department_id: 1, pattern_name: 'A1', shift_type: 2,
  shift_start: '09:00', shift_end: '18:00', sort_order: 0, is_auxiliary: false,
}

const B2: WorkPattern = {
  id: 20, group_id: 2, department_id: 1, pattern_name: 'B2', shift_type: 1,
  shift_start: '07:00', shift_end: '15:00', sort_order: 0, is_auxiliary: false,
}

const ANCHOR = { top: 100, left: 100, bottom: 130, right: 180, width: 80, height: 30 }

const REST_CELL: CellState = {
  assignmentType: 'REST', patternId: null, leaveType: null, label: '割当休日',
}

const A1_CELL: CellState = {
  assignmentType: 'WORK', patternId: 10, leaveType: null, label: 'A1',
}

function setupStore(opts: { prior: CellState; otherEmployees?: Array<{ id: number; name: string; cell: CellState }> }) {
  const cells = new Map<string, CellState>()
  cells.set(cellKey(1, 5), opts.prior)
  const employeeOrder = [1]
  const employeeNames = new Map<number, string>([[1, 'Alice']])
  for (const o of opts.otherEmployees ?? []) {
    cells.set(cellKey(o.id, 5), o.cell)
    employeeOrder.push(o.id)
    employeeNames.set(o.id, o.name)
  }
  useEditorStore.setState({
    mode: 'edit',
    scheduleId: 1,
    year: 2026,
    month: 4,
    employeeOrder,
    employeeNames,
    cells: cells as never,
    serverCells: new Map([[cellKey(1, 5), opts.prior]]) as never,
    patterns: [A1, B2],
    patternNameToId: new Map([['A1', 10], ['B2', 20]]),
    patternIdToName: new Map([[10, 'A1'], [20, 'B2']]),
  })
  useEditorStore.getState().openCell(cellKey(1, 5), ANCHOR)
}

beforeEach(() => {
  useEditorStore.getState().reset()
})

afterEach(() => {
  useEditorStore.getState().reset()
})

// ---------------------------------------------------------------------------
// 表示
// ---------------------------------------------------------------------------

describe('CellEditPopover — visibility', () => {
  it('renders nothing when pendingEdit is null', () => {
    const { container } = render(<CellEditPopover />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the popover with employee/day header when pendingEdit is set', () => {
    setupStore({ prior: REST_CELL })
    render(<CellEditPopover />)

    expect(screen.getByText('従業員 ID 1 / 5 日')).toBeInTheDocument()
    expect(screen.getByText('割当休日')).toBeInTheDocument()
    expect(screen.getByText('● 希望休')).toBeInTheDocument()
    expect(screen.getByText('A1')).toBeInTheDocument()
    expect(screen.getByText('B2')).toBeInTheDocument()
  })

  it('shows "作業パターン未ロード" when there are no patterns', () => {
    setupStore({ prior: REST_CELL })
    useEditorStore.setState({ patterns: [] })

    render(<CellEditPopover />)

    expect(screen.getByText('作業パターン未ロード')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// 初期選択
// ---------------------------------------------------------------------------

describe('CellEditPopover — initial selection from prior cell', () => {
  it('preselects REST when prior is 割当休日', () => {
    setupStore({ prior: REST_CELL })
    render(<CellEditPopover />)

    const restRadio = screen.getByLabelText('割当休日') as HTMLInputElement
    expect(restRadio.checked).toBe(true)
  })

  it('preselects WORK pattern when prior is WORK', () => {
    setupStore({ prior: A1_CELL })
    render(<CellEditPopover />)

    expect((screen.getByLabelText('A1') as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText('B2') as HTMLInputElement).checked).toBe(false)
  })

  it('preselects LEAVE variant matching leaveType', () => {
    setupStore({
      prior: { assignmentType: 'LEAVE', patternId: null, leaveType: 'MANDATORY', label: '有給' },
    })
    render(<CellEditPopover />)

    expect((screen.getByLabelText('有給') as HTMLInputElement).checked).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 反映ボタン
// ---------------------------------------------------------------------------

describe('CellEditPopover — apply button', () => {
  it('is disabled when selection is unchanged from prior', () => {
    setupStore({ prior: REST_CELL })
    render(<CellEditPopover />)

    expect(screen.getByRole('button', { name: '反映' })).toBeDisabled()
  })

  it('enables and stages a WORK edit when a different pattern is chosen', async () => {
    setupStore({ prior: REST_CELL })
    const user = userEvent.setup()
    render(<CellEditPopover />)

    await user.click(screen.getByLabelText('B2'))

    const apply = screen.getByRole('button', { name: '反映' })
    expect(apply).toBeEnabled()
    await user.click(apply)

    const newCell = useEditorStore.getState().cells.get(cellKey(1, 5))!
    expect(newCell.assignmentType).toBe('WORK')
    expect(newCell.patternId).toBe(20)
    expect(newCell.label).toBe('B2')
  })

  it('stages a LEAVE edit with the correct label per variant', async () => {
    setupStore({ prior: REST_CELL })
    const user = userEvent.setup()
    render(<CellEditPopover />)

    await user.click(screen.getByLabelText('● 希望休'))
    await user.click(screen.getByRole('button', { name: '反映' }))

    const c = useEditorStore.getState().cells.get(cellKey(1, 5))!
    expect(c.assignmentType).toBe('LEAVE')
    expect(c.leaveType).toBe('REQUESTED')
    expect(c.label).toBe('●')
  })

  it('stages a REST edit when switching from WORK back to 割当休日', async () => {
    setupStore({ prior: A1_CELL })
    const user = userEvent.setup()
    render(<CellEditPopover />)

    await user.click(screen.getByLabelText('割当休日'))
    await user.click(screen.getByRole('button', { name: '反映' }))

    const c = useEditorStore.getState().cells.get(cellKey(1, 5))!
    expect(c.assignmentType).toBe('REST')
    expect(c.patternId).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 閉じる
// ---------------------------------------------------------------------------

describe('CellEditPopover — close behavior', () => {
  it('cancel button calls closeCell', async () => {
    setupStore({ prior: REST_CELL })
    const user = userEvent.setup()
    render(<CellEditPopover />)

    await user.click(screen.getByRole('button', { name: 'キャンセル' }))

    expect(useEditorStore.getState().pendingEdit).toBeNull()
  })

  it('Escape key closes the popover', async () => {
    setupStore({ prior: REST_CELL })
    const user = userEvent.setup()
    render(<CellEditPopover />)

    await user.keyboard('{Escape}')

    expect(useEditorStore.getState().pendingEdit).toBeNull()
  })

  it('mousedown outside the popover closes it', async () => {
    setupStore({ prior: REST_CELL })
    const user = userEvent.setup()
    const { container } = render(
      <div>
        <CellEditPopover />
        <button data-testid="outside">outside</button>
      </div>,
    )
    void container

    await user.click(screen.getByTestId('outside'))

    expect(useEditorStore.getState().pendingEdit).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// patternAssignees ヒント
// ---------------------------------------------------------------------------

describe('CellEditPopover — pattern assignees hint', () => {
  it('shows other employees assigned to a pattern on the same day', () => {
    setupStore({
      prior: REST_CELL,
      otherEmployees: [
        { id: 2, name: 'Bob', cell: A1_CELL },
        { id: 3, name: 'Carol', cell: A1_CELL },
      ],
    })

    render(<CellEditPopover />)

    // A1 行に Bob, Carol のヒント。getByLabelText は hint 込みの label 全文と
    // 比較するため使えず、span のテキスト "A1" から label を逆引きする
    const a1Row = screen.getByText('A1').closest('label')!
    expect(a1Row.textContent).toContain('Bob')
    expect(a1Row.textContent).toContain('Carol')
  })

  it('excludes the editing employee from the hint', () => {
    setupStore({
      prior: A1_CELL,
      otherEmployees: [{ id: 2, name: 'Bob', cell: A1_CELL }],
    })

    render(<CellEditPopover />)

    const a1Row = screen.getByText('A1').closest('label')!
    expect(a1Row.textContent).toContain('Bob')
    // Alice (編集者本人) はヒントに出ない
    expect(a1Row.textContent).not.toContain('Alice')
  })
})
