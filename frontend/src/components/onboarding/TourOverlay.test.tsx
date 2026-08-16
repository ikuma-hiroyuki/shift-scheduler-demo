import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import TourOverlay from './TourOverlay'
import { useOnboardingStore } from '../../stores/onboarding'
import type { TourStep } from './tourSteps'

// 本物の TOUR_STEPS（コピー文言）と切り離して、ナビゲーション/スキップ挙動だけを検証する。
const MOCK_STEPS: TourStep[] = [
  { title: '導入ステップ', body: '導入の説明文' },
  { target: '[data-testid="target-a"]', title: '対象Aのステップ', body: 'Aの説明文' },
  { target: '[data-testid="missing"]', title: '欠けている対象', body: '見つからない説明文' },
  { title: '最終ステップ', body: '締めの説明文' },
]

vi.mock('./tourSteps', () => ({
  get TOUR_STEPS() {
    return MOCK_STEPS
  },
}))

function resetStore() {
  useOnboardingStore.setState({ active: false, stepIndex: 0, hasSeenTour: false })
}

beforeEach(() => {
  localStorage.clear()
  resetStore()
})

afterEach(() => {
  localStorage.clear()
  resetStore()
})

describe('TourOverlay', () => {
  it('renders nothing when the tour is inactive', () => {
    render(
      <>
        <div data-testid="target-a">target</div>
        <TourOverlay />
      </>,
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows the first (centered) step immediately when started', async () => {
    render(<TourOverlay />)
    useOnboardingStore.getState().start()

    await waitFor(() => expect(screen.getByText('導入ステップ')).toBeInTheDocument())
    expect(screen.getByText('導入の説明文')).toBeInTheDocument()
    expect(screen.getByText('Tour 1 / 4')).toBeInTheDocument()
    // 最初のステップに「戻る」は無い
    expect(screen.queryByRole('button', { name: '戻る' })).not.toBeInTheDocument()
  })

  it('advances to a step whose target exists in the DOM', async () => {
    render(
      <>
        <div data-testid="target-a">target</div>
        <TourOverlay />
      </>,
    )
    useOnboardingStore.getState().start()
    await waitFor(() => expect(screen.getByText('導入ステップ')).toBeInTheDocument())

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '次へ' }))

    await waitFor(() => expect(screen.getByText('対象Aのステップ')).toBeInTheDocument())
    expect(screen.getByText('Tour 2 / 4')).toBeInTheDocument()
  })

  it('skips a step whose target is missing from the DOM and lands on the next visible step', async () => {
    render(
      <>
        <div data-testid="target-a">target</div>
        <TourOverlay />
        {/* data-testid="missing" は意図的にレンダリングしない */}
      </>,
    )
    useOnboardingStore.getState().start()
    useOnboardingStore.setState({ stepIndex: 1 })
    await waitFor(() => expect(screen.getByText('対象Aのステップ')).toBeInTheDocument())

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '次へ' }))

    // ステップ3（欠けている対象）は自動スキップされ、最終ステップが表示される
    // (リトライ探索に最大 1s かかるため timeout を伸ばす)
    await waitFor(
      () => expect(screen.getByText('最終ステップ')).toBeInTheDocument(),
      { timeout: 3000 },
    )
    expect(screen.getByText('Tour 4 / 4')).toBeInTheDocument()
  }, 5000)

  it('going back from step 2 returns to step 1', async () => {
    render(
      <>
        <div data-testid="target-a">target</div>
        <TourOverlay />
      </>,
    )
    useOnboardingStore.getState().start()
    useOnboardingStore.setState({ stepIndex: 1 })
    await waitFor(() => expect(screen.getByText('対象Aのステップ')).toBeInTheDocument())

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '戻る' }))

    await waitFor(() => expect(screen.getByText('導入ステップ')).toBeInTheDocument())
  })

  it('skip button closes the tour and marks it as seen', async () => {
    localStorage.setItem('current_user_id', 'user-1')
    render(<TourOverlay />)
    useOnboardingStore.getState().start()
    await waitFor(() => expect(screen.getByText('導入ステップ')).toBeInTheDocument())

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'スキップ' }))

    expect(useOnboardingStore.getState().active).toBe(false)
    expect(localStorage.getItem('onboarding_tour_seen:user-1')).toBe('1')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('closes automatically once the step index runs past the last step', async () => {
    render(<TourOverlay />)
    useOnboardingStore.getState().start()
    await waitFor(() => expect(screen.getByText('導入ステップ')).toBeInTheDocument())

    useOnboardingStore.setState({ stepIndex: MOCK_STEPS.length })
    await waitFor(() => expect(useOnboardingStore.getState().active).toBe(false))
  })

  it('Escape key closes the tour', async () => {
    render(<TourOverlay />)
    useOnboardingStore.getState().start()
    await waitFor(() => expect(screen.getByText('導入ステップ')).toBeInTheDocument())

    const user = userEvent.setup()
    await user.keyboard('{Escape}')

    expect(useOnboardingStore.getState().active).toBe(false)
  })

  // Regression: 本文が長いステップ（例: シフト自動生成の案内）で、固定の
  // "window.innerHeight - 220" 想定が実際のツールチップ高さ（256px超）より
  // 小さく、ボタン行が画面下端からはみ出て見えなくなっていた。
  // Found by user report + /qa reproduction on 2026-08-16 at 1280x800（本番）。
  it('keeps the tooltip fully within the viewport when the target sits near the bottom and the body is tall', async () => {
    const originalInnerHeight = window.innerHeight
    const originalInnerWidth = window.innerWidth
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 })

    const originalGetBCR = HTMLElement.prototype.getBoundingClientRect
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      if (this.dataset.testid === 'target-a') {
        return {
          top: 580, left: 700, right: 1000, bottom: 620, width: 300, height: 40,
          x: 700, y: 580, toJSON() {},
        } as DOMRect
      }
      if (this.getAttribute('role') === 'dialog') {
        // 実測で確認した「シフトを自動生成する」ステップの実際の高さ（256.75px）相当
        return {
          top: 0, left: 0, right: 320, bottom: 260, width: 320, height: 260,
          x: 0, y: 0, toJSON() {},
        } as DOMRect
      }
      return originalGetBCR.call(this)
    }

    try {
      render(
        <>
          <div data-testid="target-a">target</div>
          <TourOverlay />
        </>,
      )
      useOnboardingStore.getState().start()
      useOnboardingStore.setState({ stepIndex: 1 })
      await waitFor(() => expect(screen.getByText('対象Aのステップ')).toBeInTheDocument())

      const dialog = screen.getByRole('dialog')
      await waitFor(() => {
        const top = parseFloat(dialog.style.top)
        expect(top + 260).toBeLessThanOrEqual(800)
      })
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalGetBCR
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalInnerHeight })
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth })
    }
  })
})
