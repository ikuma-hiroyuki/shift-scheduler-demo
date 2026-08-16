import { useEffect, useRef, useState } from 'react'
import { cancelSchedule, getSchedule } from '../../api/schedules'
import type { Schedule } from '../../types/api'

/**
 * INFEASIBLE 完了状態を「次回ボタン押下 / 別画面遷移 / リロード」まで残すための表示パネル。
 * GenerationProgress は onDone から 1.5 秒後に親側で unmount されてしまうので、
 * 永続表示が必要な場面では親側で本コンポーネントを使う。
 */
export function GenerationFailurePanel({ schedule }: { schedule: Schedule }) {
  return (
    <div className="bg-red-50 border border-red-200 rounded-xl p-4">
      <div className="flex items-center gap-3 mb-2">
        <span className="text-red-600 text-lg">×</span>
        <span className="text-sm font-medium text-red-800">稼働表作成失敗</span>
      </div>
      <div className="text-xs text-red-700 mt-1 space-y-0.5">
        <p>条件を満たすシフトが見つかりませんでした。希望休や条件を見直してください。</p>
        {schedule.diagnosis && (
          <pre className="whitespace-pre-wrap font-sans text-[11px] text-red-600 mt-1">
            {schedule.diagnosis}
          </pre>
        )}
      </div>
    </div>
  )
}

interface Props {
  scheduleId: number
  onDone: (schedule: Schedule) => void
  // 別画面から戻ってきた等、既に Schedule 行を保持している場合のフォールバック。
  // started_at がここから取れれば最初のポーリングを待たず正しい経過時間で表示できる。
  initialSchedule?: Schedule | null
}

const POLL_MS = 3000
// issue #196: 連続でこの回数の poll が失敗したら諦めて pollError を出す。
// 3s × 5 = 15 秒程度。一時的な network blip は再試行で吸収しつつ、
// backend 完全停止のような恒久的失敗には永久 poll せず止める。
const MAX_CONSECUTIVE_POLL_ERRORS = 5

export default function GenerationProgress({ scheduleId, onDone, initialSchedule }: Props) {
  const [status, setStatus] = useState<string>(initialSchedule?.status ?? 'GENERATING')
  const [dots, setDots] = useState('')
  const [schedule, setSchedule] = useState<Schedule | null>(initialSchedule ?? null)
  const [now, setNow] = useState<number>(Date.now())
  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)
  // issue #196: poll 失敗を可視化。404 は「削除された」を、連続失敗は
  // 「サーバから応答が無い」を表示する。
  const [pollError, setPollError] = useState<string | null>(null)
  const consecutiveErrorsRef = useRef(0)
  // started_at が DB / props のどちらからも得られない場合のフォールバック
  const mountedAtRef = useRef<number>(Date.now())
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const doneTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  // アニメーション用ドット
  useEffect(() => {
    const id = setInterval(() => {
      setDots((d) => (d.length >= 3 ? '' : d + '.'))
    }, 500)
    return () => clearInterval(id)
  }, [])

  // 経過秒の再描画用 1s tick（生成中のみ）
  const isGenerating = status === 'GENERATING' || status === 'DRAFT'
  useEffect(() => {
    if (!isGenerating) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [isGenerating])

  // ポーリング (issue #196: 404 / 連続 N 回失敗で停止)
  useEffect(() => {
    consecutiveErrorsRef.current = 0
    timerRef.current = setInterval(async () => {
      try {
        const s = await getSchedule(scheduleId)
        consecutiveErrorsRef.current = 0
        setPollError(null)
        setSchedule(s)
        setStatus(s.status)
        if (s.status !== 'GENERATING' && s.status !== 'DRAFT') {
          if (timerRef.current) clearInterval(timerRef.current)
          // 完了表示を 1.5 秒見せてから親へ通知
          doneTimeoutRef.current = setTimeout(() => onDoneRef.current(s), 1500)
        }
      } catch (err) {
        const httpStatus =
          (err as { response?: { status?: number } })?.response?.status ?? 0
        if (httpStatus === 404) {
          // 削除されたスケジュール: 永久 poll しても無駄なのでパネルを畳む
          if (timerRef.current) clearInterval(timerRef.current)
          setPollError('対象の稼働表が見つかりません (削除された可能性があります)')
          setStatus('NOT_FOUND')
          // 親側ではこの synthetic 状態を見て panel を unmount する想定。
          doneTimeoutRef.current = setTimeout(() => {
            onDoneRef.current({
              ...(schedule ?? ({} as Schedule)),
              id: scheduleId,
              status: 'CANCELLED' as Schedule['status'],
              diagnosis: 'スケジュールが見つかりません (404)',
            } as Schedule)
          }, 1500)
          return
        }
        consecutiveErrorsRef.current += 1
        if (consecutiveErrorsRef.current >= MAX_CONSECUTIVE_POLL_ERRORS) {
          if (timerRef.current) clearInterval(timerRef.current)
          setPollError(
            `サーバから応答がありません (連続 ${MAX_CONSECUTIVE_POLL_ERRORS} 回失敗)。` +
              'ネットワーク状況を確認してから画面を再読み込みしてください。',
          )
        }
      }
    }, POLL_MS)

    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      if (doneTimeoutRef.current) clearTimeout(doneTimeoutRef.current)
    }
  }, [scheduleId])

  async function handleCancel() {
    if (cancelling) return
    setCancelError(null)
    setCancelling(true)
    try {
      const updated = await cancelSchedule(scheduleId)
      setSchedule(updated)
      setStatus(updated.status)
      // CANCELLED が返れば即座に親へ通知してパネルを閉じる
      if (updated.status === 'CANCELLED') {
        if (timerRef.current) clearInterval(timerRef.current)
        doneTimeoutRef.current = setTimeout(() => onDoneRef.current(updated), 1000)
      }
    } catch {
      setCancelError('停止要求の送信に失敗しました。しばらく経ってから再度お試しください。')
      setCancelling(false)
    }
  }

  const startedMs = schedule?.started_at
    ? new Date(schedule.started_at).getTime()
    : mountedAtRef.current
  const finishedMs = schedule?.finished_at
    ? new Date(schedule.finished_at).getTime()
    : null

  const elapsedSec = Math.max(0, Math.floor(((finishedMs ?? now) - startedMs) / 1000))
  // time_limit は backend (ShiftSchedule.time_limit) を真値として扱う。
  // 初回ポーリング前で値が無い場合は indeterminate（pulse のみ）にして決め打ちを避ける。
  const timeLimitSec = schedule?.time_limit ?? initialSchedule?.time_limit ?? null
  const progressRatio =
    timeLimitSec === null ? 0 : Math.min(1, elapsedSec / Math.max(1, timeLimitSec))
  const overTime =
    isGenerating && timeLimitSec !== null && elapsedSec > timeLimitSec
  const indeterminate = isGenerating && timeLimitSec === null

  const label = isGenerating
    ? cancelling
      ? `停止中${dots}`
      : overTime
        ? `最終調整中${dots}`
        : `稼働表を計算中${dots}`
    : status === 'GENERATED'
      ? '生成完了'
      : status === 'PARTIAL'
        ? '部分的に作成しました'
        : status === 'INFEASIBLE'
          ? '稼働表作成失敗'
          : status === 'CANCELLED'
            ? '稼働表作成を停止しました'
            : `完了 (${status})`

  const barWidthPct = isGenerating
    ? indeterminate
      ? 100
      : progressRatio * 100
    : 100

  return (
    <div className="bg-brand-50 border border-brand-200 rounded-xl p-4">
      <div className="flex items-center gap-3 mb-2">
        {isGenerating && (
          <svg
            className="animate-spin h-4 w-4 text-brand-600"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8v8H4z"
            />
          </svg>
        )}
        {!isGenerating && status === 'GENERATED' && (
          <span className="text-brand-600 text-lg">✓</span>
        )}
        {!isGenerating && status === 'PARTIAL' && (
          <span className="text-amber-600 text-lg">⚠</span>
        )}
        <span className="text-sm font-medium text-brand-800">{label}</span>
      </div>
      <div className="w-full bg-brand-200 rounded-full h-1.5 overflow-hidden">
        <div
          data-testid="generation-progress-bar"
          className={`bg-brand-600 h-1.5 rounded-full transition-all duration-500 ${
            overTime || indeterminate ? 'animate-pulse' : ''
          }`}
          style={{ width: `${barWidthPct}%` }}
        />
      </div>
      {isGenerating && (
        <div className="mt-2 flex items-start justify-between gap-3">
          <p className="text-xs text-brand-700/80 flex-1">
            別画面に移動しても生成は裏で継続します。戻ってくれば結果を確認できます。
          </p>
          <button
            type="button"
            data-testid="cancel-generation-btn"
            onClick={handleCancel}
            disabled={cancelling}
            className="shrink-0 text-xs font-medium border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed rounded px-3 py-1 transition-colors"
          >
            {cancelling ? '停止中…' : '停止'}
          </button>
        </div>
      )}
      {cancelError && (
        <p className="text-xs text-red-700 mt-2">{cancelError}</p>
      )}
      {pollError && (
        <p className="text-xs text-red-700 mt-2 whitespace-pre-wrap">{pollError}</p>
      )}
      {!isGenerating && status === 'CANCELLED' && (
        <p className="text-xs text-ink-muted mt-2">
          ユーザー操作により稼働表作成を停止しました。
        </p>
      )}
      {!isGenerating && status === 'INFEASIBLE' && (
        <div className="text-xs text-red-700 mt-2 space-y-0.5">
          <p>条件を満たすシフトが見つかりませんでした。希望休や条件を見直してください。</p>
          {schedule?.diagnosis && (
            <pre className="whitespace-pre-wrap font-sans text-[11px] text-red-600 mt-1">
              {schedule.diagnosis}
            </pre>
          )}
        </div>
      )}
      {!isGenerating && status === 'PARTIAL' && (
        <p className="text-xs text-amber-800 mt-2">
          出勤可能な人員だけで埋めた部分シフトを生成しました。稼働表詳細で不足ポジションを確認し、手動で調整してください。
        </p>
      )}
      {!isGenerating &&
        status !== 'GENERATED' &&
        status !== 'PARTIAL' &&
        status !== 'INFEASIBLE' &&
        status !== 'CANCELLED' && (
          <p className="text-xs text-amber-700 mt-2">
            ステータス: {status} — 解が見つからなかった可能性があります
          </p>
        )}
    </div>
  )
}
