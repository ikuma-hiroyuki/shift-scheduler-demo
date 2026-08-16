import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import CompensatoryPopover from './CompensatoryPopover'
import { cellKey, useEditorStore } from '../../stores/editor'
import type { CompensatoryProposal } from '../../types/api'

const PROPOSALS: CompensatoryProposal[] = [
  { date: '2026-04-15', score: 0.9, reason: '人員に余裕あり' },
  { date: '2026-04-22', score: 0.7, reason: '需要低め' },
]

beforeEach(() => {
  useEditorStore.getState().reset()
  // 既存セルをセットして stageEdit が動くようにする
  useEditorStore.setState({
    year: 2026,
    month: 4,
    cells: new Map([
      [cellKey(1, 15), { assignmentType: 'WORK', patternId: 10, leaveType: null, label: 'A1' }],
      [cellKey(1, 22), { assignmentType: 'WORK', patternId: 10, leaveType: null, label: 'A1' }],
    ]),
  })
})

afterEach(() => {
  useEditorStore.getState().reset()
})

describe('CompensatoryPopover', () => {
  it('renders nothing when compensatoryContext is null', () => {
    const { container } = render(<CompensatoryPopover />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders proposals with date / score / reason when context is set', () => {
    useEditorStore.getState().setCompensatoryContext({
      employeeId: 1,
      targetDate: '2026-04-10',
      proposals: PROPOSALS,
    })

    render(<CompensatoryPopover />)

    expect(screen.getByText('代休候補日')).toBeInTheDocument()
    expect(screen.getByText(/2026-04-10 を勤務に変更しました/)).toBeInTheDocument()
    expect(screen.getByText('2026-04-15')).toBeInTheDocument()
    expect(screen.getByText(/スコア 0\.9 — 人員に余裕あり/)).toBeInTheDocument()
    expect(screen.getByText('2026-04-22')).toBeInTheDocument()
  })

  it('clicking a proposal stages REST edit, enters edit mode, fires info toast and clears context', async () => {
    useEditorStore.getState().setCompensatoryContext({
      employeeId: 1,
      targetDate: '2026-04-10',
      proposals: PROPOSALS,
    })
    const user = userEvent.setup()
    render(<CompensatoryPopover />)

    await user.click(screen.getByRole('button', { name: /2026-04-15/ }))

    const s = useEditorStore.getState()
    expect(s.mode).toBe('edit')
    expect(s.cells.get(cellKey(1, 15))!.assignmentType).toBe('REST')
    expect(s.cells.get(cellKey(1, 15))!.label).toBe('割当休日')
    expect(s.toast?.kind).toBe('info')
    expect(s.toast?.message).toContain('2026-04-15')
    expect(s.compensatoryContext).toBeNull()
  })

  it('shows error toast and skips edit when target cell is missing', async () => {
    useEditorStore.getState().setCompensatoryContext({
      employeeId: 999,  // セル登録なし
      targetDate: '2026-04-10',
      proposals: PROPOSALS,
    })
    const user = userEvent.setup()
    render(<CompensatoryPopover />)

    await user.click(screen.getByRole('button', { name: /2026-04-15/ }))

    const s = useEditorStore.getState()
    expect(s.toast?.kind).toBe('error')
    expect(s.toast?.message).toContain('セル情報が見つかりません')
    expect(s.cells.get(cellKey(999, 15))).toBeUndefined()
  })

  it('"あとで決める" button clears the compensatory context', async () => {
    useEditorStore.getState().setCompensatoryContext({
      employeeId: 1,
      targetDate: '2026-04-10',
      proposals: PROPOSALS,
    })
    const user = userEvent.setup()
    render(<CompensatoryPopover />)

    await user.click(screen.getByRole('button', { name: 'あとで決める' }))

    expect(useEditorStore.getState().compensatoryContext).toBeNull()
  })
})
