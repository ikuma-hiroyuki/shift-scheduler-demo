import type { ReorderState } from '../../stores/reorderStore'

interface Props {
  /** 対象 store の hook (例: useEmployeeReorderStore) */
  useStore: () => ReorderState
  /** 「並び替え対象」のラベル (例: "従業員", "グループ", "作業パターン") */
  label: string
  /** 「確定」押下時に呼ぶ。draftOrder を引数で受け取る。 */
  onCommit: (draftOrder: number[]) => Promise<void> | void
}

/**
 * 並び替えモード中、画面上端に sticky で出すバー。
 * - hasPending 件数表示
 * - キャンセル: 確認モーダル無し (上位ページでハンドリング推奨だが、本実装は即破棄)
 * - 確定: onCommit を呼び、committing フラグで押下不可に
 */
export default function ReorderCommitBar({ useStore, label, onCommit }: Props) {
  const mode = useStore().mode
  const draftOrder = useStore().draftOrder
  const committing = useStore().committing
  const hasPending = useStore().hasPending()
  const exit = useStore().exit
  const setCommitting = useStore().setCommitting

  if (mode !== 'reorder') return null

  async function handleCommit() {
    setCommitting(true)
    try {
      await onCommit(draftOrder)
    } finally {
      setCommitting(false)
    }
  }

  return (
    <div className="sticky top-0 z-40 -mx-8 px-8 py-3 bg-brand-900 text-cream-50 shadow-md flex items-center gap-4">
      <div className="flex items-baseline gap-2">
        <span
          className="text-[10px] tracking-[0.3em] uppercase text-brand-600"
          style={{ fontFamily: 'var(--font-mono)' }}
        >
          Reorder · {label}
        </span>
        <span className="text-xs text-cream-50/70">
          {hasPending ? '未保存の並び替えあり' : '変更なし'}
        </span>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={exit}
          disabled={committing}
          className="px-4 py-1.5 text-xs tracking-wider uppercase text-cream-50/80 hover:text-cream-50 hover:bg-cream-50/10 rounded-sm transition-colors disabled:opacity-40"
          style={{ fontFamily: 'var(--font-mono)' }}
        >
          キャンセル
        </button>
        <button
          type="button"
          onClick={handleCommit}
          disabled={committing || !hasPending}
          className="px-5 py-1.5 text-xs tracking-wider uppercase bg-brand-600 text-white hover:bg-brand-600/90 rounded-sm transition-colors disabled:opacity-40"
          style={{ fontFamily: 'var(--font-mono)' }}
        >
          {committing ? '保存中…' : '確定'}
        </button>
      </div>
    </div>
  )
}
