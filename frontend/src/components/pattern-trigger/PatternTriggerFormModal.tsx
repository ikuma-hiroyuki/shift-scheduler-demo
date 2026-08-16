import { useEffect, useMemo, useState } from 'react'
import type { PatternTrigger, WorkPatternGroup } from '../../types/api'
import ModalShell from '../common/ModalShell'
import { useDirtyDiscardConfirm } from '../../hooks/useDirtyDiscardConfirm'

interface Props {
  mode: 'create' | 'edit'
  initial: PatternTrigger | null
  groups: WorkPatternGroup[]
  onClose: () => void
  /**
   * 補助グループ単一 + 必須グループ複数を payload で渡す。
   * department_id はページ側で付与する。
   */
  onSubmit: (payload: {
    auxiliary_group_id: number
    required_group_ids: number[]
  }) => Promise<void>
}

export default function PatternTriggerFormModal({
  mode,
  initial,
  groups,
  onClose,
  onSubmit,
}: Props) {
  const [auxId, setAuxId] = useState<number | null>(null)
  const [requiredIds, setRequiredIds] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  // groups は親が新しい配列参照で渡してくるため、useMemo で「中身一致 → 同一参照」に正規化する。
  // これをしないと filter 結果も毎レンダ新参照になり、useEffect の dep 比較で常に dirty 判定 →
  // initial がある場合に setRequiredIds(new Set(...)) を毎度呼んで無限再レンダループに入る。
  const groupKey = groups.map((g) => `${g.id}:${g.is_auxiliary}`).join(',')
  const auxGroups = useMemo(
    () => groups.filter((g) => g.is_auxiliary),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groupKey],
  )
  const reqGroups = useMemo(
    () => groups.filter((g) => !g.is_auxiliary),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groupKey],
  )

  useEffect(() => {
    if (initial) {
      setAuxId(initial.auxiliary_group_id)
      setRequiredIds(new Set(initial.required_group_ids))
    } else if (auxGroups.length > 0) {
      setAuxId(auxGroups[0].id)
    }
  }, [initial, auxGroups])

  const { attemptClose, dialog: discardDialog } = useDirtyDiscardConfirm({
    values: { auxId, requiredIds: Array.from(requiredIds).sort() },
    onClose,
  })

  function toggleRequired(gid: number) {
    setRequiredIds((prev) => {
      const next = new Set(prev)
      if (next.has(gid)) next.delete(gid)
      else next.add(gid)
      return next
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    if (auxId == null) {
      setErr('補助グループを選択してください')
      return
    }
    if (requiredIds.size === 0) {
      setErr('必須グループを 1 つ以上選択してください')
      return
    }
    if (requiredIds.has(auxId)) {
      setErr('補助グループは必須グループに含められません')
      return
    }

    setBusy(true)
    try {
      await onSubmit({
        auxiliary_group_id: auxId,
        required_group_ids: Array.from(requiredIds),
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
            {mode === 'create' ? '発生条件を追加' : '発生条件を編集'}
          </h2>
          <span
            className="text-[10px] tracking-[0.3em] uppercase text-brand-600"
            style={{ fontFamily: 'var(--font-mono)' }}
          >
            {mode === 'create' ? 'New' : 'Edit'}
          </span>
        </div>

        <div className="px-7 py-5 space-y-5">
          <div>
            <span
              className="text-[11px] tracking-widest uppercase text-ink-muted block mb-1.5"
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              補助グループ
            </span>
            {auxGroups.length === 0 ? (
              <p className="text-xs text-[#a83232]">
                補助グループ (is_auxiliary=true) が部門に存在しません
              </p>
            ) : (
              <select
                value={auxId ?? ''}
                onChange={(e) => setAuxId(Number(e.target.value))}
                className="w-full bg-transparent border-0 border-b border-ink/30 focus:border-brand-600 focus:outline-none px-0 py-1.5 text-base"
              >
                {auxGroups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            )}
            <p className="mt-2 text-[11px] text-ink-muted leading-relaxed">
              この補助グループに属する作業パターンは、下で選択した必須グループが
              全員埋まる日にのみ割当可能になります（H12 制約）。
            </p>
          </div>

          <div>
            <span
              className="text-[11px] tracking-widest uppercase text-ink-muted block mb-2"
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              必須グループ（複数選択）
            </span>
            {reqGroups.length === 0 ? (
              <p className="text-xs text-ink-muted">
                先に通常グループを作成してください
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto border border-ink/10 rounded-sm p-2">
                {reqGroups.map((g) => (
                  <button
                    type="button"
                    key={g.id}
                    onClick={() => toggleRequired(g.id)}
                    className={`px-3 py-1.5 text-xs rounded-sm border transition-all ${
                      requiredIds.has(g.id)
                        ? 'bg-brand-600 text-white border-brand-600'
                        : 'bg-transparent text-ink border-ink/20 hover:border-ink/50'
                    }`}
                  >
                    {g.name}
                  </button>
                ))}
              </div>
            )}
            <p className="mt-2 text-[11px] text-ink-muted leading-relaxed">
              選んだグループ全員に作業パターンが割当られた日のみ、補助グループも稼働できます。
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
