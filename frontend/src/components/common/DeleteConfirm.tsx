import ConfirmDialog from './ConfirmDialog'

interface Props {
  title: string
  desc: string
  loading: boolean
  onCancel: () => void
  onConfirm: () => void
}

/**
 * 削除確認ダイアログ。`ConfirmDialog`（tone='delete'）の薄いラッパー。
 * 新規実装は `ConfirmDialog` を直接使うことを推奨。
 */
export default function DeleteConfirm({
  title,
  desc,
  loading,
  onCancel,
  onConfirm,
}: Props) {
  return (
    <ConfirmDialog
      tone="delete"
      title={title}
      description={desc}
      loading={loading}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  )
}
