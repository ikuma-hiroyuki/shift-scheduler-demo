import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useSidebarPatternStore } from './sidebarPattern'

beforeEach(() => {
  localStorage.clear()
  // 内部状態を default に戻す
  useSidebarPatternStore.setState({ patternId: 'none' })
})

afterEach(() => {
  localStorage.clear()
})

describe('useSidebarPatternStore', () => {
  it('defaults to "none"', () => {
    expect(useSidebarPatternStore.getState().patternId).toBe('none')
  })

  it('setPattern updates state and persists per-user to localStorage', () => {
    localStorage.setItem('current_user_id', 'user-1')
    useSidebarPatternStore.getState().setPattern('asanoha')

    expect(useSidebarPatternStore.getState().patternId).toBe('asanoha')
    expect(localStorage.getItem('sidebar_pattern:user-1')).toBe(
      JSON.stringify({ patternId: 'asanoha' }),
    )
  })

  it('falls back to "guest" key when no current_user_id is set', () => {
    useSidebarPatternStore.getState().setPattern('seigaiha')
    expect(localStorage.getItem('sidebar_pattern:guest')).toBe(
      JSON.stringify({ patternId: 'seigaiha' }),
    )
  })

  it('reload restores the persisted pattern for the current user', () => {
    localStorage.setItem('current_user_id', 'user-2')
    localStorage.setItem(
      'sidebar_pattern:user-2',
      JSON.stringify({ patternId: 'honeycomb' }),
    )

    useSidebarPatternStore.getState().reload()
    expect(useSidebarPatternStore.getState().patternId).toBe('honeycomb')
  })

  it('rejects unknown pattern ids (no state change, no write)', () => {
    localStorage.setItem('current_user_id', 'user-3')
    // @ts-expect-error 無効値を意図的に渡してガード挙動を検証
    useSidebarPatternStore.getState().setPattern('not-a-pattern')

    expect(useSidebarPatternStore.getState().patternId).toBe('none')
    expect(localStorage.getItem('sidebar_pattern:user-3')).toBeNull()
  })

  it('reload returns "none" when stored value is corrupt or unknown', () => {
    localStorage.setItem('current_user_id', 'user-4')
    localStorage.setItem('sidebar_pattern:user-4', '{not-json}')
    useSidebarPatternStore.getState().reload()
    expect(useSidebarPatternStore.getState().patternId).toBe('none')

    localStorage.setItem(
      'sidebar_pattern:user-4',
      JSON.stringify({ patternId: 'unknown-id' }),
    )
    useSidebarPatternStore.getState().reload()
    expect(useSidebarPatternStore.getState().patternId).toBe('none')
  })
})
