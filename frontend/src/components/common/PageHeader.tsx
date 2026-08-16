import type { ReactNode } from 'react'

interface PageHeaderProps {
  title: string
  description?: string
  kicker?: string
  rightSlot?: ReactNode
}

export default function PageHeader({
  title,
  description,
  kicker,
  rightSlot,
}: PageHeaderProps) {
  return (
    <header className="flex items-end justify-between mb-10 pb-6 border-b border-ink/10">
      <div>
        {kicker && (
          <span
            className="text-[10px] tracking-[0.3em] uppercase text-brand-600 block"
            style={{ fontFamily: 'var(--font-mono)' }}
          >
            {kicker}
          </span>
        )}
        <h1
          className="text-5xl font-normal text-brand-900 leading-none"
          style={{
            fontFamily: 'var(--font-display)',
            fontVariationSettings: '"opsz" 144, "wght" 500',
            letterSpacing: '-0.02em',
          }}
        >
          {title}
          <span className="text-brand-600">.</span>
        </h1>
        {description && (
          <p className="text-sm text-ink-muted mt-3">{description}</p>
        )}
      </div>
      {rightSlot && <div className="text-right">{rightSlot}</div>}
    </header>
  )
}
