import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useOnboardingStore } from './onboarding'

beforeEach(() => {
  localStorage.clear()
  useOnboardingStore.setState({ active: false, stepIndex: 0, hasSeenTour: false })
})

afterEach(() => {
  localStorage.clear()
})

describe('useOnboardingStore', () => {
  it('defaults to inactive, step 0, not seen', () => {
    const s = useOnboardingStore.getState()
    expect(s.active).toBe(false)
    expect(s.stepIndex).toBe(0)
    expect(s.hasSeenTour).toBe(false)
  })

  it('start() activates the tour at step 0', () => {
    useOnboardingStore.setState({ stepIndex: 3 })
    useOnboardingStore.getState().start()
    expect(useOnboardingStore.getState().active).toBe(true)
    expect(useOnboardingStore.getState().stepIndex).toBe(0)
  })

  it('next()/prev() move the step index and prev() never goes below 0', () => {
    useOnboardingStore.getState().start()
    useOnboardingStore.getState().next()
    useOnboardingStore.getState().next()
    expect(useOnboardingStore.getState().stepIndex).toBe(2)

    useOnboardingStore.getState().prev()
    expect(useOnboardingStore.getState().stepIndex).toBe(1)

    useOnboardingStore.getState().prev()
    useOnboardingStore.getState().prev()
    expect(useOnboardingStore.getState().stepIndex).toBe(0)
  })

  it('close() deactivates and persists "seen" per-user to localStorage', () => {
    localStorage.setItem('current_user_id', 'user-1')
    useOnboardingStore.getState().start()
    useOnboardingStore.getState().close()

    expect(useOnboardingStore.getState().active).toBe(false)
    expect(useOnboardingStore.getState().hasSeenTour).toBe(true)
    expect(localStorage.getItem('onboarding_tour_seen:user-1')).toBe('1')
  })

  it('close() falls back to the "guest" key when no current_user_id is set', () => {
    useOnboardingStore.getState().close()
    expect(localStorage.getItem('onboarding_tour_seen:guest')).toBe('1')
  })

  it('reload() picks up a previously-persisted "seen" flag for the current user', () => {
    localStorage.setItem('current_user_id', 'user-2')
    localStorage.setItem('onboarding_tour_seen:user-2', '1')

    useOnboardingStore.getState().reload()
    expect(useOnboardingStore.getState().hasSeenTour).toBe(true)
  })

  it('reload() reports unseen when nothing is persisted for the current user', () => {
    localStorage.setItem('current_user_id', 'user-3')
    useOnboardingStore.getState().reload()
    expect(useOnboardingStore.getState().hasSeenTour).toBe(false)
  })
})
