import { create } from 'zustand'

// オンボーディングツアーを見たかどうかはユーザーごとに localStorage で永続化する
// （sidebarPattern / theme ストアと同じ current_user_id プレフィックス方式）。
const STORAGE_PREFIX = 'onboarding_tour_seen:'

function storageKey(): string {
  const uid = localStorage.getItem('current_user_id') || 'guest'
  return `${STORAGE_PREFIX}${uid}`
}

function loadSeen(): boolean {
  try {
    return localStorage.getItem(storageKey()) === '1'
  } catch {
    return false
  }
}

function saveSeen() {
  try {
    localStorage.setItem(storageKey(), '1')
  } catch {
    /* ignore */
  }
}

interface OnboardingState {
  active: boolean
  stepIndex: number
  hasSeenTour: boolean
  start: () => void
  next: () => void
  prev: () => void
  close: () => void
  /** ログイン直後などユーザーが切り替わったタイミングで呼ぶ */
  reload: () => void
}

export const useOnboardingStore = create<OnboardingState>()((set, get) => ({
  active: false,
  stepIndex: 0,
  hasSeenTour: loadSeen(),
  start: () => set({ active: true, stepIndex: 0 }),
  next: () => set({ stepIndex: get().stepIndex + 1 }),
  prev: () => set({ stepIndex: Math.max(0, get().stepIndex - 1) }),
  close: () => {
    saveSeen()
    set({ active: false, hasSeenTour: true })
  },
  reload: () => set({ hasSeenTour: loadSeen() }),
}))
