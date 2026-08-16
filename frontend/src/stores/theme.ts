import { create } from 'zustand'

export interface ThemePreset {
  id: string
  label: string
  swatch: string
  light: Record<string, string>
  dark: Record<string, string>
}

const SHADE_KEYS = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900'] as const

function hexToRgbChannels(hex: string): string {
  const v = hex.replace('#', '')
  const r = parseInt(v.slice(0, 2), 16)
  const g = parseInt(v.slice(2, 4), 16)
  const b = parseInt(v.slice(4, 6), 16)
  return `${r} ${g} ${b}`
}

function buildShades(base: Record<(typeof SHADE_KEYS)[number], string>): Record<string, string> {
  return SHADE_KEYS.reduce<Record<string, string>>((acc, k) => {
    acc[`--brand-${k}`] = hexToRgbChannels(base[k])
    return acc
  }, {})
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'emerald',
    label: 'エメラルド',
    swatch: '#009C74',
    light: buildShades({
      '50': '#E6F7F1',
      '100': '#C2EBDC',
      '200': '#8FD9BD',
      '300': '#5CC79E',
      '400': '#2DB585',
      '500': '#009C74',
      '600': '#008866',
      '700': '#00735A',
      '800': '#005C47',
      '900': '#00402F',
    }),
    dark: buildShades({
      '50': '#0E2A22',
      '100': '#103A2E',
      '200': '#13513F',
      '300': '#176A53',
      '400': '#1E8568',
      '500': '#2DB585',
      '600': '#5CC79E',
      '700': '#8FD9BD',
      '800': '#C2EBDC',
      '900': '#E6F7F1',
    }),
  },
  {
    id: 'ocean',
    label: 'オーシャン',
    swatch: '#0E7BD9',
    light: buildShades({
      '50': '#E6F1FB',
      '100': '#C2DCF5',
      '200': '#8FBFEC',
      '300': '#5CA1E2',
      '400': '#2D8AD9',
      '500': '#0E7BD9',
      '600': '#0B68B8',
      '700': '#0A5798',
      '800': '#073F70',
      '900': '#04284A',
    }),
    dark: buildShades({
      '50': '#0A1A2A',
      '100': '#0C2540',
      '200': '#103459',
      '300': '#144878',
      '400': '#1A60A0',
      '500': '#2D8AD9',
      '600': '#5CA1E2',
      '700': '#8FBFEC',
      '800': '#C2DCF5',
      '900': '#E6F1FB',
    }),
  },
  {
    id: 'sunset',
    label: 'サンセット',
    swatch: '#E0631A',
    light: buildShades({
      '50': '#FCEFE4',
      '100': '#F8DAC0',
      '200': '#F2BD8F',
      '300': '#EC9F5E',
      '400': '#E68235',
      '500': '#E0631A',
      '600': '#BD5114',
      '700': '#9A4110',
      '800': '#74300C',
      '900': '#4D1F08',
    }),
    dark: buildShades({
      '50': '#2A150A',
      '100': '#3F1E0E',
      '200': '#5B2C13',
      '300': '#7A3D1A',
      '400': '#A05322',
      '500': '#E0631A',
      '600': '#EC9F5E',
      '700': '#F2BD8F',
      '800': '#F8DAC0',
      '900': '#FCEFE4',
    }),
  },
  {
    id: 'plum',
    label: 'プラム',
    swatch: '#8E3DB8',
    light: buildShades({
      '50': '#F3E8FA',
      '100': '#E1C8F1',
      '200': '#C698E3',
      '300': '#AB68D5',
      '400': '#9647C5',
      '500': '#8E3DB8',
      '600': '#74319A',
      '700': '#5C277B',
      '800': '#441C5C',
      '900': '#2C123D',
    }),
    dark: buildShades({
      '50': '#1A0E2A',
      '100': '#26143F',
      '200': '#371D5B',
      '300': '#4B287A',
      '400': '#6A38A0',
      '500': '#9647C5',
      '600': '#AB68D5',
      '700': '#C698E3',
      '800': '#E1C8F1',
      '900': '#F3E8FA',
    }),
  },
  {
    id: 'rose',
    label: 'ローズ',
    swatch: '#D33F75',
    light: buildShades({
      '50': '#FBE7EF',
      '100': '#F5C5D7',
      '200': '#EE94B3',
      '300': '#E76690',
      '400': '#DD4A7E',
      '500': '#D33F75',
      '600': '#B23262',
      '700': '#8E2750',
      '800': '#691C3C',
      '900': '#451228',
    }),
    dark: buildShades({
      '50': '#280C18',
      '100': '#3D1224',
      '200': '#591A35',
      '300': '#782449',
      '400': '#9F305F',
      '500': '#D33F75',
      '600': '#E76690',
      '700': '#EE94B3',
      '800': '#F5C5D7',
      '900': '#FBE7EF',
    }),
  },
  {
    id: 'graphite',
    label: 'グラファイト',
    swatch: '#3F4754',
    light: buildShades({
      '50': '#EEF0F3',
      '100': '#D6DAE0',
      '200': '#B0B7C2',
      '300': '#8B94A3',
      '400': '#65718A',
      '500': '#3F4754',
      '600': '#363D49',
      '700': '#2C323C',
      '800': '#21262E',
      '900': '#161A1F',
    }),
    dark: buildShades({
      '50': '#0F1115',
      '100': '#161A1F',
      '200': '#21262E',
      '300': '#2C323C',
      '400': '#363D49',
      '500': '#65718A',
      '600': '#8B94A3',
      '700': '#B0B7C2',
      '800': '#D6DAE0',
      '900': '#EEF0F3',
    }),
  },
]

export type ThemeMode = 'light' | 'dark' | 'system'
export type EffectiveMode = 'light' | 'dark'

interface ThemeState {
  presetId: string
  mode: ThemeMode
  setPreset: (id: string) => void
  setMode: (mode: ThemeMode) => void
  toggleMode: () => void
  reload: () => void
}

const STORAGE_PREFIX = 'theme_pref:'

const JWT_SUFFIX_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/

export function purgeLegacyThemeKeys() {
  const victims: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key || !key.startsWith(STORAGE_PREFIX)) continue
    const suffix = key.slice(STORAGE_PREFIX.length)
    if (JWT_SUFFIX_RE.test(suffix)) victims.push(key)
  }
  victims.forEach((k) => localStorage.removeItem(k))
}

function storageKey(): string {
  const uid = localStorage.getItem('current_user_id') || 'guest'
  return `${STORAGE_PREFIX}${uid}`
}

interface StoredPref {
  presetId: string
  mode: ThemeMode
}

function loadPref(): StoredPref {
  try {
    const raw = localStorage.getItem(storageKey())
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StoredPref>
      const presetId = THEME_PRESETS.find((p) => p.id === parsed.presetId)?.id || 'emerald'
      const mode: ThemeMode =
        parsed.mode === 'dark' || parsed.mode === 'system' ? parsed.mode : 'light'
      return { presetId, mode }
    }
  } catch {
    /* ignore */
  }
  // 既存テスト互換: 欠損時は OS の prefers-color-scheme を見て light/dark を返す
  const prefersDark =
    typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches
  return { presetId: 'emerald', mode: prefersDark ? 'dark' : 'light' }
}

function savePref(pref: StoredPref) {
  localStorage.setItem(storageKey(), JSON.stringify(pref))
}

export function applyTheme(presetId: string, mode: EffectiveMode) {
  const preset = THEME_PRESETS.find((p) => p.id === presetId) || THEME_PRESETS[0]
  const vars = mode === 'dark' ? preset.dark : preset.light
  const root = document.documentElement
  Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v))
  root.classList.toggle('dark', mode === 'dark')
  root.dataset.themePreset = preset.id
}

/**
 * 'system' 時に登録される matchMedia リスナの解除関数。
 * mode が変わったり reload されたりするたびに付け替える。
 */
let unsubscribeSystem: (() => void) | null = null

function teardownSystemListener() {
  if (unsubscribeSystem) {
    unsubscribeSystem()
    unsubscribeSystem = null
  }
}

function resolveEffective(mode: ThemeMode): EffectiveMode {
  if (mode !== 'system') return mode
  if (typeof window.matchMedia !== 'function') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/**
 * mode が 'system' のとき OS の prefers-color-scheme 変化を購読し
 * applyTheme を再実行する。古いリスナがあれば必ず先に解除する。
 */
function subscribeSystemIfNeeded(mode: ThemeMode, presetId: string) {
  teardownSystemListener()
  if (mode !== 'system') return
  if (typeof window.matchMedia !== 'function') return
  const mql = window.matchMedia('(prefers-color-scheme: dark)')
  const listener = (e: MediaQueryListEvent) => {
    applyTheme(presetId, e.matches ? 'dark' : 'light')
  }
  mql.addEventListener('change', listener)
  unsubscribeSystem = () => mql.removeEventListener('change', listener)
}

purgeLegacyThemeKeys()
const initial = loadPref()

export const useThemeStore = create<ThemeState>()((set, get) => ({
  presetId: initial.presetId,
  mode: initial.mode,
  setPreset: (id) => {
    const presetId = THEME_PRESETS.find((p) => p.id === id)?.id || get().presetId
    const mode = get().mode
    set({ presetId })
    applyTheme(presetId, resolveEffective(mode))
    savePref({ presetId, mode })
    // system モード中に preset が変わるとリスナのクロージャが古い presetId を握ったままになるので張り替える
    subscribeSystemIfNeeded(mode, presetId)
  },
  setMode: (mode) => {
    set({ mode })
    const presetId = get().presetId
    applyTheme(presetId, resolveEffective(mode))
    savePref({ presetId, mode })
    subscribeSystemIfNeeded(mode, presetId)
  },
  toggleMode: () => {
    // light → dark → system → light
    const cur = get().mode
    const next: ThemeMode = cur === 'light' ? 'dark' : cur === 'dark' ? 'system' : 'light'
    get().setMode(next)
  },
  reload: () => {
    const pref = loadPref()
    set(pref)
    applyTheme(pref.presetId, resolveEffective(pref.mode))
    subscribeSystemIfNeeded(pref.mode, pref.presetId)
  },
}))

applyTheme(initial.presetId, resolveEffective(initial.mode))
subscribeSystemIfNeeded(initial.mode, initial.presetId)
