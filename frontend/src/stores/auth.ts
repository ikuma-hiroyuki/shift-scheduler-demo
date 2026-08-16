import { create } from 'zustand'
import { getCurrentUser } from '../api/auth'
import type { User } from '../types/api'

interface AuthState {
  token: string | null
  currentUser: User | null
  setToken: (token: string) => void
  setCurrentUser: (u: User | null) => void
  fetchCurrentUser: () => Promise<void>
  logout: () => void
}

function decodeJwtSub(token: string): string | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const json = atob(padded)
    const payload = JSON.parse(json) as { sub?: unknown }
    return typeof payload.sub === 'string' && payload.sub.length > 0 ? payload.sub : null
  } catch {
    return null
  }
}

export const useAuthStore = create<AuthState>()((set, get) => ({
  token: localStorage.getItem('access_token'),
  currentUser: null,
  setToken: (token) => {
    localStorage.setItem('access_token', token)
    const sub = decodeJwtSub(token)
    if (sub) {
      localStorage.setItem('current_user_id', sub)
    }
    set({ token })
  },
  setCurrentUser: (u) => set({ currentUser: u }),
  fetchCurrentUser: async () => {
    if (!get().token) return
    try {
      const u = await getCurrentUser()
      set({ currentUser: u })
    } catch {
      // 401 は client interceptor が logout して /login へ redirect する
    }
  },
  logout: () => {
    localStorage.removeItem('access_token')
    set({ token: null, currentUser: null })
  },
}))
