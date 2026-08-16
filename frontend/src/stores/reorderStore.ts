/**
 * 並び替えモード用の汎用 Zustand store ファクトリ。
 *
 * `/employees`, `/work-patterns` の各リスト用に独立した store を作る。
 * - mode: 'view' | 'reorder'
 * - originalOrder: enter 時のスナップショット (キャンセル時の復元元)
 * - draftOrder: ドラッグごとに更新される並び (id 配列)
 * - committing: 確定 PUT 中フラグ
 * - toast: 成功/失敗の通知
 */
import { create } from 'zustand'

export type ReorderMode = 'view' | 'reorder'

export interface ReorderToast {
  kind: 'success' | 'error' | 'info'
  message: string
}

export interface ReorderState {
  mode: ReorderMode
  originalOrder: number[]
  draftOrder: number[]
  committing: boolean
  toast: ReorderToast | null

  enter: (currentIds: number[]) => void
  setDraft: (next: number[]) => void
  exit: () => void
  setCommitting: (v: boolean) => void
  setToast: (t: ReorderToast | null) => void
  hasPending: () => boolean
}

export function createReorderStore() {
  return create<ReorderState>()((set, get) => ({
    mode: 'view',
    originalOrder: [],
    draftOrder: [],
    committing: false,
    toast: null,

    enter: (currentIds) =>
      set({
        mode: 'reorder',
        originalOrder: [...currentIds],
        draftOrder: [...currentIds],
        toast: null,
      }),

    setDraft: (next) => set({ draftOrder: next }),

    exit: () =>
      set({
        mode: 'view',
        originalOrder: [],
        draftOrder: [],
        committing: false,
      }),

    setCommitting: (v) => set({ committing: v }),

    setToast: (t) => set({ toast: t }),

    hasPending: () => {
      const { originalOrder, draftOrder } = get()
      if (originalOrder.length !== draftOrder.length) return true
      return originalOrder.some((id, i) => id !== draftOrder[i])
    },
  }))
}

// 各ページが自分専用の store を持つ
export const useEmployeeReorderStore = createReorderStore()
export const useGroupReorderStore = createReorderStore()
export const usePatternReorderStore = createReorderStore()
export const useDayTemplateReorderStore = createReorderStore()
export const useDayOverrideReorderStore = createReorderStore()
export const useChoiceGroupReorderStore = createReorderStore()
export const useIncompatibilityReorderStore = createReorderStore()
export const usePatternTriggerReorderStore = createReorderStore()
export const useRoleReorderStore = createReorderStore()
