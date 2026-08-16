interface StatProps {
  label: string
  value: number
  tone: string
  title?: string
}

export default function Stat({ label, value, tone, title }: StatProps) {
  return (
    <div className="px-4 py-3" title={title}>
      <div
        className="text-[10px] tracking-[0.25em] uppercase text-ink-muted"
        style={{ fontFamily: 'var(--font-mono)' }}
      >
        {label}
      </div>
      <div
        className={`text-2xl font-medium mt-1 ${tone}`}
        style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}
      >
        {value}
      </div>
    </div>
  )
}
