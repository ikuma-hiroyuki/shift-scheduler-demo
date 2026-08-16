import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'

import GenerationProgress from './GenerationProgress'
import { cancelSchedule, getSchedule } from '../../api/schedules'
import type { Schedule } from '../../types/api'

vi.mock('../../api/schedules', () => ({
  getSchedule: vi.fn(),
  cancelSchedule: vi.fn(),
}))

const mockGet = vi.mocked(getSchedule)
const mockCancel = vi.mocked(cancelSchedule)

function makeSchedule(over: Partial<Schedule> = {}): Schedule {
  return {
    id: 1, department_id: 1, year: 2026, month: 4, status: 'GENERATING',
    generation_attempt: 1, is_active: false, diagnosis: null,
    created_at: '', started_at: '2026-04-01T00:00:00Z',
    finished_at: null,
    time_limit: 60,
    ...over,
  }
}

let onDone: ReturnType<typeof vi.fn>

beforeEach(() => {
  onDone = vi.fn()
  mockGet.mockReset()
  mockCancel.mockReset()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-04-01T00:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('GenerationProgress', () => {
  it('shows generating spinner and label initially', () => {
    render(<GenerationProgress scheduleId={1} onDone={onDone} />)

    expect(screen.getByText(/稼働表を計算中/)).toBeInTheDocument()
  })

  it('uses initialSchedule.status when provided (no flicker on mount)', () => {
    render(
      <GenerationProgress
        scheduleId={1}
        onDone={onDone}
        initialSchedule={makeSchedule({ status: 'GENERATED', finished_at: '2026-04-01T00:00:30Z' })}
      />,
    )

    expect(screen.getByText(/生成完了/)).toBeInTheDocument()
  })

  it('polls getSchedule and calls onDone after 1.5s when status changes to GENERATED', async () => {
    mockGet.mockResolvedValueOnce(makeSchedule({
      status: 'GENERATED',
      finished_at: '2026-04-01T00:00:30Z',
    }))

    render(<GenerationProgress scheduleId={1} onDone={onDone} />)

    // 最初のポーリングまで 3000ms
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })

    // mockGet が呼ばれた後、1500ms 経過で onDone
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })

    expect(mockGet).toHaveBeenCalledWith(1)
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(onDone.mock.calls[0][0].status).toBe('GENERATED')
  })

  it('continues polling on network error', async () => {
    mockGet.mockRejectedValue(new Error('network'))
    render(<GenerationProgress scheduleId={1} onDone={onDone} />)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000) // 2 cycles
    })

    expect(mockGet.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(onDone).not.toHaveBeenCalled()
  })

  it('shows warning message when status is not GENERATED but not generating', () => {
    render(
      <GenerationProgress
        scheduleId={1}
        onDone={onDone}
        initialSchedule={makeSchedule({ status: 'PUBLISHED' })}
      />,
    )

    // not GENERATING/DRAFT/GENERATED/INFEASIBLE → 警告文表示
    expect(
      screen.getByText(/解が見つからなかった可能性があります/),
    ).toBeInTheDocument()
  })

  it('stops polling and calls onDone when status changes to INFEASIBLE', async () => {
    mockGet.mockResolvedValueOnce(
      makeSchedule({
        status: 'INFEASIBLE',
        diagnosis: '【不足日サマリ】\n10日(土): 必要枠8名 > 利用可能7名 (希望休7名)\n\n【原因の可能性】\n有給・希望休',
        finished_at: '2026-04-01T00:00:30Z',
      }),
    )

    render(<GenerationProgress scheduleId={1} onDone={onDone} />)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })

    expect(mockGet).toHaveBeenCalledWith(1)
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(onDone.mock.calls[0][0].status).toBe('INFEASIBLE')
  })

  it('renders INFEASIBLE label and diagnosis text', () => {
    render(
      <GenerationProgress
        scheduleId={1}
        onDone={onDone}
        initialSchedule={makeSchedule({
          status: 'INFEASIBLE',
          diagnosis: '【不足日サマリ】\n10日(土): 必要枠8名 > 利用可能7名 (希望休7名)\n\n【原因の可能性】\n有給・希望休',
          finished_at: '2026-04-01T00:00:30Z',
        })}
      />,
    )

    expect(screen.getByText('稼働表作成失敗')).toBeInTheDocument()
    expect(
      screen.getByText(/条件を満たすシフトが見つかりませんでした/),
    ).toBeInTheDocument()
    expect(screen.getByText(/【不足日サマリ】/)).toBeInTheDocument()
    expect(screen.getByText(/10日\(土\): 必要枠8名 > 利用可能7名 \(希望休7名\)/))
      .toBeInTheDocument()
    expect(screen.getByText(/【原因の可能性】/)).toBeInTheDocument()
    expect(screen.getByText(/有給・希望休/)).toBeInTheDocument()
  })

  it('progress bar width tracks elapsed / time_limit from initialSchedule', async () => {
    render(
      <GenerationProgress
        scheduleId={1}
        onDone={onDone}
        initialSchedule={makeSchedule({ time_limit: 60 })}
      />,
    )

    // 30s 経過 → ratio 0.5 → 50%
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })

    const bar = screen.getByTestId('generation-progress-bar')
    expect(bar.style.width).toBe('50%')
    expect(bar.className).not.toContain('animate-pulse')
  })

  it('switches to "最終調整中" + pulse when elapsed exceeds time_limit', async () => {
    render(
      <GenerationProgress
        scheduleId={1}
        onDone={onDone}
        initialSchedule={makeSchedule({ time_limit: 5 })}
      />,
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000)
    })

    expect(screen.getByText(/最終調整中/)).toBeInTheDocument()
    const bar = screen.getByTestId('generation-progress-bar')
    expect(bar.style.width).toBe('100%')
    expect(bar.className).toContain('animate-pulse')
  })

  it('renders indeterminate pulse bar (no hard-coded fallback) when time_limit is unknown', () => {
    // initialSchedule 無し + ポーリング前 → time_limit を知る術が無い。
    // 旧実装は 120 秒で割って progress を出していたが、今は backend 値が来るまで indeterminate。
    render(<GenerationProgress scheduleId={1} onDone={onDone} />)

    const bar = screen.getByTestId('generation-progress-bar')
    expect(bar.className).toContain('animate-pulse')
    expect(bar.style.width).toBe('100%')
  })

  // ---- 停止ボタン (issue #177) ----

  it('停止ボタン押下で cancelSchedule が呼ばれ、CANCELLED で onDone が通知される', async () => {
    mockCancel.mockResolvedValueOnce(
      makeSchedule({ status: 'CANCELLED', finished_at: '2026-04-01T00:00:10Z' }),
    )

    render(<GenerationProgress scheduleId={42} onDone={onDone} />)

    const btn = screen.getByTestId('cancel-generation-btn')
    expect(btn).toBeInTheDocument()
    expect(btn.textContent).toContain('停止')

    await act(async () => {
      btn.click()
    })

    expect(mockCancel).toHaveBeenCalledWith(42)

    // 1 秒のディレイ後に onDone(CANCELLED) が発火
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })

    expect(onDone).toHaveBeenCalledTimes(1)
    expect(onDone.mock.calls[0][0].status).toBe('CANCELLED')
  })

  it('CANCELLED ラベルが表示される', () => {
    render(
      <GenerationProgress
        scheduleId={1}
        onDone={onDone}
        initialSchedule={makeSchedule({ status: 'CANCELLED', finished_at: '2026-04-01T00:00:10Z' })}
      />,
    )

    // ラベルとサブ文言の両方が表示されること
    expect(screen.getByText('稼働表作成を停止しました')).toBeInTheDocument()
    expect(
      screen.getByText(/ユーザー操作により稼働表作成を停止しました/),
    ).toBeInTheDocument()
  })

  it('cancelSchedule 失敗時はエラー文言を表示する', async () => {
    mockCancel.mockRejectedValueOnce(new Error('boom'))

    render(<GenerationProgress scheduleId={1} onDone={onDone} />)

    await act(async () => {
      screen.getByTestId('cancel-generation-btn').click()
    })

    expect(
      screen.getByText(/停止要求の送信に失敗しました/),
    ).toBeInTheDocument()
    expect(onDone).not.toHaveBeenCalled()
  })

  // issue #196: polling robustness
  it('stops polling and notifies onDone on 404 (schedule deleted)', async () => {
    const notFound = Object.assign(new Error('not found'), {
      response: { status: 404 },
    })
    mockGet.mockRejectedValue(notFound)

    render(<GenerationProgress scheduleId={42} onDone={onDone} />)

    // 1 度目の poll で 404 → panel に削除メッセージ
    await act(async () => {
      vi.advanceTimersByTime(3000)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.getByText(/対象の稼働表が見つかりません/)).toBeInTheDocument()

    // 1.5 秒後に onDone が CANCELLED として呼ばれる
    await act(async () => {
      vi.advanceTimersByTime(2000)
    })
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(onDone.mock.calls[0][0].status).toBe('CANCELLED')

    // 以降の tick で再度 onDone が呼ばれない (poll が止まっている)
    await act(async () => {
      vi.advanceTimersByTime(10000)
    })
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('shows pollError after consecutive failures and stops polling (issue #196)', async () => {
    mockGet.mockRejectedValue(
      Object.assign(new Error('boom'), { response: { status: 500 } }),
    )

    render(<GenerationProgress scheduleId={1} onDone={onDone} />)

    // 5 回連続失敗で諦める
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        vi.advanceTimersByTime(3000)
        await Promise.resolve()
        await Promise.resolve()
      })
    }

    expect(screen.getByText(/サーバから応答がありません/)).toBeInTheDocument()

    // 以降は poll 走らない
    const callsAfterStop = mockGet.mock.calls.length
    await act(async () => {
      vi.advanceTimersByTime(15000)
    })
    expect(mockGet.mock.calls.length).toBe(callsAfterStop)
  })

  it('resets the consecutive error counter on a successful poll', async () => {
    // 4 回失敗 → 1 回成功 → 4 回失敗 = まだ pollError 出さない
    mockGet
      .mockRejectedValueOnce(
        Object.assign(new Error('e1'), { response: { status: 500 } }),
      )
      .mockRejectedValueOnce(
        Object.assign(new Error('e2'), { response: { status: 500 } }),
      )
      .mockRejectedValueOnce(
        Object.assign(new Error('e3'), { response: { status: 500 } }),
      )
      .mockRejectedValueOnce(
        Object.assign(new Error('e4'), { response: { status: 500 } }),
      )
      .mockResolvedValueOnce(makeSchedule({ status: 'GENERATING' }))
      .mockRejectedValueOnce(
        Object.assign(new Error('e5'), { response: { status: 500 } }),
      )

    render(<GenerationProgress scheduleId={1} onDone={onDone} />)

    for (let i = 0; i < 6; i++) {
      await act(async () => {
        vi.advanceTimersByTime(3000)
        await Promise.resolve()
        await Promise.resolve()
      })
    }

    expect(screen.queryByText(/サーバから応答がありません/)).not.toBeInTheDocument()
  })
})
