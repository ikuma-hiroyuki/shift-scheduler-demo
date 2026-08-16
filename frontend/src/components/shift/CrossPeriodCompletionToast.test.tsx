import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import CrossPeriodCompletionToast from './CrossPeriodCompletionToast'
import type { Schedule } from '../../types/api'

function makeSchedule(overrides: Partial<Schedule> = {}): Schedule {
  return {
    id: 1,
    department_id: 1,
    year: 2026,
    month: 6,
    status: 'INFEASIBLE',
    generation_attempt: 1,
    is_active: false,
    diagnosis: 'H3 違反: 連続勤務上限を超えています',
    created_at: '2026-05-07T00:00:00Z',
    started_at: '2026-05-07T00:00:00Z',
    finished_at: '2026-05-07T00:00:30Z',
    time_limit: 120,
    ...overrides,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('CrossPeriodCompletionToast', () => {
  it('renders the failure headline + diagnosis when status is INFEASIBLE', () => {
    render(
      <CrossPeriodCompletionToast
        schedule={makeSchedule()}
        onJump={() => {}}
        onDismiss={() => {}}
      />,
    )
    expect(screen.getByText('Generation Failed')).toBeInTheDocument()
    expect(screen.getByText('2026年6月の生成が失敗しました')).toBeInTheDocument()
    expect(screen.getByText(/H3 違反/)).toBeInTheDocument()
  })

  it('renders the success headline (no diagnosis row) when status is GENERATED', () => {
    render(
      <CrossPeriodCompletionToast
        schedule={makeSchedule({ status: 'GENERATED', diagnosis: null })}
        onJump={() => {}}
        onDismiss={() => {}}
      />,
    )
    expect(screen.getByText('Generation Completed')).toBeInTheDocument()
    expect(screen.getByText('2026年6月の生成が完了しました')).toBeInTheDocument()
    expect(screen.queryByText(/H3/)).not.toBeInTheDocument()
  })

  it('fires onJump when the jump button is clicked', () => {
    const onJump = vi.fn()
    render(
      <CrossPeriodCompletionToast
        schedule={makeSchedule()}
        onJump={onJump}
        onDismiss={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '該当期間にジャンプ' }))
    expect(onJump).toHaveBeenCalledTimes(1)
  })

  it('fires onDismiss when the close button is clicked', () => {
    const onDismiss = vi.fn()
    render(
      <CrossPeriodCompletionToast
        schedule={makeSchedule()}
        onJump={() => {}}
        onDismiss={onDismiss}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('auto-dismisses after 8 seconds', () => {
    const onDismiss = vi.fn()
    render(
      <CrossPeriodCompletionToast
        schedule={makeSchedule()}
        onJump={() => {}}
        onDismiss={onDismiss}
      />,
    )
    expect(onDismiss).not.toHaveBeenCalled()
    vi.advanceTimersByTime(7999)
    expect(onDismiss).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('clears the auto-dismiss timer on unmount', () => {
    const onDismiss = vi.fn()
    const { unmount } = render(
      <CrossPeriodCompletionToast
        schedule={makeSchedule()}
        onJump={() => {}}
        onDismiss={onDismiss}
      />,
    )
    unmount()
    vi.advanceTimersByTime(10000)
    expect(onDismiss).not.toHaveBeenCalled()
  })
})
