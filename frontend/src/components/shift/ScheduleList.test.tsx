import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import ScheduleList from './ScheduleList'
import {
  deleteSchedule,
  exportScheduleCsvLong,
  exportScheduleXlsx,
} from '../../api/schedules'
import type { Schedule } from '../../types/api'

vi.mock('../../api/schedules', () => ({
  deleteSchedule: vi.fn(),
  exportScheduleXlsx: vi.fn(),
  exportScheduleCsvLong: vi.fn(),
}))

const mockDelete = vi.mocked(deleteSchedule)
const mockXlsx = vi.mocked(exportScheduleXlsx)
const mockCsv = vi.mocked(exportScheduleCsvLong)

let onSelect: ReturnType<typeof vi.fn>
let onDeleted: ReturnType<typeof vi.fn>

const SCHEDULES: Schedule[] = [
  {
    id: 1, department_id: 1, year: 2026, month: 4, status: 'GENERATED',
    generation_attempt: 1, is_active: true, diagnosis: null,
    created_at: '2026-04-01T09:00:00Z', started_at: '2026-04-01T09:00:00Z',
    finished_at: '2026-04-01T09:00:30Z', time_limit: 120,
  },
  {
    id: 2, department_id: 1, year: 2026, month: 4, status: 'GENERATING',
    generation_attempt: 2, is_active: false, diagnosis: null,
    created_at: '2026-04-01T10:00:00Z', started_at: '2026-04-01T10:00:00Z',
    finished_at: null, time_limit: 120,
  },
  {
    id: 3, department_id: 1, year: 2026, month: 3, status: 'DRAFT',
    generation_attempt: 1, is_active: false, diagnosis: 'INFEASIBLE: 制約違反',
    created_at: '2026-03-01T09:00:00Z', started_at: '2026-03-01T09:00:00Z',
    finished_at: '2026-03-01T09:00:10Z', time_limit: 120,
  },
]

beforeEach(() => {
  onSelect = vi.fn()
  onDeleted = vi.fn()
  mockDelete.mockReset()
  mockXlsx.mockReset()
  mockCsv.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('ScheduleList', () => {
  it('renders empty state when there are no schedules', () => {
    render(
      <ScheduleList schedules={[]} selectedId={null} onSelect={onSelect} onDeleted={onDeleted} />,
    )

    expect(screen.getByText('まだ稼働表が生成されていません')).toBeInTheDocument()
  })

  it('renders one row per schedule with status badge', () => {
    render(
      <ScheduleList schedules={SCHEDULES} selectedId={null} onSelect={onSelect} onDeleted={onDeleted} />,
    )

    expect(screen.getByText('生成済')).toBeInTheDocument()
    expect(screen.getByText('生成中')).toBeInTheDocument()
    expect(screen.getByText('処理待ち')).toBeInTheDocument()
    expect(screen.getByText(/INFEASIBLE: 制約違反/)).toBeInTheDocument()
  })

  it('clicking a GENERATED row calls onSelect; non-GENERATED rows do not', async () => {
    const user = userEvent.setup()
    render(
      <ScheduleList schedules={SCHEDULES} selectedId={null} onSelect={onSelect} onDeleted={onDeleted} />,
    )

    // 各行はステータスバッジを持つので、それを起点に row を取得
    const generatedRow = screen.getByText('生成済').closest('div.flex')!
    await user.click(generatedRow)
    expect(onSelect).toHaveBeenCalledWith(SCHEDULES[0])

    onSelect.mockClear()
    const generatingRow = screen.getByText('生成中').closest('div.flex')!
    await user.click(generatingRow)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('renders Excel/CSV/削除 buttons only for GENERATED rows', () => {
    render(
      <ScheduleList schedules={SCHEDULES} selectedId={null} onSelect={onSelect} onDeleted={onDeleted} />,
    )

    // GENERATED 行 1 つ → Excel/CSV ボタン各 1 個
    expect(screen.getAllByRole('button', { name: 'Excel' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'CSV' })).toHaveLength(1)
    // 削除 ボタンは全行に出る
    expect(screen.getAllByRole('button', { name: '削除' })).toHaveLength(3)
  })

  it('Excel button triggers exportScheduleXlsx and stops propagation', async () => {
    const user = userEvent.setup()
    render(
      <ScheduleList schedules={SCHEDULES} selectedId={null} onSelect={onSelect} onDeleted={onDeleted} />,
    )

    await user.click(screen.getByRole('button', { name: 'Excel' }))

    expect(mockXlsx).toHaveBeenCalledWith(1, 2026, 4, 1)
    expect(onSelect).not.toHaveBeenCalled() // stopPropagation effect
  })

  it('CSV button triggers exportScheduleCsvLong', async () => {
    const user = userEvent.setup()
    render(
      <ScheduleList schedules={SCHEDULES} selectedId={null} onSelect={onSelect} onDeleted={onDeleted} />,
    )

    await user.click(screen.getByRole('button', { name: 'CSV' }))

    expect(mockCsv).toHaveBeenCalledWith(1, 2026, 4, 1)
  })

  it('Delete button opens ConfirmDialog then calls deleteSchedule and onDeleted', async () => {
    mockDelete.mockResolvedValueOnce(undefined)
    const user = userEvent.setup()
    render(
      <ScheduleList schedules={SCHEDULES} selectedId={null} onSelect={onSelect} onDeleted={onDeleted} />,
    )

    await user.click(screen.getAllByRole('button', { name: '削除' })[0])

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText(/2026年4月 第1回 を削除しますか？/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '削除する' }))

    expect(mockDelete).toHaveBeenCalledWith(1)
    expect(onDeleted).toHaveBeenCalledWith(1)
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
  })

  it('Delete cancellation aborts the API call', async () => {
    const user = userEvent.setup()
    render(
      <ScheduleList schedules={SCHEDULES} selectedId={null} onSelect={onSelect} onDeleted={onDeleted} />,
    )

    await user.click(screen.getAllByRole('button', { name: '削除' })[0])
    expect(await screen.findByRole('dialog')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'キャンセル' }))

    expect(mockDelete).not.toHaveBeenCalled()
    expect(onDeleted).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('selected row gets highlight class', () => {
    render(
      <ScheduleList schedules={SCHEDULES} selectedId={1} onSelect={onSelect} onDeleted={onDeleted} />,
    )

    const row = screen.getByText('生成済').closest('div.flex')!
    expect(row.className).toContain('bg-brand-50')
  })

  it('does not render any duration label (history rows show only created_at + diagnosis)', () => {
    render(
      <ScheduleList schedules={SCHEDULES} selectedId={null} onSelect={onSelect} onDeleted={onDeleted} />,
    )

    expect(screen.queryByText(/所要 /)).not.toBeInTheDocument()
    expect(screen.queryByText(/失敗 \(/)).not.toBeInTheDocument()
    expect(screen.queryByText(/計算中…/)).not.toBeInTheDocument()
  })
})
