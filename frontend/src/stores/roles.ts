import { create } from 'zustand'
import { listRoles } from '../api/roles'
import type { Role } from '../types/api'

interface RoleState {
  roles: Role[]
  loaded: boolean
  fetch: () => Promise<void>
  setRoles: (roles: Role[]) => void
}

export const useRoleStore = create<RoleState>()((set) => ({
  roles: [],
  loaded: false,
  fetch: async () => {
    try {
      const roles = await listRoles()
      set({ roles, loaded: true })
    } catch {
      // 401 は client interceptor 側で処理。失敗時は空のまま (未ロード)
    }
  },
  setRoles: (roles) => set({ roles, loaded: true }),
}))
