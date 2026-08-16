import { useEffect, useRef, useState } from 'react'
import type { WorkPatternGroup } from '../../types/api'
import ModalShell from '../common/ModalShell'
import { useDirtyDiscardConfirm } from '../../hooks/useDirtyDiscardConfirm'
import {
  GROUP_PRESETS,
  isHexColor,
  suggestUnusedPresetColor,
} from '../../constants/groupPalette'

interface Props {
  mode: 'create' | 'edit'
  initial: WorkPatternGroup | null
  // 既存グループ群(未使用色提案 + custom hex 同色判定に使用)
  existingGroups?: WorkPatternGroup[]
  onClose: () => void
  onSubmit: (payload: {
    name: string
    is_auxiliary: boolean
    color: string
  }) => Promise<void>
}

export default function WorkPatternGroupFormModal({
  mode,
  initial,
  existingGroups = [],
  onClose,
  onSubmit,
}: Props) {
  const [name, setName] = useState(() => initial?.name ?? '')
  const [isAux, setIsAux] = useState(() => initial?.is_auxiliary ?? false)
  const [color, setColor] = useState<string>(() => {
    // backend が常に valid hex を返す前提 (migration 0006 で全行 backfill 済み)
    if (initial) return initial.color
    const used = existingGroups.map((g) => g.color).filter(Boolean)
    return suggestUnusedPresetColor(used)
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  // 9 swatch ボタンの ref (キーボード roving tabindex 用)
  const swatchRefs = useRef<Array<HTMLButtonElement | null>>([])

  // initial が後から変わった場合(同じモーダルインスタンス内で別行を編集した時など)に
  // 再同期する。existingGroups の参照変化では再リセットしない(色のユーザー編集を保護)。
  useEffect(() => {
    if (initial) {
      setName(initial.name)
      setIsAux(initial.is_auxiliary)
      setColor(initial.color)
    }
  }, [initial])

  const { attemptClose, dialog: discardDialog } = useDirtyDiscardConfirm({
    values: { name, isAux, color },
    onClose,
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    if (!name.trim()) {
      setErr('グループ名を入力してください')
      return
    }
    if (!isHexColor(color)) {
      setErr('色は #RRGGBB 形式で指定してください')
      return
    }
    setBusy(true)
    try {
      // ブラウザ依存で <input type="color"> が大文字を返す環境があるため、
      // DB に #DCFCE7 / #dcfce7 が混在しないよう submit 時に lowercase 統一。
      await onSubmit({
        name: name.trim(),
        is_auxiliary: isAux,
        color: color.toLowerCase(),
      })
      onClose()
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
      setErr(typeof msg === 'string' ? msg : '保存に失敗しました')
    } finally {
      setBusy(false)
    }
  }

  const normalizedColor = color.toLowerCase()

  return (
    <ModalShell onClose={attemptClose} loading={busy}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        className="w-full max-w-md bg-cream-50 border border-ink/10 rounded-sm shadow-2xl"
        style={{ animation: 'modalIn 0.22s cubic-bezier(0.2, 0.8, 0.2, 1)' }}
      >
        <style>{`@keyframes modalIn { from { opacity: 0; transform: translateY(8px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }`}</style>

        <div className="px-7 pt-6 pb-4 border-b border-ink/10 flex items-baseline justify-between">
          <h2
            className="text-2xl font-medium text-brand-900"
            style={{ fontFamily: 'var(--font-display)', fontVariationSettings: '"opsz" 96' }}
          >
            {mode === 'create' ? 'グループを追加' : 'グループを編集'}
          </h2>
          <span
            className="text-[10px] tracking-[0.3em] uppercase text-brand-600"
            style={{ fontFamily: 'var(--font-mono)' }}
          >
            {mode === 'create' ? 'New' : 'Edit'}
          </span>
        </div>

        <div className="px-7 py-5 space-y-5">
          <label className="block">
            <span
              className="text-[11px] tracking-widest uppercase text-ink-muted block mb-1.5"
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              グループ名
            </span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例: A / B / 補助"
              className="w-full bg-transparent border-0 border-b border-ink/30 focus:border-brand-600 focus:outline-none px-0 py-1.5 text-base"
              required
              autoFocus
            />
          </label>

          <fieldset className="block">
            <legend
              className="text-[11px] tracking-widest uppercase text-ink-muted block mb-1.5"
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              色(稼働表詳細セル/凡例に反映)
            </legend>
            {/* WAI-ARIA radiogroup: 選択中のみ tabindex=0、Arrow キーで focus 移動 + 自動選択 */}
            <div role="radiogroup" aria-label="色プリセット" className="grid grid-cols-9 gap-2">
              {GROUP_PRESETS.map((p, i) => {
                const selected = p.hex.toLowerCase() === normalizedColor
                const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
                  let nextIdx: number | null = null
                  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                    nextIdx = (i + 1) % GROUP_PRESETS.length
                  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                    nextIdx = (i - 1 + GROUP_PRESETS.length) % GROUP_PRESETS.length
                  } else if (e.key === 'Home') {
                    nextIdx = 0
                  } else if (e.key === 'End') {
                    nextIdx = GROUP_PRESETS.length - 1
                  }
                  if (nextIdx !== null) {
                    e.preventDefault()
                    setColor(GROUP_PRESETS[nextIdx].hex)
                    swatchRefs.current[nextIdx]?.focus()
                  }
                }
                return (
                  <button
                    type="button"
                    key={p.key}
                    ref={(el) => {
                      swatchRefs.current[i] = el
                    }}
                    role="radio"
                    aria-checked={selected}
                    aria-label={p.label}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => setColor(p.hex)}
                    onKeyDown={handleKeyDown}
                    style={{ backgroundColor: p.hex }}
                    className={`h-8 rounded-sm border border-ink/20 transition-shadow ${
                      selected ? 'ring-2 ring-brand-600 ring-offset-1' : ''
                    }`}
                  />
                )
              })}
            </div>
            <div className="flex items-center gap-2 mt-3">
              <label className="flex items-center gap-2 text-[11px] text-ink-muted">
                <span style={{ fontFamily: 'var(--font-mono)' }}>カスタム</span>
                <input
                  type="color"
                  aria-label="カスタム色"
                  value={normalizedColor}
                  onChange={(e) => setColor(e.target.value)}
                  className="h-7 w-10 cursor-pointer border border-ink/20 rounded-sm bg-transparent p-0"
                />
              </label>
              <code
                className="text-[11px] text-ink-muted"
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                {normalizedColor}
              </code>
            </div>
          </fieldset>

          <div>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={isAux}
                onChange={(e) => setIsAux(e.target.checked)}
                className="w-4 h-4 accent-brand-600"
              />
              <span className="text-sm text-ink">補助ポジション</span>
            </label>
            <p className="text-[11px] text-ink-muted leading-relaxed mt-1.5 pl-7">
              ON にすると、他の主要グループが全員埋まったときだけ
              このグループの作業パターンが使われます。
              <br />
              例:B・D・E の枠が全員割当済みのときだけ C を発動する、など。
            </p>
          </div>

          {err && (
            <p className="text-xs text-[#a83232] bg-[#a83232]/8 border-l-2 border-[#a83232] px-3 py-2">
              {err}
            </p>
          )}
        </div>

        <div className="px-7 py-4 border-t border-ink/10 flex justify-end gap-2">
          <button
            type="button"
            onClick={attemptClose}
            className="px-4 py-2 text-sm text-ink-muted hover:text-ink transition-colors"
          >
            キャンセル
          </button>
          <button
            type="submit"
            disabled={busy}
            className="px-5 py-2 text-sm bg-brand-900 text-cream-50 hover:bg-[#1a2940] disabled:opacity-50 transition-colors rounded-sm"
          >
            {busy ? '保存中…' : '保存'}
          </button>
        </div>
      </form>
      {discardDialog}
    </ModalShell>
  )
}
