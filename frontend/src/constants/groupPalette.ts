// 作業パターングループの preset 色。
// 変更時は以下 3 箇所を同期:
//  - app/schemas/work_pattern.py のデフォルト値
//  - app/migrations/versions/0006_add_color_to_work_pattern_groups.py の _PRESET_HEX
//  - app/scripts/seed.py の _GROUP_COLOR_PRESETS

export interface GroupColorPreset {
  key: string
  label: string
  hex: string
}

export const GROUP_PRESETS: ReadonlyArray<GroupColorPreset> = [
  { key: 'green', label: '緑', hex: '#dcfce7' },
  { key: 'blue', label: '青', hex: '#dbeafe' },
  { key: 'yellow', label: '黄', hex: '#fef9c3' },
  { key: 'gray', label: '灰', hex: '#e5e7eb' },
  { key: 'lime', label: '萌', hex: '#ecfccb' },
  { key: 'orange', label: '橙', hex: '#ffedd5' },
  { key: 'amber', label: '琥', hex: '#fef3c7' },
  { key: 'purple', label: '紫', hex: '#f3e4ff' },
  { key: 'sky', label: '空', hex: '#e0f2fe' },
] as const

export const DEFAULT_GROUP_COLOR = GROUP_PRESETS[0].hex

const HEX_RE = /^#[0-9a-fA-F]{6}$/

export function isHexColor(value: string): boolean {
  return HEX_RE.test(value)
}

// WCAG relative luminance + コントラスト比 4.5:1 で白(#ffffff) / 濃灰(#1f2937) を選択。
// sRGB 値を linear-light に変換してから 0.2126 R + 0.7152 G + 0.0722 B で輝度算出。
// (https://www.w3.org/TR/WCAG21/#dfn-relative-luminance)
const TEXT_LIGHT = '#ffffff'
const TEXT_DARK = '#1f2937'

function srgbToLinear(c: number): number {
  const v = c / 255
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

function relativeLuminance(hex: string): number {
  const r = srgbToLinear(parseInt(hex.slice(1, 3), 16))
  const g = srgbToLinear(parseInt(hex.slice(3, 5), 16))
  const b = srgbToLinear(parseInt(hex.slice(5, 7), 16))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrastRatio(lumA: number, lumB: number): number {
  const lighter = Math.max(lumA, lumB)
  const darker = Math.min(lumA, lumB)
  return (lighter + 0.05) / (darker + 0.05)
}

// 背景に対して WCAG AA (4.5:1) を満たす方を選択。両方満たさない場合は
// より高コントラストな方を返す(custom picker で中間色を選んでも実害最小化)。
export function readableTextColor(bgHex: string): string {
  if (!isHexColor(bgHex)) return TEXT_DARK
  const bgLum = relativeLuminance(bgHex)
  const lightLum = relativeLuminance(TEXT_LIGHT)
  const darkLum = relativeLuminance(TEXT_DARK)
  const lightContrast = contrastRatio(bgLum, lightLum)
  const darkContrast = contrastRatio(bgLum, darkLum)
  return darkContrast >= lightContrast ? TEXT_DARK : TEXT_LIGHT
}

// 既存グループで使用されていない preset の最初の hex を返す。
// 全 preset 使い切り時は先頭(緑)。
export function suggestUnusedPresetColor(usedColors: Iterable<string>): string {
  const used = new Set(Array.from(usedColors).map((c) => c.toLowerCase()))
  for (const p of GROUP_PRESETS) {
    if (!used.has(p.hex.toLowerCase())) return p.hex
  }
  return GROUP_PRESETS[0].hex
}
