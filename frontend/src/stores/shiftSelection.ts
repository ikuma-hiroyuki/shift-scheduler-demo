import { create } from 'zustand'

/**
 * 稼働表作成ページの対象 (年・月) 選択を保持する store。
 *
 * year/month を component-local state に持つと、別画面へ遷移して戻った際の
 * 再マウントで翌月デフォルトにリセットされ、5 月で作成したのに戻ると 6 月
 * 表示になる、という問題が起きる。SPA ナビゲーションをまたいで選択を保つため
 * module レベルの store に持たせる。
 *
 * 初期値はシフト運用に合わせ翌月 (v0.5.2)。store は in-memory なので、
 * フルリロード時は module 再評価で再び翌月デフォルトに戻る。
 */
const NOW = new Date()
const DEFAULT_TARGET = new Date(NOW.getFullYear(), NOW.getMonth() + 1, 1)

interface ShiftSelectionState {
  year: number
  month: number
  setYear: (year: number) => void
  setMonth: (month: number) => void
}

export const useShiftSelectionStore = create<ShiftSelectionState>()((set) => ({
  year: DEFAULT_TARGET.getFullYear(),
  month: DEFAULT_TARGET.getMonth() + 1,
  setYear: (year) => set({ year }),
  setMonth: (month) => set({ month }),
}))
