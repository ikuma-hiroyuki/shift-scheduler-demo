import { useState } from 'react'
import { importEmployeesCsv } from '../../api/employees'
import type { EmployeeImportResult } from '../../types/api'
import CsvUploadShell from '../common/CsvUploadShell'
import Stat from '../common/Stat'
import { extractApiError } from '../../utils/apiError'

interface Props {
  departmentId: number
  onImported: () => void
}

export default function EmployeeCsvUpload({ departmentId, onImported }: Props) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<EmployeeImportResult | null>(null)
  const [error, setError] = useState('')

  async function handleFile(file: File) {
    if (!file.name.endsWith('.csv')) {
      setError('CSV ファイルを選択してください')
      return
    }
    setError('')
    setBusy(true)
    try {
      const r = await importEmployeesCsv(file, departmentId)
      setResult(r)
      onImported()
    } catch (e: unknown) {
      setError(extractApiError(e, 'インポートに失敗しました'))
      setResult(null)
    } finally {
      setBusy(false)
    }
  }

  const headerRight = (
    <>
      <a
        href={
          'data:text/csv;charset=utf-8,%EF%BB%BF' +
          encodeURIComponent(
            'employee_number,name,role,available_days,available_shift_types,consecutive_workable\n',
          )
        }
        download="employees_template.csv"
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
        Bulk · Upsert
      </span>
    </>
  )

  return (
    <CsvUploadShell
      title="CSV 一括インポート"
      headerRight={headerRight}
      dropLabel="employees.csv をドロップ、またはクリックして選択"
      dropSubLabel="employee_number · name · role · available_days · …"
      busy={busy}
      onFile={handleFile}
      error={error}
    >
      {result && (
        <div className="mt-4 border border-ink/10 rounded-sm overflow-hidden">
          <div className="grid grid-cols-3 divide-x divide-ink/10">
            <Stat label="Created" value={result.created} tone="text-brand-900" />
            <Stat label="Updated" value={result.updated} tone="text-brand-600" />
            <Stat
              label="Moved"
              value={result.moved}
              tone={result.moved > 0 ? 'text-[#a83232]' : 'text-ink-muted/50'}
              title="既存の社員番号が別部署に紐付いていたため、選択中の部署に付け替えた件数（updated に内包）"
            />
          </div>
          {result.moved > 0 && (
            <div className="border-t border-ink/10 px-5 py-2.5 bg-brand-600/5">
              <p className="text-[11px] text-[#7a4a1a] leading-relaxed">
                <strong>{result.moved} 名</strong>の社員番号は別部署に登録済みでした。選択中の部署へ付け替えました。意図しない場合は CSV と部署選択を確認してください。
              </p>
            </div>
          )}
          {result.errors.length > 0 && (
            <div className="border-t border-ink/10 px-5 py-3 bg-[#a83232]/5">
              <div
                className="text-[10px] tracking-[0.25em] uppercase text-[#a83232] mb-1.5"
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                Errors · {result.errors.length}
              </div>
              <ul className="space-y-0.5 max-h-32 overflow-y-auto">
                {result.errors.map((e, i) => (
                  <li
                    key={i}
                    className="text-xs text-[#a83232]"
                    style={{ fontFamily: 'var(--font-mono)' }}
                  >
                    {e}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </CsvUploadShell>
  )
}
