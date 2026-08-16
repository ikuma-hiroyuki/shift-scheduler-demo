import { useEffect, useState } from 'react'
import type { User } from '../../types/api'
import ModalShell from '../common/ModalShell'
import { useDirtyDiscardConfirm } from '../../hooks/useDirtyDiscardConfirm'

interface Props {
  mode: 'create' | 'edit'
  initial: User | null
  /** 編集対象が「自分」かつ「最後の admin」なら is_admin OFF を不可にする */
  disableAdminToggle?: boolean
  onClose: () => void
  onSubmit: (payload: {
    email: string
    password?: string
    is_active: boolean
    is_admin: boolean
  }) => Promise<void>
}

export default function UserFormModal({
  mode,
  initial,
  disableAdminToggle = false,
  onClose,
  onSubmit,
}: Props) {
  // `useState(() => ...)` で初期値を同期取得し、useDirtyDiscardConfirm の baseline と一致させる。
  // `useEffect` で setX(initial.x) する形だと、render1=空 → render2=hydrated となり baseline が
  // 空状態を捕まえて edit-mode 起動時に即 dirty=true になる ( = Esc で常に確認ダイアログ)。
  const [email, setEmail] = useState(() => initial?.email ?? '')
  const [password, setPassword] = useState('')
  const [isActive, setIsActive] = useState(() => initial?.is_active ?? true)
  const [isAdmin, setIsAdmin] = useState(() => initial?.is_admin ?? false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  // initial が後から差し替わるレアケースに備える (通常は親が modal を unmount → 再 mount するので不要)
  useEffect(() => {
    if (initial) {
      setEmail(initial.email)
      setIsActive(initial.is_active)
      setIsAdmin(initial.is_admin)
    }
  }, [initial])

  const { attemptClose, dialog: discardDialog } = useDirtyDiscardConfirm({
    values: { email, password, isActive, isAdmin },
    onClose,
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    if (!email.trim()) {
      setErr('メールアドレスを入力してください')
      return
    }
    if (mode === 'create' && !password) {
      setErr('パスワードを入力してください')
      return
    }
    setBusy(true)
    try {
      const payload: {
        email: string
        password?: string
        is_active: boolean
        is_admin: boolean
      } = {
        email: email.trim(),
        is_active: isActive,
        is_admin: isAdmin,
      }
      if (password) payload.password = password
      await onSubmit(payload)
      onClose()
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: unknown } } })?.response?.data
        ?.detail
      setErr(typeof msg === 'string' ? msg : '保存に失敗しました')
    } finally {
      setBusy(false)
    }
  }

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
            {mode === 'create' ? 'ユーザーを追加' : 'ユーザーを編集'}
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
              メールアドレス
            </span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-transparent border-0 border-b border-ink/30 focus:border-brand-600 focus:outline-none px-0 py-1.5 text-base"
              required
              autoComplete="off"
            />
          </label>

          <label className="block">
            <span
              className="text-[11px] tracking-widest uppercase text-ink-muted block mb-1.5"
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              パスワード
              {mode === 'edit' && (
                <span className="ml-2 normal-case tracking-normal text-ink-muted/70 lowercase">
                  (空欄なら変更しない)
                </span>
              )}
            </span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-transparent border-0 border-b border-ink/30 focus:border-brand-600 focus:outline-none px-0 py-1.5 text-base"
              autoComplete="new-password"
              placeholder={mode === 'edit' ? '変更しない場合は空欄' : ''}
              required={mode === 'create'}
            />
          </label>

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="w-4 h-4 accent-brand-600"
            />
            <span className="text-sm text-ink">有効 (ログイン可能)</span>
          </label>

          <label
            className={`flex items-center gap-3 ${
              disableAdminToggle ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
            }`}
            title={
              disableAdminToggle
                ? '最後の管理者は降格できません'
                : undefined
            }
          >
            <input
              type="checkbox"
              checked={isAdmin}
              onChange={(e) => setIsAdmin(e.target.checked)}
              disabled={disableAdminToggle && isAdmin}
              className="w-4 h-4 accent-brand-600"
            />
            <span className="text-sm text-ink">管理者 (全権)</span>
          </label>

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
