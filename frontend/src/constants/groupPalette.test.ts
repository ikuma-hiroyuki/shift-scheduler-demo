import { describe, expect, it } from 'vitest'
import {
  DEFAULT_GROUP_COLOR,
  GROUP_PRESETS,
  isHexColor,
  readableTextColor,
  suggestUnusedPresetColor,
} from './groupPalette'

describe('isHexColor', () => {
  it('accepts #RRGGBB lower / upper / mixed case', () => {
    expect(isHexColor('#dcfce7')).toBe(true)
    expect(isHexColor('#DCFCE7')).toBe(true)
    expect(isHexColor('#AbC123')).toBe(true)
  })

  it('rejects malformed values', () => {
    expect(isHexColor('red')).toBe(false)
    expect(isHexColor('#fff')).toBe(false) // 3-digit shorthand 不可
    expect(isHexColor('#GGGGGG')).toBe(false)
    expect(isHexColor('#1234567')).toBe(false)
    expect(isHexColor('')).toBe(false)
  })
})

describe('readableTextColor — WCAG AA contrast', () => {
  // 各 preset で contrast 4.5:1 以上を返すことを確認(暗灰 #1f2937 を返す前提)
  it('all preset colors yield dark text', () => {
    for (const p of GROUP_PRESETS) {
      expect(readableTextColor(p.hex)).toBe('#1f2937')
    }
  })

  // 旧実装で問題化した custom hex の境界例
  it('returns white for dark backgrounds (#1e3a8a navy)', () => {
    expect(readableTextColor('#1e3a8a')).toBe('#ffffff')
  })

  it('returns white for pure red (#ff0000)', () => {
    expect(readableTextColor('#ff0000')).toBe('#ffffff')
  })

  it('returns dark text for pure yellow (#ffff00) — high luminance', () => {
    expect(readableTextColor('#ffff00')).toBe('#1f2937')
  })

  it('returns dark text for pure green (#00ff00) — high luminance under WCAG', () => {
    // 旧 Rec.601 luma だと 0.587 で白、新 WCAG だと約 0.715 で濃灰
    expect(readableTextColor('#00ff00')).toBe('#1f2937')
  })

  it('returns dark text for medium gray (#888888) per WCAG higher-contrast rule', () => {
    // 旧実装は luma 0.53 で白(contrast 3.5:1 で AA fail)を返していた
    // WCAG 計算では中灰は濃灰の方が contrast 高い
    expect(readableTextColor('#888888')).toBe('#1f2937')
  })

  it('returns dark text for invalid hex (defensive default)', () => {
    expect(readableTextColor('not-a-color')).toBe('#1f2937')
  })
})

describe('suggestUnusedPresetColor', () => {
  it('returns first preset when none used', () => {
    expect(suggestUnusedPresetColor([])).toBe(GROUP_PRESETS[0].hex)
  })

  it('skips already-used presets (case-insensitive)', () => {
    const used = ['#DCFCE7', '#dbeafe']
    expect(suggestUnusedPresetColor(used)).toBe(GROUP_PRESETS[2].hex)
  })

  it('falls back to first preset when all 9 are exhausted', () => {
    const used = GROUP_PRESETS.map((p) => p.hex)
    expect(suggestUnusedPresetColor(used)).toBe(GROUP_PRESETS[0].hex)
  })
})

describe('DEFAULT_GROUP_COLOR', () => {
  it('matches first preset', () => {
    expect(DEFAULT_GROUP_COLOR).toBe(GROUP_PRESETS[0].hex)
  })
})

describe('preset sync with backend (drift check)', () => {
  // backend `app/constants/group_colors.py` の GROUP_COLOR_PRESETS と
  // 同じ順序・値である必要がある (preset index で循環割当しているため)。
  // どちらか片方を変更したら本配列も同時更新すること。
  const BACKEND_REFERENCE = [
    '#dcfce7', // green
    '#dbeafe', // blue
    '#fef9c3', // yellow
    '#e5e7eb', // gray
    '#ecfccb', // lime
    '#ffedd5', // orange
    '#fef3c7', // amber
    '#f3e4ff', // purple
    '#e0f2fe', // sky
  ] as const

  it('frontend palette matches backend reference', () => {
    expect(GROUP_PRESETS.map((p) => p.hex.toLowerCase())).toEqual(
      BACKEND_REFERENCE.map((h) => h.toLowerCase()),
    )
  })
})
