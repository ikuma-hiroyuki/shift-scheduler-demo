import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { THEME_PRESETS, applyTheme, purgeLegacyThemeKeys, useThemeStore } from './theme'

function resetStore() {
  useThemeStore.setState({ presetId: 'emerald', mode: 'light' })
}

function clearRootInlineStyles() {
  const root = document.documentElement
  root.removeAttribute('style')
  root.classList.remove('dark')
  delete root.dataset.themePreset
}

/**
 * matchMedia を制御可能な実装に差し替えるユーティリティ。
 * 返り値で `matches` を更新したり change イベントを発火したりできる。
 */
function installControllableMatchMedia(initialMatches = false) {
  let matches = initialMatches
  const listeners = new Set<(e: MediaQueryListEvent) => void>()
  const addEventListener = vi.fn((_type: string, cb: (e: MediaQueryListEvent) => void) => {
    listeners.add(cb)
  })
  const removeEventListener = vi.fn((_type: string, cb: (e: MediaQueryListEvent) => void) => {
    listeners.delete(cb)
  })
  const mql = {
    get matches() {
      return matches
    },
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener,
    removeEventListener,
    dispatchEvent: vi.fn(),
  }
  const mm = vi.fn().mockReturnValue(mql)
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: mm,
  })
  return {
    setMatches(v: boolean) {
      matches = v
      listeners.forEach((cb) =>
        cb({ matches, media: mql.media } as unknown as MediaQueryListEvent),
      )
    },
    addEventListener,
    removeEventListener,
    matchMedia: mm,
  }
}

beforeEach(() => {
  resetStore()
  clearRootInlineStyles()
})

afterEach(() => {
  clearRootInlineStyles()
})

describe('applyTheme', () => {
  it('sets brand CSS variables and theme-preset attribute on the root', () => {
    applyTheme('ocean', 'light')

    const root = document.documentElement
    expect(root.dataset.themePreset).toBe('ocean')
    // 'ocean' light shade-500 = #0E7BD9 → "14 123 217"
    expect(root.style.getPropertyValue('--brand-500').trim()).toBe('14 123 217')
  })

  it('toggles the .dark class based on mode', () => {
    applyTheme('emerald', 'dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    applyTheme('emerald', 'light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('falls back to the first preset when given an unknown id', () => {
    applyTheme('does-not-exist', 'light')

    expect(document.documentElement.dataset.themePreset).toBe(THEME_PRESETS[0].id)
  })
})

describe('useThemeStore', () => {
  it('setPreset switches presetId and persists to localStorage', () => {
    useThemeStore.getState().setPreset('rose')

    expect(useThemeStore.getState().presetId).toBe('rose')
    const stored = localStorage.getItem('theme_pref:guest')
    expect(stored).not.toBeNull()
    expect(JSON.parse(stored!)).toMatchObject({ presetId: 'rose', mode: 'light' })
  })

  it('setPreset ignores unknown id and keeps current preset', () => {
    useThemeStore.getState().setPreset('plum')
    useThemeStore.getState().setPreset('not-a-preset')

    expect(useThemeStore.getState().presetId).toBe('plum')
  })

  it('setMode switches mode, applies DOM and persists', () => {
    useThemeStore.getState().setMode('dark')

    expect(useThemeStore.getState().mode).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    const stored = JSON.parse(localStorage.getItem('theme_pref:guest')!)
    expect(stored.mode).toBe('dark')
  })

  it('toggleMode cycles light → dark → system → light', () => {
    useThemeStore.getState().toggleMode()
    expect(useThemeStore.getState().mode).toBe('dark')

    useThemeStore.getState().toggleMode()
    expect(useThemeStore.getState().mode).toBe('system')

    useThemeStore.getState().toggleMode()
    expect(useThemeStore.getState().mode).toBe('light')
  })

  it('persistence key is namespaced by current_user_id (logged-in user)', () => {
    localStorage.setItem('current_user_id', 'user-42')

    useThemeStore.getState().setPreset('sunset')

    expect(localStorage.getItem('theme_pref:user-42')).not.toBeNull()
    expect(localStorage.getItem('theme_pref:guest')).toBeNull()
  })

  it('falls back to theme_pref:guest when current_user_id is missing even if access_token exists', () => {
    localStorage.setItem('access_token', 'some-jwt-string')

    useThemeStore.getState().setPreset('plum')

    expect(localStorage.getItem('theme_pref:guest')).not.toBeNull()
    expect(localStorage.getItem('theme_pref:some-jwt-string')).toBeNull()
  })

  it('reload picks up changes that occurred outside the store', () => {
    localStorage.setItem(
      'theme_pref:guest',
      JSON.stringify({ presetId: 'graphite', mode: 'dark' }),
    )

    useThemeStore.getState().reload()

    expect(useThemeStore.getState().presetId).toBe('graphite')
    expect(useThemeStore.getState().mode).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('reload falls back to emerald/light when stored data is malformed', () => {
    localStorage.setItem('theme_pref:guest', '{not json')

    useThemeStore.getState().reload()

    expect(useThemeStore.getState().presetId).toBe('emerald')
    // setup.ts では matchMedia は matches=false を返すので mode=light
    expect(useThemeStore.getState().mode).toBe('light')
  })

  it('reload normalizes unknown stored presetId to emerald', () => {
    localStorage.setItem(
      'theme_pref:guest',
      JSON.stringify({ presetId: 'aurora', mode: 'light' }),
    )

    useThemeStore.getState().reload()

    expect(useThemeStore.getState().presetId).toBe('emerald')
  })
})

describe('purgeLegacyThemeKeys', () => {
  it('removes theme_pref keys whose suffix looks like a JWT', () => {
    localStorage.setItem(
      'theme_pref:eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.signature',
      JSON.stringify({ presetId: 'rose', mode: 'dark' }),
    )
    localStorage.setItem(
      'theme_pref:abc-DEF_123.payload-X.sig_Y',
      JSON.stringify({ presetId: 'plum', mode: 'light' }),
    )

    purgeLegacyThemeKeys()

    expect(
      localStorage.getItem(
        'theme_pref:eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.signature',
      ),
    ).toBeNull()
    expect(
      localStorage.getItem('theme_pref:abc-DEF_123.payload-X.sig_Y'),
    ).toBeNull()
  })

  it('keeps non-JWT theme_pref keys (guest, user-id, email)', () => {
    localStorage.setItem(
      'theme_pref:guest',
      JSON.stringify({ presetId: 'emerald', mode: 'light' }),
    )
    localStorage.setItem(
      'theme_pref:user-42',
      JSON.stringify({ presetId: 'ocean', mode: 'dark' }),
    )
    localStorage.setItem(
      'theme_pref:alice@example.com',
      JSON.stringify({ presetId: 'sunset', mode: 'light' }),
    )

    purgeLegacyThemeKeys()

    expect(localStorage.getItem('theme_pref:guest')).not.toBeNull()
    expect(localStorage.getItem('theme_pref:user-42')).not.toBeNull()
    expect(
      localStorage.getItem('theme_pref:alice@example.com'),
    ).not.toBeNull()
  })

  it('does not touch unrelated localStorage entries', () => {
    localStorage.setItem('access_token', 'eyJabc.eyJdef.sig')
    localStorage.setItem('sidebar_collapsed', '1')

    purgeLegacyThemeKeys()

    expect(localStorage.getItem('access_token')).toBe('eyJabc.eyJdef.sig')
    expect(localStorage.getItem('sidebar_collapsed')).toBe('1')
  })
})

describe('useThemeStore — system mode', () => {
  it("setMode('system') persists 'system' to localStorage", () => {
    installControllableMatchMedia(false)

    useThemeStore.getState().setMode('system')

    expect(useThemeStore.getState().mode).toBe('system')
    const stored = JSON.parse(localStorage.getItem('theme_pref:guest')!)
    expect(stored.mode).toBe('system')
  })

  it("setMode('system') applies effective mode based on matchMedia (dark)", () => {
    installControllableMatchMedia(true)

    useThemeStore.getState().setMode('system')

    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it("setMode('system') applies effective mode based on matchMedia (light)", () => {
    installControllableMatchMedia(false)

    useThemeStore.getState().setMode('system')

    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it("re-applies theme when prefers-color-scheme changes under 'system'", () => {
    const ctrl = installControllableMatchMedia(false)

    useThemeStore.getState().setMode('system')
    expect(document.documentElement.classList.contains('dark')).toBe(false)

    ctrl.setMatches(true)
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    ctrl.setMatches(false)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('removes the matchMedia listener when leaving system mode', () => {
    const ctrl = installControllableMatchMedia(false)

    useThemeStore.getState().setMode('system')
    expect(ctrl.addEventListener).toHaveBeenCalled()

    useThemeStore.getState().setMode('light')
    expect(ctrl.removeEventListener).toHaveBeenCalled()

    // After leaving system mode, OS-level changes must NOT flip the DOM.
    ctrl.setMatches(true)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it("loadPref accepts 'system' as a valid stored mode", () => {
    installControllableMatchMedia(true)
    localStorage.setItem(
      'theme_pref:guest',
      JSON.stringify({ presetId: 'ocean', mode: 'system' }),
    )

    useThemeStore.getState().reload()

    expect(useThemeStore.getState().mode).toBe('system')
    expect(useThemeStore.getState().presetId).toBe('ocean')
    // matches=true なので effective は dark
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('reload re-subscribes matchMedia when stored mode is system', () => {
    const ctrl = installControllableMatchMedia(false)
    localStorage.setItem(
      'theme_pref:guest',
      JSON.stringify({ presetId: 'emerald', mode: 'system' }),
    )

    useThemeStore.getState().reload()

    ctrl.setMatches(true)
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })
})
