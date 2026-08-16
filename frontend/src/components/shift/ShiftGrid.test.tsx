import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import ShiftGrid from './ShiftGrid'
import { useEditorStore } from '../../stores/editor'
import type {
  AssignmentsResponse,
  Schedule,
  WorkPattern,
  WorkPatternGroup,
} from '../../types/api'
import { getAssignments } from '../../api/schedules'
import { listWorkPatternGroups, listWorkPatterns } from '../../api/workPatterns'
import { useWorkPatternGroupsStore } from '../../stores/workPatternGroups'

vi.mock('../../api/schedules', () => ({
  getAssignments: vi.fn(),
}))
vi.mock('../../api/workPatterns', () => ({
  listWorkPatterns: vi.fn(),
  listWorkPatternGroups: vi.fn(),
}))
vi.mock('../../api/holidays', () => ({
  listHolidays: vi.fn().mockResolvedValue([]),
}))

// 重い子コンポーネントは関心外なのでスタブ化
vi.mock('./CellEditPopover', () => ({
  default: () => <div data-testid="cell-edit-popover" />,
}))
vi.mock('./CommitBar', () => ({
  default: () => <div data-testid="commit-bar" />,
}))
vi.mock('./CompensatoryPopover', () => ({
  default: () => <div data-testid="compensatory-popover" />,
}))
vi.mock('./EditModeToggle', () => ({
  default: () => <button data-testid="edit-mode-toggle">edit toggle</button>,
}))
vi.mock('./EditToast', () => ({
  default: () => <div data-testid="edit-toast" />,
}))

const mockGetAssignments = vi.mocked(getAssignments)
const mockListWorkPatterns = vi.mocked(listWorkPatterns)
const mockListWorkPatternGroups = vi.mocked(listWorkPatternGroups)

const SCHEDULE: Schedule = {
  id: 1,
  department_id: 10,
  year: 2026,
  month: 4,
  status: 'GENERATED',
  generation_attempt: 2,
  is_active: true,
  diagnosis: null,
  created_at: '',
  started_at: null,
  finished_at: null,
  time_limit: 120,
}

const PATTERNS: WorkPattern[] = [
  {
    id: 100, group_id: 1, department_id: 10, pattern_name: 'A1', shift_type: 2,
    shift_start: '09:00', shift_end: '18:00', sort_order: 0, is_auxiliary: false,
  },
]

const GROUPS: WorkPatternGroup[] = [
  {
    id: 1, department_id: 10, name: '朝番グループ', sort_order: 0,
    is_auxiliary: false, color: '#dcfce7',
  },
  {
    id: 2, department_id: 10, name: '夜番グループ', sort_order: 1,
    is_auxiliary: false, color: '#1e3a8a',
  },
]

function makeAssignments(): AssignmentsResponse {
  // 4 月 30 日。社員 1 名で各日のラベルを A1 / 割当休日 / 空 を組み合わせる
  const days = Array.from({ length: 30 }, (_, i) =>
    i < 22
      ? {
          day: i + 1,
          label: 'A1',
          assignment_type: 'WORK' as const,
          pattern_id: 100,
          leave_type: null,
        }
      : {
          day: i + 1,
          label: '割当休日',
          assignment_type: 'REST' as const,
          pattern_id: null,
          leave_type: null,
        },
  )
  return {
    year: 2026,
    month: 4,
    employees: [{ id: 1, name: 'Alice', role: 'STAFF', days }],
  }
}

beforeEach(() => {
  useEditorStore.getState().reset()
  useWorkPatternGroupsStore.setState({ groupsByDept: {}, inFlight: {} })
  mockGetAssignments.mockReset()
  mockListWorkPatterns.mockReset()
  mockListWorkPatternGroups.mockReset()
  mockListWorkPatternGroups.mockResolvedValue(GROUPS)
})

afterEach(() => {
  useEditorStore.getState().reset()
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// 読み込み・エラー状態
// ---------------------------------------------------------------------------

describe('ShiftGrid — loading and error states', () => {
  it('shows the loading message while fetching', () => {
    mockGetAssignments.mockReturnValue(new Promise(() => {})) // never resolves
    mockListWorkPatterns.mockReturnValue(new Promise(() => {}))
    mockListWorkPatternGroups.mockReturnValue(new Promise(() => {}))

    render(<ShiftGrid schedule={SCHEDULE} />)

    expect(screen.getByText('読み込み中...')).toBeInTheDocument()
  })

  it('shows the error message when an API fails', async () => {
    mockGetAssignments.mockRejectedValueOnce(new Error('boom'))
    mockListWorkPatterns.mockResolvedValueOnce(PATTERNS)

    render(<ShiftGrid schedule={SCHEDULE} />)

    expect(await screen.findByText('詳細データの取得に失敗しました')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// 通常レンダリング
// ---------------------------------------------------------------------------

describe('ShiftGrid — rendered grid', () => {
  beforeEach(() => {
    mockGetAssignments.mockResolvedValue(makeAssignments())
    mockListWorkPatterns.mockResolvedValue(PATTERNS)
  })

  it('renders the header with year, month and attempt', async () => {
    render(<ShiftGrid schedule={SCHEDULE} />)

    expect(
      await screen.findByText('2026年4月 稼働表詳細（第2回）'),
    ).toBeInTheDocument()
  })

  it('renders the employee row with name and computed work/rest counts', async () => {
    render(<ShiftGrid schedule={SCHEDULE} />)

    expect(await screen.findByText('Alice')).toBeInTheDocument()
    // 22 work + 8 rest = 30 days
    expect(screen.getByRole('cell', { name: '22' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '8' })).toBeInTheDocument()
  })

  it('uses theme color tokens for the name cell so dark mode is readable (issue #129)', async () => {
    render(<ShiftGrid schedule={SCHEDULE} />)

    const nameCell = await screen.findByText('Alice')
    // 氏名セルはダーク/ライト両対応のテーマトークンを使う（休日マトリックスと同じ）。
    // 旧実装の text-gray-800 はダークモードで背景に同化していた。
    expect(nameCell.className).toContain('text-brand-900')
    expect(nameCell.className).not.toContain('text-gray-800')
  })

  it('uses theme color tokens for the h3 heading so dark mode is readable (issue #136)', async () => {
    render(<ShiftGrid schedule={SCHEDULE} />)

    const heading = await screen.findByText('2026年4月 稼働表詳細（第2回）')
    // h3 見出しはブランドトークンを使用しダーク/ライト両対応。
    // 旧実装の text-gray-700 はダークモードで背景に同化していた。
    expect(heading.className).toContain('text-brand-900')
    expect(heading.className).not.toContain('text-gray-700')
  })

  it('uses theme color tokens for work/rest count cells so dark mode is readable (issue #136)', async () => {
    render(<ShiftGrid schedule={SCHEDULE} />)

    await screen.findByText('Alice')
    // 勤務カウント (text-ink) と 休日カウント (text-ink-muted) はテーマトークン使用。
    // 旧実装の text-gray-700 / text-gray-500 はダークモードで背景に同化していた。
    const workCell = screen.getByRole('cell', { name: '22' })
    const restCell = screen.getByRole('cell', { name: '8' })
    // text-ink (DEFAULT) は単語境界で照合（text-ink-muted を誤マッチさせない）
    expect(workCell.className.split(/\s+/)).toContain('text-ink')
    expect(workCell.className).not.toContain('text-gray-700')
    expect(restCell.className.split(/\s+/)).toContain('text-ink-muted')
    expect(restCell.className).not.toContain('text-gray-500')
  })

  it('renders day headers 1..30 with weekday labels', async () => {
    render(<ShiftGrid schedule={SCHEDULE} />)

    await screen.findByText('Alice')
    // 全 30 日分のヘッダ
    for (const d of [1, 15, 30]) {
      expect(screen.getAllByText(String(d)).length).toBeGreaterThan(0)
    }
    // 4/1 は水曜
    expect(screen.getAllByText('水').length).toBeGreaterThan(0)
  })

  it('renders the legend chips (rest variants and group names from /work-patterns master)', async () => {
    render(<ShiftGrid schedule={SCHEDULE} />)

    await screen.findByText('Alice')
    expect(screen.getByText('□（割当休日）')).toBeInTheDocument()
    expect(screen.getByText('●（希望休）')).toBeInTheDocument()
    expect(screen.getByText('○（仮休）')).toBeInTheDocument()
    expect(screen.getByText('朝番グループ')).toBeInTheDocument()
    expect(screen.getByText('夜番グループ')).toBeInTheDocument()
  })

  it('applies group.color hex as inline backgroundColor on legend chips', async () => {
    render(<ShiftGrid schedule={SCHEDULE} />)

    await screen.findByText('Alice')
    // 明色背景 → 濃灰文字
    const morning = screen.getByText('朝番グループ')
    expect(morning).toHaveStyle({ backgroundColor: 'rgb(220, 252, 231)' })
    expect(morning).toHaveStyle({ color: 'rgb(31, 41, 55)' })
    // 暗色背景 → 白文字 (contrast logic)
    const night = screen.getByText('夜番グループ')
    expect(night).toHaveStyle({ backgroundColor: 'rgb(30, 58, 138)' })
    expect(night).toHaveStyle({ color: 'rgb(255, 255, 255)' })
  })

  it('applies group.color hex as inline style on assigned cells', async () => {
    render(<ShiftGrid schedule={SCHEDULE} />)

    await screen.findByText('Alice')
    // makeAssignments の最初の22日は label='A1' (pattern_id=100, group_id=1, color=#dcfce7)
    const cells = screen.getAllByText('A1')
    expect(cells.length).toBeGreaterThan(0)
    expect(cells[0]).toHaveStyle({ backgroundColor: 'rgb(220, 252, 231)' })
  })

  it('mounts the auxiliary subcomponents', async () => {
    render(<ShiftGrid schedule={SCHEDULE} />)

    await screen.findByText('Alice')
    expect(screen.getByTestId('cell-edit-popover')).toBeInTheDocument()
    expect(screen.getByTestId('commit-bar')).toBeInTheDocument()
    expect(screen.getByTestId('compensatory-popover')).toBeInTheDocument()
    expect(screen.getByTestId('edit-mode-toggle')).toBeInTheDocument()
    expect(screen.getByTestId('edit-toast')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// セルクリック / キーボードショートカット
// ---------------------------------------------------------------------------

describe('ShiftGrid — interaction', () => {
  beforeEach(() => {
    mockGetAssignments.mockResolvedValue(makeAssignments())
    mockListWorkPatterns.mockResolvedValue(PATTERNS)
  })

  it('cell click calls openCell only in edit mode', async () => {
    const user = userEvent.setup()
    render(<ShiftGrid schedule={SCHEDULE} />)

    await screen.findByText('Alice')
    // view mode: クリックしても pendingEdit セットされない
    const cells = screen.getAllByText('A1')
    await user.click(cells[0])
    expect(useEditorStore.getState().pendingEdit).toBeNull()

    // edit mode に切り替え → クリックで pendingEdit セット
    useEditorStore.getState().enterEditMode()
    await user.click(cells[0])
    await waitFor(() => {
      expect(useEditorStore.getState().pendingEdit).not.toBeNull()
    })
    expect(useEditorStore.getState().pendingEdit!.employeeId).toBe(1)
    expect(useEditorStore.getState().pendingEdit!.day).toBe(1)
  })

  it('Cmd+Z calls undo in edit mode (and is a no-op in view mode)', async () => {
    const user = userEvent.setup()
    render(<ShiftGrid schedule={SCHEDULE} />)

    await screen.findByText('Alice')

    // view モードで Cmd+Z → 何も起きない（undoStack 空維持）
    await user.keyboard('{Meta>}z{/Meta}')
    expect(useEditorStore.getState().redoStack).toHaveLength(0)

    // edit モードに入って 1 回 stageEdit → undo で redoStack に積まれる
    useEditorStore.getState().enterEditMode()
    useEditorStore.getState().stageEdit('1:1' as `${number}:${number}`, {
      assignmentType: 'REST', patternId: null, leaveType: null, label: '割当休日',
    })
    expect(useEditorStore.getState().undoStack).toHaveLength(1)

    await user.keyboard('{Meta>}z{/Meta}')
    expect(useEditorStore.getState().undoStack).toHaveLength(0)
    expect(useEditorStore.getState().redoStack).toHaveLength(1)
  })

  it('Cmd+Y and Cmd+Shift+Z call redo', async () => {
    const user = userEvent.setup()
    render(<ShiftGrid schedule={SCHEDULE} />)

    await screen.findByText('Alice')

    // 編集 → undo して redoStack に積む
    useEditorStore.getState().enterEditMode()
    useEditorStore.getState().stageEdit('1:1' as `${number}:${number}`, {
      assignmentType: 'REST', patternId: null, leaveType: null, label: '割当休日',
    })
    useEditorStore.getState().undo()
    expect(useEditorStore.getState().redoStack).toHaveLength(1)

    // Cmd+Y → redo（undoStack に戻る）
    await user.keyboard('{Meta>}y{/Meta}')
    expect(useEditorStore.getState().undoStack).toHaveLength(1)
    expect(useEditorStore.getState().redoStack).toHaveLength(0)

    // もう一度 undo → Cmd+Shift+Z でも redo できる
    useEditorStore.getState().undo()
    expect(useEditorStore.getState().redoStack).toHaveLength(1)

    await user.keyboard('{Meta>}{Shift>}z{/Shift}{/Meta}')
    expect(useEditorStore.getState().undoStack).toHaveLength(1)
    expect(useEditorStore.getState().redoStack).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 印刷ボタン
// ---------------------------------------------------------------------------

describe('ShiftGrid — print button', () => {
  beforeEach(() => {
    mockGetAssignments.mockResolvedValue(makeAssignments())
    mockListWorkPatterns.mockResolvedValue(PATTERNS)
  })

  it('is enabled in view mode and disabled in edit mode', async () => {
    render(<ShiftGrid schedule={SCHEDULE} />)

    const printBtn = await screen.findByRole('button', { name: '印刷' })
    expect(printBtn).toBeEnabled()

    useEditorStore.getState().enterEditMode()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '印刷' })).toBeDisabled()
    })
  })

  it('印刷ボタンは全画面を解除してから window.print() を呼ぶ (issue #238)', async () => {
    const user = userEvent.setup()
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {})
    try {
      render(<ShiftGrid schedule={SCHEDULE} />)
      await user.click(await screen.findByRole('button', { name: '全画面' }))
      expect(screen.getByRole('button', { name: '全画面を閉じる' })).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: '印刷' }))

      await waitFor(() => {
        expect(printSpy).toHaveBeenCalledTimes(1)
      })
      expect(screen.getByRole('button', { name: '全画面' })).toHaveAttribute(
        'aria-pressed',
        'false',
      )
    } finally {
      printSpy.mockRestore()
    }
  })
})


// ---------------------------------------------------------------------------
// PARTIAL ステータス: ヘッダ chip + amber バナー + 不足行
// ---------------------------------------------------------------------------

describe('ShiftGrid — PARTIAL status', () => {
  beforeEach(() => {
    mockGetAssignments.mockResolvedValue(makeAssignments())
    mockListWorkPatterns.mockResolvedValue(PATTERNS)
  })

  const PARTIAL_SCHEDULE: Schedule = {
    ...SCHEDULE,
    status: 'PARTIAL',
    shortages: [
      {
        day: 5, pattern_id: 100, pattern_name: 'A1',
        required: 2, assigned: 0, missing: 2,
      },
    ],
    can_finalize: false,
  }

  it('shows the PARTIAL status chip in the title row', async () => {
    render(<ShiftGrid schedule={PARTIAL_SCHEDULE} />)
    expect(await screen.findByText(/部分生成 · 2名不足/)).toBeInTheDocument()
  })

  it('shows the amber banner', async () => {
    render(<ShiftGrid schedule={PARTIAL_SCHEDULE} />)
    expect(
      await screen.findByText(/部分的に作成しました — 2名分のポジションが不足しています/),
    ).toBeInTheDocument()
  })

  it('renders the shortage footer row with clickable badges', async () => {
    render(<ShiftGrid schedule={PARTIAL_SCHEDULE} />)
    // 不足バッジ: A1 + missing count
    const badge = await screen.findByLabelText(
      '5日 A1 ポジション 2名不足',
    )
    expect(badge).toBeInTheDocument()
  })

  it('finalize button is disabled when can_finalize=false', async () => {
    render(<ShiftGrid schedule={PARTIAL_SCHEDULE} />)
    const btn = await screen.findByRole('button', { name: 'シフトを確定' })
    expect(btn).toBeDisabled()
  })

  it('finalize button is enabled when can_finalize=true', async () => {
    render(<ShiftGrid schedule={{ ...PARTIAL_SCHEDULE, can_finalize: true }} />)
    const btn = await screen.findByRole('button', { name: 'シフトを確定' })
    expect(btn).toBeEnabled()
  })

  it('GENERATED status does not show PARTIAL UI', async () => {
    render(<ShiftGrid schedule={SCHEDULE} />)
    await screen.findByText(/2026年4月 稼働表詳細/)
    expect(screen.queryByText(/部分生成/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'シフトを確定' })).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// issue #238: スクロールコンテナ + sticky thead + scroll-padding
// 低縦幅ブラウザでも詳細テーブルを見やすくする。日付ヘッダ追従と Tab 移動時の
// セル可視性を担保する。
// ---------------------------------------------------------------------------

describe('ShiftGrid — scroll container + sticky thead (issue #238)', () => {
  beforeEach(() => {
    mockGetAssignments.mockResolvedValue(makeAssignments())
    mockListWorkPatterns.mockResolvedValue(PATTERNS)
  })

  it('日付ヘッダ <thead> が sticky top-0 を持つ', async () => {
    const { container } = render(<ShiftGrid schedule={SCHEDULE} />)
    await screen.findByText('Alice')
    const thead = container.querySelector('thead')
    expect(thead).toHaveClass('sticky', 'top-0')
  })

  it('スクロールコンテナに scrollPaddingTop: 36px が設定される (Tab 移動時 sticky thead 裏に隠れない)', async () => {
    const { container } = render(<ShiftGrid schedule={SCHEDULE} />)
    await screen.findByText('Alice')
    const scroll = container.querySelector('div.overflow-auto')
    expect(scroll).toHaveStyle({ scrollPaddingTop: '36px' })
  })

  it('通常モードでスクロールコンテナが max-h-[60vh] と min-h-[320px] を持つ', async () => {
    const { container } = render(<ShiftGrid schedule={SCHEDULE} />)
    await screen.findByText('Alice')
    const scroll = container.querySelector('div.overflow-auto')
    expect(scroll).toHaveClass('max-h-[60vh]', 'min-h-[320px]')
  })

  it('全画面モードに切替えるとスクロールコンテナが max-h-[calc(100dvh-180px)] になる', async () => {
    const user = userEvent.setup()
    const { container } = render(<ShiftGrid schedule={SCHEDULE} />)
    await user.click(await screen.findByRole('button', { name: '全画面' }))

    // table を内包する overflow-auto は最後 (root の overflow-auto と区別)
    const scrolls = container.querySelectorAll('div.overflow-auto')
    const tableScroll = scrolls[scrolls.length - 1]
    expect(tableScroll).toHaveClass('max-h-[calc(100dvh-180px)]')
    expect(tableScroll).not.toHaveClass('max-h-[60vh]')
  })
})

// ---------------------------------------------------------------------------
// issue #238: 全画面モード切替 (useModalDismiss 連携)
// 縦幅低ブラウザで詳細テーブルを画面いっぱいに展開する。Esc / 閉じるで戻る。
// body scroll lock + focus return + Esc は useModalDismiss が担保。
// ---------------------------------------------------------------------------

describe('ShiftGrid — 全画面モード (issue #238)', () => {
  beforeEach(() => {
    mockGetAssignments.mockResolvedValue(makeAssignments())
    mockListWorkPatterns.mockResolvedValue(PATTERNS)
  })

  it('「全画面」ボタンが表示される', async () => {
    render(<ShiftGrid schedule={SCHEDULE} />)
    expect(await screen.findByRole('button', { name: '全画面' })).toBeInTheDocument()
  })

  it('aria-pressed がトグル状態を反映する', async () => {
    const user = userEvent.setup()
    render(<ShiftGrid schedule={SCHEDULE} />)
    const btn = await screen.findByRole('button', { name: '全画面' })
    expect(btn).toHaveAttribute('aria-pressed', 'false')

    await user.click(btn)
    const closeBtn = await screen.findByRole('button', { name: '全画面を閉じる' })
    expect(closeBtn).toHaveAttribute('aria-pressed', 'true')
  })

  it('クリックでオーバーレイ div が fixed inset-0 z-40 + data-confirm-modal-dismiss を持つ', async () => {
    const user = userEvent.setup()
    const { container } = render(<ShiftGrid schedule={SCHEDULE} />)
    const btn = await screen.findByRole('button', { name: '全画面' })

    await user.click(btn)
    const overlay = container.querySelector('[data-confirm-modal-dismiss="true"]')
    expect(overlay).not.toBeNull()
    expect(overlay).toHaveClass('fixed', 'inset-0', 'z-40')
  })

  it('Esc キーで閉じる (useModalDismiss 経由)', async () => {
    const user = userEvent.setup()
    render(<ShiftGrid schedule={SCHEDULE} />)
    const btn = await screen.findByRole('button', { name: '全画面' })

    await user.click(btn)
    expect(screen.getByRole('button', { name: '全画面を閉じる' })).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '全画面' })).toHaveAttribute(
        'aria-pressed',
        'false',
      )
    })
  })

  it('schedule 切替で loading に戻ると全画面が自動解除される (ゴースト UI 防止)', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<ShiftGrid schedule={SCHEDULE} />)

    // 1. 通常 schedule で全画面化
    await user.click(await screen.findByRole('button', { name: '全画面' }))
    expect(screen.getByRole('button', { name: '全画面を閉じる' })).toBeInTheDocument()

    // 2. 別 schedule に切替 → loading 入る (useEffect で setFullscreen(false))
    mockGetAssignments.mockReturnValue(new Promise(() => {})) // never resolves
    rerender(<ShiftGrid schedule={{ ...SCHEDULE, id: 999 }} />)
    await screen.findByText('読み込み中...')

    // 3. データ resolve させて完成版に復帰
    mockGetAssignments.mockResolvedValue(makeAssignments())
    rerender(<ShiftGrid schedule={{ ...SCHEDULE, id: 1000 }} />)
    const reopenBtn = await screen.findByRole('button', { name: '全画面' })
    expect(reopenBtn).toHaveAttribute('aria-pressed', 'false')
  })
})
