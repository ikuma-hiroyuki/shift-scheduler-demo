import { create } from 'zustand'
import { SIDEBAR_PATTERNS, type SidebarPatternId } from '../constants/sidebarPatterns'

interface SidebarPatternState {
  patternId: SidebarPatternId
  setPattern: (id: SidebarPatternId) => void
  reload: () => void
}

const STORAGE_PREFIX = 'sidebar_pattern:'

function storageKey(): string {
  const uid = localStorage.getItem('current_user_id') || 'guest'
  return `${STORAGE_PREFIX}${uid}`
}

function isValidId(id: unknown): id is SidebarPatternId {
  return typeof id === 'string' && SIDEBAR_PATTERNS.some((p) => p.id === id)
}

function loadPref(): SidebarPatternId {
  try {
    const raw = localStorage.getItem(storageKey())
    if (raw) {
      const parsed = JSON.parse(raw) as { patternId?: unknown }
      if (isValidId(parsed.patternId)) return parsed.patternId
    }
  } catch {
    /* ignore */
  }
  return 'none'
}

function savePref(patternId: SidebarPatternId) {
  localStorage.setItem(storageKey(), JSON.stringify({ patternId }))
}

export const useSidebarPatternStore = create<SidebarPatternState>()((set) => ({
  patternId: loadPref(),
  setPattern: (id) => {
    if (!isValidId(id)) return
    set({ patternId: id })
    savePref(id)
  },
  reload: () => {
    set({ patternId: loadPref() })
  },
}))
