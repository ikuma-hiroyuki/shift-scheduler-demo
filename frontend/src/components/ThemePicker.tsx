import { useEffect, useRef, useState } from 'react'
import { THEME_PRESETS, useThemeStore, type ThemeMode } from '../stores/theme'
import {
  SIDEBAR_PATTERNS,
  previewSvg,
  svgToDataUri,
  type SidebarPatternId,
} from '../constants/sidebarPatterns'
import { useSidebarPatternStore } from '../stores/sidebarPattern'

interface Props {
  collapsed: boolean
}

const MODE_OPTIONS: { value: ThemeMode; label: string; short: string }[] = [
  { value: 'light', label: 'ライト', short: 'Light' },
  { value: 'dark', label: 'ダーク', short: 'Dark' },
  { value: 'system', label: 'システム', short: 'System' },
]

export default function ThemePicker({ collapsed }: Props) {
  const presetId = useThemeStore((s) => s.presetId)
  const mode = useThemeStore((s) => s.mode)
  const setPreset = useThemeStore((s) => s.setPreset)
  const setMode = useThemeStore((s) => s.setMode)
  const patternId = useSidebarPatternStore((s) => s.patternId)
  const setPattern = useSidebarPatternStore((s) => s.setPattern)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const current = THEME_PRESETS.find((p) => p.id === presetId) || THEME_PRESETS[0]
  const currentModeShort = MODE_OPTIONS.find((o) => o.value === mode)?.short ?? 'Light'

  return (
    <div ref={wrapRef} className={`relative ${collapsed ? 'flex justify-center' : ''}`}>
      <button
        onClick={() => setOpen((v) => !v)}
        title={collapsed ? 'テーマ設定' : undefined}
        aria-label="テーマ設定"
        aria-expanded={open}
        className={`text-xs text-white/80 hover:text-white transition-colors flex items-center ${
          collapsed ? 'p-2' : 'w-full justify-between px-2 py-1'
        }`}
      >
        {collapsed ? (
          <PaletteIcon />
        ) : (
          <>
            <span className="flex items-center gap-2">
              <PaletteIcon />
              <span>テーマ</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="w-3.5 h-3.5 rounded-full ring-1 ring-white/40"
                style={{ background: current.swatch }}
              />
              <span className="text-[10px] uppercase tracking-widest opacity-70">
                {currentModeShort}
              </span>
            </span>
          </>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="テーマ設定"
          className={`absolute z-50 ${
            collapsed ? 'left-full ml-2 bottom-0' : 'left-0 right-0 bottom-full mb-2'
          } w-60 rounded-lg border border-black/5 bg-white text-ink shadow-xl p-3`}
        >
          <div className="text-[11px] tracking-widest uppercase text-ink-muted mb-2">テーマカラー</div>
          <div className="grid grid-cols-3 gap-2 mb-3">
            {THEME_PRESETS.map((p) => {
              const active = p.id === presetId
              return (
                <button
                  key={p.id}
                  onClick={() => setPreset(p.id)}
                  title={p.label}
                  aria-label={p.label}
                  aria-pressed={active}
                  className={`flex flex-col items-center gap-1 p-1.5 rounded-md transition-all ${
                    active ? 'ring-2 ring-offset-1 ring-brand-500 bg-brand-50' : 'hover:bg-black/5'
                  }`}
                >
                  <span
                    className="w-7 h-7 rounded-full border border-black/10 shadow-inner"
                    style={{ background: p.swatch }}
                  />
                  <span className="text-[10px] text-ink-muted">{p.label}</span>
                </button>
              )
            })}
          </div>

          <div className="border-t border-black/5 pt-2 mb-3">
            <div className="text-[11px] tracking-widest uppercase text-ink-muted mb-1.5">
              カラーモード
            </div>
            <div
              role="radiogroup"
              aria-label="カラーモード"
              className="grid grid-cols-3 gap-1 rounded-md bg-black/5 p-1"
            >
              {MODE_OPTIONS.map((opt) => {
                const active = mode === opt.value
                return (
                  <button
                    key={opt.value}
                    role="radio"
                    aria-checked={active}
                    aria-label={opt.label}
                    onClick={() => setMode(opt.value)}
                    className={`text-xs py-1 rounded transition-colors ${
                      active
                        ? 'bg-white text-ink shadow-sm font-medium'
                        : 'text-ink-muted hover:bg-black/5'
                    }`}
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="border-t border-black/5 pt-2">
            <div className="text-[11px] tracking-widest uppercase text-ink-muted mb-1.5">
              背景パターン
            </div>
            <div className="grid grid-cols-3 gap-2">
              {SIDEBAR_PATTERNS.map((p) => (
                <PatternSwatch
                  key={p.id}
                  id={p.id}
                  label={p.label}
                  active={p.id === patternId}
                  onClick={() => setPattern(p.id)}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

interface SwatchProps {
  id: SidebarPatternId
  label: string
  active: boolean
  onClick: () => void
}

function PatternSwatch({ id, label, active, onClick }: SwatchProps) {
  const preview = previewSvg(id)
  const bg = preview ? `url("${svgToDataUri(preview)}")` : 'none'
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`flex flex-col items-center gap-1 p-1.5 rounded-md transition-all ${
        active ? 'ring-2 ring-offset-1 ring-brand-500 bg-brand-50' : 'hover:bg-black/5'
      }`}
    >
      <span
        className="block w-full h-9 rounded border border-black/10 bg-brand-500"
        style={{ backgroundImage: bg }}
      />
      <span className="text-[10px] text-ink-muted">{label}</span>
    </button>
  )
}

function PaletteIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" strokeWidth="1.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3a9 9 0 100 18c1.2 0 2-.8 2-2 0-.6-.2-1-.6-1.4-.4-.4-.6-.8-.6-1.4 0-1.2.8-2 2-2h2.2A4 4 0 0021 9.2 9 9 0 0012 3z" />
      <circle cx="7.5" cy="10.5" r="1" fill="currentColor" />
      <circle cx="10.5" cy="7" r="1" fill="currentColor" />
      <circle cx="14.5" cy="7" r="1" fill="currentColor" />
      <circle cx="17.5" cy="10.5" r="1" fill="currentColor" />
    </svg>
  )
}
