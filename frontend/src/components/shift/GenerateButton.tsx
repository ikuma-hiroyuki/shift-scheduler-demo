import { useState } from 'react'
import { generateSchedule } from '../../api/schedules'
import type { Schedule } from '../../types/api'

interface Props {
  departmentId: number
  year: number
  month: number
  disabled: boolean
  onGenerated: (schedule: Schedule) => void
}

export default function GenerateButton({
  departmentId,
  year,
  month,
  disabled,
  onGenerated,
}: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleClick() {
    setError('')
    setLoading(true)
    try {
      const schedule = await generateSchedule(departmentId, year, month)
      onGenerated(schedule)
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        '稼働表生成の開始に失敗しました'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <button
        onClick={handleClick}
        disabled={disabled || loading}
        className="w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium rounded-lg py-2.5 px-4 text-sm transition-colors"
      >
        {loading
          ? '処理中...'
          : disabled
            ? '生成中...'
            : `稼働表自動作成 ${year}年${month}月`}
      </button>
      {error && (
        <p className="mt-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
    </div>
  )
}
