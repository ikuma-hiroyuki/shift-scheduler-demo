import { useState } from 'react'
import { importRoster } from '../../api/imports'
import type { ImportResult } from '../../types/api'
import ConfirmDialog from '../common/ConfirmDialog'
import CsvUploadShell from '../common/CsvUploadShell'
import Stat from '../common/Stat'
import { extractApiError } from '../../utils/apiError'

interface Props {
  departmentId: number
  year: number
  month: number
  onImported: (result: ImportResult) => void
}

interface PendingUpload {
  file: File
  year: number
  month: number
}

export default function LeaveCsvUpload({
  departmentId,
  year,
  month,
  onImported,
}: Props) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState('')
  const [pending, setPending] = useState<PendingUpload | null>(null)

  function handleFile(file: File) {
    if (!file.name.endsWith('.csv')) {
      setError('CSV ファイルを選択してください')
      return
    }
    setError('')
    setPending({ file, year, month })
  }

  async function handleConfirmUpload() {
    if (!pending) return
    setBusy(true)
    try {
      const r = await importRoster(pending.file, departmentId, pending.year, pending.month)
      setResult(r)
      onImported(r)
    } catch (e: unknown) {
      setError(extractApiError(e, 'インポートに失敗しました'))
      setResult(null)
    } finally {
      setBusy(false)
      setPending(null)
    }
  }

  const headerRight = (
    <>
      <a
        href={
          'data:text/csv;charset=utf-8,%EF%BB%BF' +
          encodeURIComponent('氏名,役職,従業員番号,日付,休日区分\n')
        }
        download="leave_requests_template.csv"
        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] tracking-[0.25em] uppercase text-brand-600 border border-brand-600/40 hover:bg-brand-600 hover:text-white hover:border-brand-600 rounded-sm transition-colors"
        style={{ fontFamily: 'var(--font-mono)' }}
        title="ヘッダーのみのサンプル CSV をダウンロード"
      >
        <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 4v12m0 0l-4-4m4 4l4-4" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M4 19h16" strokeLinecap="round" />
        </svg>
        Template
      </a>
      <span
        className="text-[10px] tracking-[0.3em] uppercase text-brand-600"
        style={{ fontFamily: 'var(--font-mono)' }}
      >
        Overwrite · {year}/{String(month).padStart(2, '0')}
      </span>
    </>
  )

  return (
    <>
      <CsvUploadShell
        title="休日 CSV を読み込む"
        headerRight={headerRight}
        dropLabel="休日 CSV をドロップ、またはクリックして選択"
        dropSubLabel="従業員番号 · 日付 · 休日区分 (1=●/2=○/3=有給)"
        busy={busy}
        onFile={handleFile}
        error={error}
      >
        {result && (
          <div className="mt-4 border border-ink/10 rounded-sm overflow-hidden">
            <div className="grid grid-cols-4 divide-x divide-ink/10">
              <Stat label="Year" value={result.year} tone="text-brand-900" />
              <Stat label="Month" value={result.month} tone="text-brand-900" />
              <Stat label="Created" value={result.created} tone="text-brand-600" />
              <Stat
                label="Skipped"
                value={result.skipped}
                tone={result.skipped > 0 ? 'text-ink-muted' : 'text-ink-muted/50'}
              />
            </div>
          </div>
        )}
      </CsvUploadShell>

      {pending && (
        <ConfirmDialog
          tone="warning"
          kicker="Overwrite"
          title="希望休データを上書きしますか？"
          description={
            <p>
              <strong className="text-brand-900">{pending.year}年{pending.month}月</strong>
              {' '}の希望休データを全て削除して
              <strong className="text-brand-900">{pending.file.name}</strong>
              {' '}の内容で上書きします。この操作は元に戻せません。
            </p>
          }
          confirmLabel="上書きする"
          loading={busy}
          loadingLabel="アップロード中…"
          onCancel={() => setPending(null)}
          onConfirm={handleConfirmUpload}
        />
      )}
    </>
  )
}
