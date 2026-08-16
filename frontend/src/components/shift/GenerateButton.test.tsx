import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import GenerateButton from './GenerateButton'
import { generateSchedule } from '../../api/schedules'
import type { Schedule } from '../../types/api'

vi.mock('../../api/schedules', () => ({
  generateSchedule: vi.fn(),
}))

const mockGenerate = vi.mocked(generateSchedule)

const SCHEDULE: Schedule = {
  id: 7,
  department_id: 1,
  year: 2026,
  month: 4,
  status: 'GENERATING',
  generation_attempt: 1,
  is_active: false,
  diagnosis: null,
  created_at: '',
  started_at: null,
  finished_at: null,
  time_limit: 120,
}

let onGenerated: ReturnType<typeof vi.fn>

beforeEach(() => {
  onGenerated = vi.fn()
  mockGenerate.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('GenerateButton', () => {
  it('renders the year/month label and is enabled when not loading and not externally disabled', () => {
    render(
      <GenerateButton
        departmentId={1} year={2026} month={4} disabled={false} onGenerated={onGenerated}
      />,
    )

    const btn = screen.getByRole('button', { name: '稼働表自動作成 2026年4月' })
    expect(btn).toBeEnabled()
  })

  it('calls generateSchedule on click and forwards the resulting Schedule', async () => {
    mockGenerate.mockResolvedValueOnce(SCHEDULE)
    const user = userEvent.setup()
    render(
      <GenerateButton
        departmentId={1} year={2026} month={4} disabled={false} onGenerated={onGenerated}
      />,
    )

    await user.click(screen.getByRole('button', { name: '稼働表自動作成 2026年4月' }))

    await waitFor(() => expect(mockGenerate).toHaveBeenCalledWith(1, 2026, 4))
    expect(onGenerated).toHaveBeenCalledWith(SCHEDULE)
  })

  it('disables and shows "生成中..." when disabled prop is true', () => {
    render(
      <GenerateButton
        departmentId={1} year={2026} month={4} disabled={true} onGenerated={onGenerated}
      />,
    )

    const btn = screen.getByRole('button', { name: '生成中...' })
    expect(btn).toBeDisabled()
  })

  it('shows server detail message on API error', async () => {
    mockGenerate.mockRejectedValueOnce({
      response: { data: { detail: '部門に従業員が登録されていません' } },
    })
    const user = userEvent.setup()
    render(
      <GenerateButton
        departmentId={1} year={2026} month={4} disabled={false} onGenerated={onGenerated}
      />,
    )

    await user.click(screen.getByRole('button', { name: '稼働表自動作成 2026年4月' }))

    expect(
      await screen.findByText('部門に従業員が登録されていません'),
    ).toBeInTheDocument()
  })

  it('falls back to generic message on opaque error', async () => {
    mockGenerate.mockRejectedValueOnce(new Error('boom'))
    const user = userEvent.setup()
    render(
      <GenerateButton
        departmentId={1} year={2026} month={4} disabled={false} onGenerated={onGenerated}
      />,
    )

    await user.click(screen.getByRole('button', { name: '稼働表自動作成 2026年4月' }))

    expect(await screen.findByText('稼働表生成の開始に失敗しました')).toBeInTheDocument()
  })
})
