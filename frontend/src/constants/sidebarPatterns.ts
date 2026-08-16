/**
 * 左サイドバー背景の和柄パターン定義。
 *
 * パターンは `bg-brand-500` の上に重ねるため、SVG 内の塗りはすべて
 * `white` + `fill-opacity` の半透明で統一している。背景色（grey #cccccc 等）
 * は除去してある。`backgroundImage` の data URI として使用する。
 */

export type SidebarPatternId =
  | 'none'
  | 'asanoha'
  | 'seigaiha'
  | 'sayagata'
  | 'shippo'
  | 'honeycomb'

export interface SidebarPattern {
  id: SidebarPatternId
  label: string
  /** Raw SVG markup for the tile. `none` のときは空文字列。 */
  svg: string
}

const ASANOHA = `<svg xmlns='http://www.w3.org/2000/svg' width='70' height='40' viewBox='0 0 140 80' preserveAspectRatio='none'><path fill='white' fill-opacity='0.10' d='M4 1h42l21 36zM3 3l63 36h-42zM1 4l21 36-21 36zM3 77l21-36h42zM46 79h-42l63-36zM69 44v41h-24zM95 85h-24v-41zM73 43l63 36h-42zM74 41h42l21 36zM118 40l21-36v72zM137 3l-21 36h-42zM94 1h42l-63 36zM71 36v-41h24zM45-5h24v41z'/></svg>`

const SEIGAIHA = `<svg xmlns='http://www.w3.org/2000/svg' width='200' height='100' viewBox='0 0 120 60' preserveAspectRatio='none'><path fill='white' fill-opacity='0.10' d='M13.005 31.426a55 55 0 0 1 93.99 0 60 60 0 0 0-9.89 3.114 45 45 0 0 0-74.21 0 60 60 0 0 0-9.89-3.114zm14.499 5.249a40 40 0 0 1 64.992 0 60 60 0 0 0-8.496 5.325 30 30 0 0 0-48 0 60 60 0 0 0-8.496-5.325zm12.371 8.493a25 25 0 0 1 40.25 0 60 60 0 0 0-7.063 7.458 15 15 0 0 0-26.124 0 60 60 0 0 0-7.063-7.458zm10.477 12.202a10 10 0 0 1 19.296 0 60 60 0 0 0-1.897 3.133 60 60 0 0 0-15.502 0 60 60 0 0 0-1.897-3.133zM-46.995 61.426a55 55 0 0 1 93.99 0 60 60 0 0 0-9.89 3.114 45 45 0 0 0-74.21 0 60 60 0 0 0-9.89-3.114zm14.499 5.249a40 40 0 0 1 64.992 0 60 60 0 0 0-8.496 5.325 30 30 0 0 0-48 0 60 60 0 0 0-8.496-5.325zM73.005 61.426a55 55 0 0 1 93.99 0 60 60 0 0 0-9.89 3.114 45 45 0 0 0-74.21 0 60 60 0 0 0-9.89-3.114zm14.499 5.249a40 40 0 0 1 64.992 0 60 60 0 0 0-8.496 5.325 30 30 0 0 0-48 0 60 60 0 0 0-8.496-5.325zM-46.995 1.426a55 55 0 0 1 93.99 0 60 60 0 0 0-9.89 3.114 45 45 0 0 0-74.21 0 60 60 0 0 0-9.89-3.114zm14.499 5.249a40 40 0 0 1 64.992 0 60 60 0 0 0-8.496 5.325 30 30 0 0 0-48 0 60 60 0 0 0-8.496-5.325zm12.371 8.493a25 25 0 0 1 40.25 0 60 60 0 0 0-7.063 7.458 15 15 0 0 0-26.124 0 60 60 0 0 0-7.063-7.458zm10.477 12.202a10 10 0 0 1 19.296 0 60 60 0 0 0-1.897 3.133 60 60 0 0 0-15.502 0 60 60 0 0 0-1.897-3.133zM73.005 1.426a55 55 0 0 1 93.99 0 60 60 0 0 0-9.89 3.114 45 45 0 0 0-74.21 0 60 60 0 0 0-9.89-3.114zm14.499 5.249a40 40 0 0 1 64.992 0 60 60 0 0 0-8.496 5.325 30 30 0 0 0-48 0 60 60 0 0 0-8.496-5.325zm12.371 8.493a25 25 0 0 1 40.25 0 60 60 0 0 0-7.063 7.458 15 15 0 0 0-26.124 0 60 60 0 0 0-7.063-7.458zm10.477 12.202a10 10 0 0 1 19.296 0 60 60 0 0 0-1.897 3.133 60 60 0 0 0-15.502 0 60 60 0 0 0-1.897-3.133zM50.352-2.630a10 10 0 0 1 19.296 0 60 60 0 0 0-1.897 3.133 60 60 0 0 0-15.502 0 60 60 0 0 0-1.897-3.133z'/></svg>`

const SAYAGATA = `<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 10 10' preserveAspectRatio='none'><path fill='white' fill-opacity='0.10' d='m0-1 4 4 1-1-1-1 1-1 1 1 1-1 1 1-7 7-1-1 1-1-1-1 1-1 1 1 1-1-4-4m0 8 3 3h-3m11 0-4-4-1 1 1 1-1 1-1-1-1 1-1-1 7-7 1 1-1 1 1 1-1 1-1-1-1 1 4 4m0-8-3-3h3'/></svg>`

const SHIPPO = `<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80' viewBox='0 0 2 2' preserveAspectRatio='none'><path fill='white' fill-opacity='0.10' d='m1 0a1 1 0 0 1 0 2 1 1 0 0 1 0-2 1 1 0 0 1-1 1 1 1 0 0 1 1 1 1 1 0 0 1 1-1 1 1 0 0 1-1-1z'/></svg>`

// heropatterns.com hexagons (タイル前提の自己完結 SVG)
const KIKKO = `<svg xmlns='http://www.w3.org/2000/svg' width='56' height='98' viewBox='0 0 28 49'><g fill='white' fill-opacity='0.10' fill-rule='evenodd'><path d='M13.99 9.25l13 7.5v15l-13 7.5L1 31.75v-15l12.99-7.5zM3 17.9v12.7l10.99 6.34 11-6.35V17.9l-11-6.34L3 17.9zM0 15l12.98-7.5V0h-2v6.35L0 12.69v2.3zm0 18.5L12.98 41v8h-2v-6.85L0 35.81v-2.3zM15 0v7.5L27.99 15H28v-2.31h-.01L17 6.35V0h-2zm0 49v-8l12.99-7.5H28v2.31h-.01L17 42.15V49h-2z'/></g></svg>`

export const SIDEBAR_PATTERNS: SidebarPattern[] = [
  { id: 'none', label: 'なし', svg: '' },
  { id: 'asanoha', label: '麻の葉', svg: ASANOHA },
  { id: 'seigaiha', label: '青海波', svg: SEIGAIHA },
  { id: 'sayagata', label: '紗綾形', svg: SAYAGATA },
  { id: 'shippo', label: '七宝', svg: SHIPPO },
  { id: 'honeycomb', label: '亀甲', svg: KIKKO },
]

/**
 * SVG 文字列を CSS `url(...)` 用の base64 data URI に変換する。
 *
 * percent-encoding (`encodeURIComponent`) より base64 のほうが
 * (a) CSSOM 実装 (jsdom など) で受理されやすい、
 * (b) 圧縮後サイズが似通う、
 * という利点がある。SVG は ASCII のみなので `btoa` で問題ない。
 */
export function svgToDataUri(svg: string): string {
  // 安全のため Latin1 範囲外が混じった場合は encodeURIComponent → unescape で
  // バイト列に正規化してから base64 化する（将来の SVG 編集での事故を防ぐ）。
  const b64 =
    typeof btoa === 'function'
      ? btoa(unescape(encodeURIComponent(svg)))
      : Buffer.from(svg, 'utf-8').toString('base64')
  return `data:image/svg+xml;base64,${b64}`
}

/**
 * `backgroundImage` 用の URL 文字列を返す。`none` のときは `'none'`。
 * パターン id が未知の場合も `'none'`。
 */
export function patternBackgroundImage(id: SidebarPatternId): string {
  const p = SIDEBAR_PATTERNS.find((x) => x.id === id)
  if (!p || !p.svg) return 'none'
  return `url("${svgToDataUri(p.svg)}")`
}

/** プレビュー用に塗り/線の不透明度を上げた SVG を返す（ピッカー UI の小サムネ用）。 */
export function previewSvg(id: SidebarPatternId): string {
  const p = SIDEBAR_PATTERNS.find((x) => x.id === id)
  if (!p || !p.svg) return ''
  return p.svg
    .replace(/fill-opacity='[\d.]+'/g, "fill-opacity='0.45'")
    .replace(/stroke-opacity='[\d.]+'/g, "stroke-opacity='0.65'")
}
