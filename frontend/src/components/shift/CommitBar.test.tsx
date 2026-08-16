import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import CommitBar from './CommitBar'
import { batchPatchAssignments, requestCompensatory } from '../../api/schedules'
import { cellKey, useEditorStore } from '../../stores/editor'
import type { CellState } from '../../types/api'

vi.mock('../../api/schedules', () => ({
  batchPatchAssignments: vi.fn(),
  requestCompensatory: vi.fn(),
}))

const mockBatch = vi.mocked(batchPatchAssignments)
// requestCompensatory は手動再要求用に温存しているが、CommitBar からは呼ばれない（issue #91）
const mockComp = vi.mocked(requestCompensatory)

function setupEditingScenario(opts: {
  serverCells: Map<string, CellState>
  cells: Map<string, CellState>
}) {
  useEditorStore.setState({
    mode: 'edit',
    scheduleId: 99,
    year: 2026,
    month: 4,
    serverCells: opts.serverCells as never,
    cells: opts.cells as never,
  })
}

beforeEach(() => {
  useEditorStore.getState().reset()
  mockBatch.mockReset()
  mockComp.mockReset()
})

afterEach(() => {
  useEditorStore.getState().reset()
  vi.clearAllMocks()
})

const SERVER_REST: CellState = { assignmentType: 'REST', patternId: null, leaveType: null, label: '割当休日' }
const NEW_WORK: CellState = { assignmentType: 'WORK', patternId: 10, leaveType: null, label: 'A1' }

describe('CommitBar — visibility and pending count', () => {
  it('renders nothing in view mode', () => {
    const { container } = render(<CommitBar />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows "変更なし" when in edit mode with no diffs', () => {
    setupEditingScenario({
      serverCells: new Map([[cellKey(1, 1), SERVER_REST]]),
      cells: new Map([[cellKey(1, 1), SERVER_REST]]),
    })

    render(<CommitBar />)

    expect(screen.getByText('変更なし（編集モード中）')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '確定' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '破棄' })).toBeDisabled()
  })

  it('shows the pending count when cells differ from server', () => {
    setupEditingScenario({
      serverCells: new Map([
        [cellKey(1, 1), SERVER_REST],
        [cellKey(1, 2), SERVER_REST],
      ]),
      cells: new Map([
        [cellKey(1, 1), NEW_WORK],
        [cellKey(1, 2), SERVER_REST],
      ]),
    })

    render(<CommitBar />)

    expect(screen.getByText('未確定の変更: 1 件')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '確定' })).toBeEnabled()
  })
})

describe('CommitBar — discard flow', () => {
  it('shows confirm prompt then discards on confirmation', async () => {
    setupEditingScenario({
      serverCells: new Map([[cellKey(1, 1), SERVER_REST]]),
      cells: new Map([[cellKey(1, 1), NEW_WORK]]),
    })
    const user = userEvent.setup()
    render(<CommitBar />)

    await user.click(screen.getByRole('button', { name: '破棄' }))
    expect(screen.getByText('破棄しますか?')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '破棄する' }))

    // discardPending → cells = serverCells
    expect(useEditorStore.getState().cells.get(cellKey(1, 1))!.assignmentType).toBe('REST')
  })

  it('cancel keeps changes intact', async () => {
    setupEditingScenario({
      serverCells: new Map([[cellKey(1, 1), SERVER_REST]]),
      cells: new Map([[cellKey(1, 1), NEW_WORK]]),
    })
    const user = userEvent.setup()
    render(<CommitBar />)

    await user.click(screen.getByRole('button', { name: '破棄' }))
    await user.click(screen.getByRole('button', { name: 'やめる' }))

    expect(screen.getByText('未確定の変更: 1 件')).toBeInTheDocument()
    expect(useEditorStore.getState().cells.get(cellKey(1, 1))!.assignmentType).toBe('WORK')
  })
})

describe('CommitBar — commit flow', () => {
  it('on commit, calls batchPatchAssignments and applies results + success toast', async () => {
    setupEditingScenario({
      serverCells: new Map([[cellKey(1, 1), SERVER_REST]]),
      cells: new Map([[cellKey(1, 1), NEW_WORK]]),
    })
    mockBatch.mockResolvedValueOnce({
      results: [
        { employee_id: 1, day: 1, label: 'A1', assignment_type: 'WORK', pattern_id: 10 },
      ],
    })

    const user = userEvent.setup()
    render(<CommitBar />)

    await user.click(screen.getByRole('button', { name: '確定' }))

    await waitFor(() => expect(mockBatch).toHaveBeenCalledTimes(1))
    expect(mockBatch).toHaveBeenCalledWith(99, expect.objectContaining({
      edits: expect.arrayContaining([
        expect.objectContaining({ employee_id: 1, date: '2026-04-01', assignment_type: 'WORK' }),
      ]),
    }))
    expect(useEditorStore.getState().toast?.kind).toBe('success')
  })

  it('sets compensatoryContext from server-supplied compensatory_suggestion (issue #91)', async () => {
    // backend が REST→WORK 遷移を検知して代休候補を自動添付する。
    // frontend は edits を再走査せず、response を素直に反映する。
    setupEditingScenario({
      serverCells: new Map([[cellKey(5, 10), SERVER_REST]]),
      cells: new Map([[cellKey(5, 10), NEW_WORK]]),
    })
    mockBatch.mockResolvedValueOnce({
      results: [
        { employee_id: 5, day: 10, label: 'A1', assignment_type: 'WORK', pattern_id: 10 },
      ],
      compensatory_suggestion: {
        employee_id: 5,
        target_date: '2026-04-10',
        proposals: [{ date: '2026-04-12', score: 0.8, reason: '低稼働日' }],
        additional_transition_count: 0,
      },
    })

    const user = userEvent.setup()
    render(<CommitBar />)

    await user.click(screen.getByRole('button', { name: '確定' }))

    await waitFor(() => {
      expect(useEditorStore.getState().compensatoryContext).not.toBeNull()
    })
    expect(useEditorStore.getState().compensatoryContext!.proposals[0].date).toBe('2026-04-12')
    // CommitBar からの requestCompensatory 呼び出しは廃止
    expect(mockComp).not.toHaveBeenCalled()
  })

  it.each([
    [
      // backend は内部コード（H8/H10/H11/H13）を露出させない（issue #91）。
      // detail は { message: ... } のみで、code / conflicting は含まれない。
      { response: { data: { detail: { message: '選択した変更は他の制約と矛盾するため確定できません' } } } },
      '選択した変更は他の制約と矛盾するため確定できません',
    ],
    [{ response: { data: { detail: 'シンプル文字列エラー' } } }, 'シンプル文字列エラー'],
    [new Error('opaque'), '確定に失敗しました'],
  ])('shows error toast for various error shapes', async (err, expectedMsg) => {
    setupEditingScenario({
      serverCells: new Map([[cellKey(1, 1), SERVER_REST]]),
      cells: new Map([[cellKey(1, 1), NEW_WORK]]),
    })
    mockBatch.mockRejectedValueOnce(err)

    const user = userEvent.setup()
    render(<CommitBar />)

    await user.click(screen.getByRole('button', { name: '確定' }))

    await waitFor(() => {
      expect(useEditorStore.getState().toast?.kind).toBe('error')
    })
    expect(useEditorStore.getState().toast!.message).toContain(expectedMsg)
  })

  it('does not expose internal constraint codes (H8/H10/H11/H13) in error toast', async () => {
    setupEditingScenario({
      serverCells: new Map([[cellKey(1, 1), SERVER_REST]]),
      cells: new Map([[cellKey(1, 1), NEW_WORK]]),
    })
    // 旧スキーマ風（code を含む）の応答が来てもクライアントは code を表示しない
    mockBatch.mockRejectedValueOnce({
      response: { data: { detail: { code: 'H10', message: '希望休と衝突' } } },
    })

    const user = userEvent.setup()
    render(<CommitBar />)

    await user.click(screen.getByRole('button', { name: '確定' }))

    await waitFor(() => {
      expect(useEditorStore.getState().toast?.kind).toBe('error')
    })
    const message = useEditorStore.getState().toast!.message
    expect(message).not.toMatch(/H(8|10|11|13)/)
  })
})

describe('CommitBar — 強制確定 (issue #245)', () => {
  const CONSTRAINT_ERR = {
    response: { data: { detail: { message: '曜日ごとの作業パターン人数条件を満たせなくなります。' } } },
  }

  it('制約違反 (409) のあと「制約を無視して確定」ボタンが出る', async () => {
    setupEditingScenario({
      serverCells: new Map([[cellKey(1, 1), SERVER_REST]]),
      cells: new Map([[cellKey(1, 1), NEW_WORK]]),
    })
    mockBatch.mockRejectedValueOnce(CONSTRAINT_ERR)

    const user = userEvent.setup()
    render(<CommitBar />)

    // 違反前は force ボタン無し
    expect(screen.queryByRole('button', { name: '制約を無視して確定' })).toBeNull()

    await user.click(screen.getByRole('button', { name: '確定' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '制約を無視して確定' })).toBeInTheDocument()
    })
  })

  it('文字列 detail のエラーでは force ボタンを出さない', async () => {
    setupEditingScenario({
      serverCells: new Map([[cellKey(1, 1), SERVER_REST]]),
      cells: new Map([[cellKey(1, 1), NEW_WORK]]),
    })
    mockBatch.mockRejectedValueOnce({ response: { data: { detail: '年月が一致しません' } } })

    const user = userEvent.setup()
    render(<CommitBar />)
    await user.click(screen.getByRole('button', { name: '確定' }))

    await waitFor(() => expect(useEditorStore.getState().toast?.kind).toBe('error'))
    expect(screen.queryByRole('button', { name: '制約を無視して確定' })).toBeNull()
  })

  it('force ボタン → 警告ダイアログ → 確定で force:true を送信し反映する', async () => {
    setupEditingScenario({
      serverCells: new Map([[cellKey(1, 1), SERVER_REST]]),
      cells: new Map([[cellKey(1, 1), NEW_WORK]]),
    })
    mockBatch.mockRejectedValueOnce(CONSTRAINT_ERR)
    mockBatch.mockResolvedValueOnce({
      results: [
        { employee_id: 1, day: 1, label: 'A1', assignment_type: 'WORK', pattern_id: 10 },
      ],
    })

    const user = userEvent.setup()
    render(<CommitBar />)

    await user.click(screen.getByRole('button', { name: '確定' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '制約を無視して確定' })).toBeInTheDocument(),
    )

    await user.click(screen.getByRole('button', { name: '制約を無視して確定' }))

    // 警告ダイアログに違反内容が出る
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('曜日ごとの作業パターン人数条件')

    // ダイアログ内の確定ボタン
    await user.click(screen.getByRole('button', { name: '無視して確定' }))

    await waitFor(() => expect(mockBatch).toHaveBeenCalledTimes(2))
    expect(mockBatch).toHaveBeenLastCalledWith(99, expect.objectContaining({ force: true }))
    expect(useEditorStore.getState().toast?.kind).toBe('success')
    // 反映後 force ボタンは消える
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: '制約を無視して確定' })).toBeNull(),
    )
  })

  it('違反のあと別の編集をすると stale な force ボタンが消える (codex review #4)', async () => {
    setupEditingScenario({
      serverCells: new Map([
        [cellKey(1, 1), SERVER_REST],
        [cellKey(1, 2), SERVER_REST],
      ]),
      cells: new Map([
        [cellKey(1, 1), NEW_WORK],
        [cellKey(1, 2), SERVER_REST],
      ]),
    })
    mockBatch.mockRejectedValueOnce(CONSTRAINT_ERR)

    const user = userEvent.setup()
    render(<CommitBar />)

    await user.click(screen.getByRole('button', { name: '確定' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '制約を無視して確定' })).toBeInTheDocument(),
    )

    // 別セルを編集 = cells を差し替え。前回の違反は別の編集セットに引きずらない。
    act(() => {
      useEditorStore.setState({
        cells: new Map([
          [cellKey(1, 1), NEW_WORK],
          [cellKey(1, 2), NEW_WORK],
        ]) as never,
      })
    })

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: '制約を無視して確定' })).toBeNull(),
    )
  })

  it('ダイアログをキャンセルすると force を送らず編集を保持する', async () => {
    setupEditingScenario({
      serverCells: new Map([[cellKey(1, 1), SERVER_REST]]),
      cells: new Map([[cellKey(1, 1), NEW_WORK]]),
    })
    mockBatch.mockRejectedValueOnce(CONSTRAINT_ERR)

    const user = userEvent.setup()
    render(<CommitBar />)

    await user.click(screen.getByRole('button', { name: '確定' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '制約を無視して確定' })).toBeInTheDocument(),
    )

    await user.click(screen.getByRole('button', { name: '制約を無視して確定' }))
    await screen.findByRole('dialog')
    await user.click(screen.getByRole('button', { name: 'キャンセル' }))

    // force 再送なし (batch は最初の 1 回のみ)
    expect(mockBatch).toHaveBeenCalledTimes(1)
    // 編集は保持
    expect(useEditorStore.getState().cells.get(cellKey(1, 1))!.assignmentType).toBe('WORK')
    // force ボタンは残る
    expect(screen.getByRole('button', { name: '制約を無視して確定' })).toBeInTheDocument()
  })

  it('force でも却下された制約 (H10 等) は force ボタンを引っ込める', async () => {
    setupEditingScenario({
      serverCells: new Map([[cellKey(1, 1), SERVER_REST]]),
      cells: new Map([[cellKey(1, 1), NEW_WORK]]),
    })
    // 通常確定 → 制約違反、force 再送 → やはり違反 (上書き不可)
    mockBatch.mockRejectedValueOnce(CONSTRAINT_ERR)
    mockBatch.mockRejectedValueOnce({
      response: { data: { detail: { message: 'この日は有給休暇のため、勤務に変更できません。' } } },
    })

    const user = userEvent.setup()
    render(<CommitBar />)

    await user.click(screen.getByRole('button', { name: '確定' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '制約を無視して確定' })).toBeInTheDocument(),
    )

    await user.click(screen.getByRole('button', { name: '制約を無視して確定' }))
    await screen.findByRole('dialog')
    await user.click(screen.getByRole('button', { name: '無視して確定' }))

    await waitFor(() => expect(mockBatch).toHaveBeenCalledTimes(2))
    // 上書き不可なので force ボタンは消える + エラートースト
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: '制約を無視して確定' })).toBeNull(),
    )
    expect(useEditorStore.getState().toast?.kind).toBe('error')
    expect(useEditorStore.getState().toast!.message).toContain('有給休暇')
  })
})
