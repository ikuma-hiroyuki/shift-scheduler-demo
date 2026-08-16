import { useRoleStore } from '../stores/roles'

/**
 * デフォルト 5 役職のフォールバックラベル。
 * `useRoleStore` がまだロードされていない初回レンダー時に使う。
 * issue #173 で役職はマスタテーブル化されたため、これは保険として残す。
 */
export const DEFAULT_ROLE_LABEL: Record<string, string> = {
  CHIEF: '主任',
  DEPUTY: '副主任',
  STAFF: '一般',
  FULLPART: 'フルパート',
  MORNINGPART: '早朝パート',
}

/**
 * 既存コード互換のため `ROLE_LABEL` 名で再 export。
 * 5 役職以外のコードは含まれないので新規追加された役職には対応しない。
 * 動的役職への対応が必要な場合は `roleLabel()` 関数を使うこと。
 */
export const ROLE_LABEL = DEFAULT_ROLE_LABEL

/**
 * 役職コードから表示名を取得する。
 * 解決順: useRoleStore (API ロード済み) → DEFAULT_ROLE_LABEL → コードそのもの。
 * React コンポーネント外でも呼び出し可能（zustand getState を使うため）。
 */
export function roleLabel(code: string | undefined | null): string {
  if (!code) return ''
  const found = useRoleStore.getState().roles.find((r) => r.code === code)
  if (found) return found.name
  return DEFAULT_ROLE_LABEL[code] ?? code
}

const DEFAULT_ROLE_TONE: Record<string, string> = {
  CHIEF: 'bg-brand-600 text-white',
  DEPUTY: 'bg-[#3a6b6b] text-white',
  STAFF: 'bg-ink/8 text-ink',
  FULLPART: 'bg-[#7a5a3a]/15 text-[#7a5a3a]',
  MORNINGPART: 'bg-[#5a7a3a]/15 text-[#5a7a3a]',
}

const NEUTRAL_ROLE_TONE = 'bg-ink/8 text-ink'

/**
 * 役職コードから色テーマ (tailwind classes) を取得する。
 * デフォルト 5 役職には固有色、未知のカスタム役職は中立色。
 */
export function roleTone(code: string | undefined | null): string {
  if (!code) return NEUTRAL_ROLE_TONE
  return DEFAULT_ROLE_TONE[code] ?? NEUTRAL_ROLE_TONE
}
