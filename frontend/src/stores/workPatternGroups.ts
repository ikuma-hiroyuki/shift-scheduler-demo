// issue #199: workPatternGroups の同期ストア。
//
// /work-patterns でグループ名や色を編集した直後に /shift へ戻ると、
// ShiftGrid 側のローカル state は古いまま。マスタ編集時にこのストアを
// invalidate すれば、次に subscribe する側 (ShiftGrid) が再フェッチで
// 最新化される。
//
// キャッシュは部門 (department_id) ごと。同一部門の同じデータを複数
// コンポーネントが二重三重に fetch していた問題も解消する。
import { create } from 'zustand'
import { listWorkPatternGroups } from '../api/workPatterns'
import type { WorkPatternGroup } from '../types/api'

interface WorkPatternGroupsState {
  /** 部門 → グループ配列。未ロードの部門は entry なし。 */
  groupsByDept: Record<number, WorkPatternGroup[]>
  /** 部門 → fetch 中の Promise (重複呼び出し coalesce 用)。 */
  inFlight: Record<number, Promise<WorkPatternGroup[]> | undefined>
  /** 該当部門のグループを取得する。キャッシュがあれば即返す。
   *  `force=true` でキャッシュを無視して再フェッチ。 */
  fetch: (deptId: number, force?: boolean) => Promise<WorkPatternGroup[]>
  /** 編集後に呼ぶ。次の fetch で再取得される。 */
  invalidate: (deptId: number) => void
  /** WorkPatternsPage が個別 mutation 後に store を直接同期させたい場合。 */
  setGroups: (deptId: number, groups: WorkPatternGroup[]) => void
}

export const useWorkPatternGroupsStore = create<WorkPatternGroupsState>()(
  (set, get) => ({
    groupsByDept: {},
    inFlight: {},
    fetch: async (deptId, force = false) => {
      const state = get()
      if (!force) {
        const cached = state.groupsByDept[deptId]
        if (cached) return cached
        const pending = state.inFlight[deptId]
        if (pending) return pending
      }
      const p = listWorkPatternGroups(deptId)
        .then((groups) => {
          set((s) => ({
            groupsByDept: { ...s.groupsByDept, [deptId]: groups },
            inFlight: { ...s.inFlight, [deptId]: undefined },
          }))
          return groups
        })
        .catch((err) => {
          set((s) => ({ inFlight: { ...s.inFlight, [deptId]: undefined } }))
          throw err
        })
      set((s) => ({ inFlight: { ...s.inFlight, [deptId]: p } }))
      return p
    },
    invalidate: (deptId) => {
      set((s) => {
        const next = { ...s.groupsByDept }
        delete next[deptId]
        return { groupsByDept: next }
      })
    },
    setGroups: (deptId, groups) => {
      set((s) => ({
        groupsByDept: { ...s.groupsByDept, [deptId]: groups },
      }))
    },
  }),
)
