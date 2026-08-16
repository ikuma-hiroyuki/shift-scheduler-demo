import { useRef, useState, type ReactNode } from 'react'

interface CsvUploadShellProps {
  title: string
  headerRight?: ReactNode
  dropLabel: string
  dropSubLabel: string
  busy: boolean
  onFile: (f: File) => void | Promise<void>
  error?: string
  children?: ReactNode
}

export default function CsvUploadShell({
  title,
  headerRight,
  dropLabel,
  dropSubLabel,
  busy,
  onFile,
  error,
  children,
}: CsvUploadShellProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [drag, setDrag] = useState(false)

  return (
    <div className="bg-cream-50 border border-ink/10 rounded-sm">
      <div className="px-6 py-2 border-b border-ink/10 flex items-baseline justify-between">
        <h3
          className="text-base font-medium text-brand-900"
          style={{ fontFamily: 'var(--font-display)', fontVariationSettings: '"opsz" 96' }}
        >
          {title}
        </h3>
        {headerRight && <div className="flex items-center gap-3">{headerRight}</div>}
      </div>

      <div className="p-3">
        <div
          role="button"
          tabIndex={busy ? -1 : 0}
          aria-disabled={busy}
          aria-label={dropLabel}
          onClick={() => !busy && inputRef.current?.click()}
          onKeyDown={(e) => {
            if (busy) return
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              inputRef.current?.click()
            }
          }}
          onDragOver={(e) => {
            e.preventDefault()
            setDrag(true)
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDrag(false)
            const f = e.dataTransfer.files[0]
            if (f) onFile(f)
          }}
          className={`relative border border-dashed rounded-sm px-6 py-4 text-center cursor-pointer transition-all ${
            drag
              ? 'border-brand-600 bg-brand-600/5'
              : 'border-ink/25 hover:border-ink/50 bg-transparent'
          } ${busy ? 'opacity-60 cursor-wait' : ''}`}
          style={{
            backgroundImage: drag
              ? 'repeating-linear-gradient(45deg, transparent, transparent 8px, rgba(196,123,58,0.06) 8px, rgba(196,123,58,0.06) 16px)'
              : 'none',
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) onFile(f)
              e.target.value = ''
            }}
          />
          <div className="flex flex-col items-center gap-2">
            <svg
              viewBox="0 0 24 24"
              className="w-7 h-7 text-brand-600"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M12 4v12m0 0l-4-4m4 4l4-4" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M4 19h16" strokeLinecap="round" />
            </svg>
            {busy ? (
              <p className="text-sm text-ink-muted">読み込み中…</p>
            ) : (
              <>
                <p className="text-sm text-ink font-medium">{dropLabel}</p>
                <p
                  className="text-[11px] text-ink-muted tracking-wider"
                  style={{ fontFamily: 'var(--font-mono)' }}
                >
                  {dropSubLabel}
                </p>
              </>
            )}
          </div>
        </div>

        {children}

        {error && (
          <p className="mt-3 text-xs text-[#a83232] bg-[#a83232]/8 border-l-2 border-[#a83232] px-3 py-2">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
