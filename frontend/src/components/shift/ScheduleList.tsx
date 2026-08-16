import { useState } from 'react'
import { deleteSchedule, exportScheduleCsvLong, exportScheduleXlsx } from '../../api/schedules'
import type { Schedule } from '../../types/api'
import DeleteConfirm from '../common/DeleteConfirm'

interface Props {
  schedules: Schedule[]
  selectedId: number | null
  onSelect: (schedule: Schedule) => void
  onDeleted: (id: number) => void
}

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  DRAFT: { text: '処理待ち', cls: 'bg-gray-100 text-gray-600' },
  GENERATING: { text: '生成中', cls: 'bg-blue-100 text-blue-700' },
  GENERATED: { text: '生成済', cls: 'bg-green-100 text-green-700' },
  PARTIAL: { text: '部分生成', cls: 'bg-amber-100 text-amber-800' },
  INFEASIBLE: { text: '生成失敗', cls: 'bg-red-100 text-red-700' },
  CANCELLED: { text: '停止済', cls: 'bg-gray-100 text-gray-500' },
  PUBLISHED: { text: '公開済', cls: 'bg-purple-100 text-purple-700' },
}

function formatCreatedAt(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export default function ScheduleList({ schedules, selectedId, onSelect, onDeleted }: Props) {
  const [pendingDelete, setPendingDelete] = useState<Schedule | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  function handleDeleteClick(e: React.MouseEvent, s: Schedule) {
    e.stopPropagation()
    setDeleteError(null)
    setPendingDelete(s)
  }

  async function handleConfirmDelete() {
    if (!pendingDelete) return
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      await deleteSchedule(pendingDelete.id)
      onDeleted(pendingDelete.id)
      setPendingDelete(null)
    } catch {
      setDeleteError('削除に失敗しました。時間をおいて再試行してください。')
    } finally {
      setDeleteBusy(false)
    }
  }

  async function handleExport(e: React.MouseEvent, s: Schedule) {
    e.stopPropagation()
    await exportScheduleXlsx(s.id, s.year, s.month, s.generation_attempt)
  }

  async function handleExportCsv(e: React.MouseEvent, s: Schedule) {
    e.stopPropagation()
    await exportScheduleCsvLong(s.id, s.year, s.month, s.generation_attempt)
  }

  if (schedules.length === 0) {
    return (
      <p className="text-sm text-gray-400 text-center py-8">
        まだ稼働表が生成されていません
      </p>
    )
  }

  return (
    <>
      <div className="divide-y divide-gray-100">
        {schedules.map((s) => {
          const badge = STATUS_LABEL[s.status] ?? { text: s.status, cls: 'bg-gray-100 text-gray-600' }
          const isSelected = s.id === selectedId

          return (
            <div
              key={s.id}
              onClick={() => (s.status === 'GENERATED' || s.status === 'PARTIAL') && onSelect(s)}
              className={`flex items-center gap-3 px-4 py-3 transition-colors ${
                (s.status === 'GENERATED' || s.status === 'PARTIAL') ? 'cursor-pointer hover:bg-gray-50' : 'cursor-default'
              } ${isSelected ? 'bg-brand-50 border-l-4 border-brand-500' : ''}`}
            >
              {/* 年月・回数 */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800">
                  {s.year}年{s.month}月{' '}
                  <span className="text-gray-400 font-normal">第{s.generation_attempt}回</span>
                </p>
                <p className="text-xs text-gray-400 mt-0.5">{formatCreatedAt(s.created_at)}</p>
                {s.diagnosis && (
                  <p className="text-xs text-amber-600 mt-1 truncate">{s.diagnosis}</p>
                )}
              </div>

              {/* ステータスバッジ */}
              <span className={`text-xs font-medium rounded-full px-2.5 py-0.5 ${badge.cls}`}>
                {badge.text}
              </span>

              {/* アクションボタン */}
              <div className="flex items-center gap-1.5 shrink-0">
                {(s.status === 'GENERATED' || s.status === 'PARTIAL') && (
                  <>
                    <button
                      onClick={(e) => handleExport(e, s)}
                      className="text-xs bg-brand-100 hover:bg-brand-200 text-brand-800 rounded px-2 py-1 transition-colors"
                    >
                      Excel
                    </button>
                    <button
                      onClick={(e) => handleExportCsv(e, s)}
                      className="text-xs bg-sky-100 hover:bg-sky-200 text-sky-700 rounded px-2 py-1 transition-colors"
                    >
                      CSV
                    </button>
                  </>
                )}
                <button
                  onClick={(e) => handleDeleteClick(e, s)}
                  className="text-xs bg-red-100 hover:bg-red-200 text-red-700 rounded px-2 py-1 transition-colors"
                >
                  削除
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {pendingDelete && (
        <DeleteConfirm
          title={`${pendingDelete.year}年${pendingDelete.month}月 第${pendingDelete.generation_attempt}回 を削除しますか？`}
          desc={
            deleteError
              ? deleteError
              : 'この稼働表は完全に削除され、元に戻せません。'
          }
          loading={deleteBusy}
          onCancel={() => {
            setDeleteError(null)
            setPendingDelete(null)
          }}
          onConfirm={handleConfirmDelete}
        />
      )}
    </>
  )
}
