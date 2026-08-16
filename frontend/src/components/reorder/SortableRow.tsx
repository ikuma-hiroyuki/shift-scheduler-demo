import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { CSSProperties, HTMLAttributes, ReactNode } from 'react'

export interface SortableHandleProps {
  /** ハンドル要素にスプレッドする props (drag listeners + aria) */
  attributes: HTMLAttributes<HTMLElement>
  listeners: Record<string, unknown> | undefined
  isDragging: boolean
}

interface Props {
  id: number
  disabled?: boolean
  children: (handle: SortableHandleProps) => ReactNode
  /**
   * 行コンテナの tag (table 内で使うときは "tr"、ul の中なら "li" など)
   */
  as?: 'tr' | 'li' | 'div'
  className?: string
}

/**
 * 行ラッパー。dnd-kit の useSortable をかけ、ハンドル props を render-prop で
 * 子に渡す。disabled=true 時は通常の DOM 要素として描画する。
 */
export default function SortableRow({
  id,
  disabled = false,
  children,
  as = 'tr',
  className,
}: Props) {
  const sortable = useSortable({ id, disabled })
  const {
    setNodeRef,
    transform,
    transition,
    isDragging,
    attributes,
    listeners,
  } = sortable

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
    background: isDragging ? 'var(--reorder-dragging-bg, #fef3c7)' : undefined,
    boxShadow: isDragging ? '0 6px 18px rgba(0,0,0,0.15)' : undefined,
    zIndex: isDragging ? 10 : undefined,
  }

  const handleProps: SortableHandleProps = {
    attributes,
    listeners,
    isDragging,
  }

  if (as === 'tr') {
    return (
      <tr ref={setNodeRef} style={style} className={className}>
        {children(handleProps)}
      </tr>
    )
  }
  if (as === 'li') {
    return (
      <li ref={setNodeRef} style={style} className={className}>
        {children(handleProps)}
      </li>
    )
  }
  return (
    <div ref={setNodeRef} style={style} className={className}>
      {children(handleProps)}
    </div>
  )
}

/**
 * 共通ドラッグハンドル UI (≡ 縦の握り)。
 * 44×44 タッチ領域、aria-label、focus visible 対応。
 */
export function DragHandle({
  attributes,
  listeners,
  disabled,
}: {
  attributes: HTMLAttributes<HTMLElement>
  listeners: Record<string, unknown> | undefined
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      {...attributes}
      {...(listeners as Record<string, unknown>)}
      disabled={disabled}
      aria-label="並び順を変更"
      className="inline-flex items-center justify-center w-11 h-11 text-ink-muted hover:text-brand-600 cursor-grab active:cursor-grabbing focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 rounded-sm disabled:opacity-30 disabled:cursor-not-allowed"
    >
      <svg
        viewBox="0 0 16 16"
        width="16"
        height="16"
        fill="currentColor"
        aria-hidden="true"
      >
        <circle cx="5" cy="3" r="1.4" />
        <circle cx="5" cy="8" r="1.4" />
        <circle cx="5" cy="13" r="1.4" />
        <circle cx="11" cy="3" r="1.4" />
        <circle cx="11" cy="8" r="1.4" />
        <circle cx="11" cy="13" r="1.4" />
      </svg>
    </button>
  )
}
