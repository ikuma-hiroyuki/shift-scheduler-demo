import { useEffect, useMemo, useState } from 'react'
import { batchPatchAssignments } from '../../api/schedules'
import ConfirmDialog from '../common/ConfirmDialog'
import { buildPendingPayload, useEditorStore } from '../../stores/editor'
import type { ConstraintErrorDetail } from '../../types/api'

/** エラー応答をユーザー向けメッセージと「ハード制約違反か」に分解する。
 *  backend はハード制約違反を detail={message} のオブジェクトで返す（issue #91）。
 *  文字列 detail（年月不一致・入力エラー等）は強制確定の対象外。 */
function parseCommitError(err: unknown): { message: string; isConstraint: boolean } {
  const detail = (err as { response?: { data?: { detail?: unknown } } }).response?.data?.detail
  if (detail && typeof detail === 'object' && 'message' in (detail as object)) {
    return { message: (detail as ConstraintErrorDetail).message, isConstraint: true }
  }
  if (typeof detail === 'string') {
    return { message: detail, isConstraint: false }
  }
  return { message: '確定に失敗しました', isConstraint: false }
}

export default function CommitBar() {
  const mode = useEditorStore((s) => s.mode)
  const scheduleId = useEditorStore((s) => s.scheduleId)
  const year = useEditorStore((s) => s.year)
  const month = useEditorStore((s) => s.month)
  const cells = useEditorStore((s) => s.cells)
  const serverCells = useEditorStore((s) => s.serverCells)
  const committing = useEditorStore((s) => s.committing)
  const setCommitting = useEditorStore((s) => s.setCommitting)
  const discardPending = useEditorStore((s) => s.discardPending)
  const applyCommitResults = useEditorStore((s) => s.applyCommitResults)
  const setToast = useEditorStore((s) => s.setToast)
  const setCompensatoryContext = useEditorStore((s) => s.setCompensatoryContext)

  const [confirmDiscard, setConfirmDiscard] = useState(false)
  // ハード制約違反で通常確定が却下されたときのメッセージ。非 null の間 force ボタンを出す。
  const [constraintError, setConstraintError] = useState<string | null>(null)
  const [forceDialogOpen, setForceDialogOpen] = useState(false)

  const pendingCount = useMemo(() => {
    let n = 0
    for (const [k, v] of cells) {
      const s = serverCells.get(k)
      if (!s) continue
      if (
        v.assignmentType !== s.assignmentType ||
        v.patternId !== s.patternId ||
        v.leaveType !== s.leaveType
      ) {
        n++
      }
    }
    return n
  }, [cells, serverCells])

  const hasPending = pendingCount > 0

  useEffect(() => {
    if (!hasPending) return
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [hasPending])

  // 編集内容が変わったら force ボタンの根拠 (前回の違反) を破棄する。
  // 確定成功 / 破棄 / セル編集 / 編集モード再入はすべて cells を差し替えるため、
  // 別の編集セットに古い違反メッセージを引きずらない (codex review #4)。
  useEffect(() => {
    setConstraintError(null)
  }, [cells])

  if (mode !== 'edit') return null

  async function doCommit(force: boolean) {
    if (scheduleId == null || year == null || month == null) return
    const edits = buildPendingPayload(cells, serverCells, year, month)
    if (edits.length === 0) return

    setCommitting(true)
    try {
      // backend は REST→WORK 遷移を検知して compensatory_suggestion を返す（issue #91）。
      const res = await batchPatchAssignments(scheduleId, { edits, force })
      applyCommitResults(res.results)
      setConstraintError(null)
      setForceDialogOpen(false)
      setToast({
        kind: 'success',
        message: `${res.results.length} 件の変更を反映しました`,
      })

      const suggestion = res.compensatory_suggestion
      if (suggestion && suggestion.proposals.length > 0) {
        setCompensatoryContext({
          employeeId: suggestion.employee_id,
          targetDate: suggestion.target_date,
          proposals: suggestion.proposals,
        })
        if (suggestion.additional_transition_count > 0) {
          setToast({
            kind: 'info',
            message: `代休候補を ${suggestion.target_date} について表示中。他 ${suggestion.additional_transition_count} 件は個別に編集してください。`,
          })
        }
      }
    } catch (err: unknown) {
      const { message, isConstraint } = parseCommitError(err)
      if (isConstraint && !force) {
        // 通常確定がハード制約で却下されたら force ボタンを出す（issue #245）。
        setConstraintError(message)
      } else if (force) {
        // force でも却下された = 上書き不可の制約 (H10 有給保護など)。
        // 再試行しても通らないので force ボタンを引っ込める。
        setConstraintError(null)
      }
      setForceDialogOpen(false)
      setToast({ kind: 'error', message })
    } finally {
      setCommitting(false)
    }
  }

  function onDiscard() {
    discardPending()
    setConfirmDiscard(false)
    setConstraintError(null)
  }

  return (
    <div
      className={
        'sticky top-0 z-30 -mx-6 -mt-6 px-6 py-3 border-b mb-4 flex items-center justify-between gap-3 ' +
        (hasPending ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-200')
      }
    >
      <div className="text-xs">
        {hasPending ? (
          <span className="text-amber-800 font-medium">
            未確定の変更: {pendingCount} 件
          </span>
        ) : (
          <span className="text-gray-500">変更なし（編集モード中）</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {confirmDiscard ? (
          <>
            <span className="text-xs text-gray-600">破棄しますか?</span>
            <button
              type="button"
              onClick={onDiscard}
              disabled={committing}
              className="px-3 py-1 text-xs font-semibold rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
            >
              破棄する
            </button>
            <button
              type="button"
              onClick={() => setConfirmDiscard(false)}
              className="px-3 py-1 text-xs text-gray-600 hover:text-gray-800"
            >
              やめる
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setConfirmDiscard(true)}
              disabled={!hasPending || committing}
              className="px-3 py-1 text-xs rounded border border-gray-300 text-gray-700 hover:bg-gray-100 disabled:opacity-50"
            >
              破棄
            </button>
            {constraintError && (
              <button
                type="button"
                onClick={() => setForceDialogOpen(true)}
                disabled={!hasPending || committing}
                className="px-3 py-1 text-xs font-semibold rounded border border-red-400 text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                制約を無視して確定
              </button>
            )}
            <button
              type="button"
              onClick={() => doCommit(false)}
              disabled={!hasPending || committing}
              className="px-3 py-1 text-xs font-semibold rounded bg-brand-600 text-white hover:bg-brand-700 disabled:bg-gray-300"
            >
              {committing ? '確定中...' : '確定'}
            </button>
          </>
        )}
      </div>
      {forceDialogOpen && constraintError && (
        <ConfirmDialog
          tone="warning"
          kicker="Force"
          title="制約を無視して確定"
          confirmLabel="無視して確定"
          loading={committing}
          loadingLabel="確定中…"
          onCancel={() => setForceDialogOpen(false)}
          onConfirm={() => doCommit(true)}
          description={
            <div className="space-y-3">
              <p className="text-red-700">{constraintError}</p>
              <p>この制約を無視して、編集内容をそのまま確定します。</p>
            </div>
          }
        />
      )}
    </div>
  )
}
