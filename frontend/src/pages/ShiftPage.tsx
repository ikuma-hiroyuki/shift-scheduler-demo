import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { listDepartments } from '../api/departments'
import { listEmployees } from '../api/employees'
import { getSchedule, listSchedules } from '../api/schedules'
import { useEditorStore } from '../stores/editor'
import { useShiftSelectionStore } from '../stores/shiftSelection'
import type { Department, Employee, Schedule } from '../types/api'
import GenerateButton from '../components/shift/GenerateButton'
import GenerationProgress, { GenerationFailurePanel } from '../components/shift/GenerationProgress'
import CrossPeriodCompletionToast from '../components/shift/CrossPeriodCompletionToast'
import ScheduleList from '../components/shift/ScheduleList'
import ShiftGrid from '../components/shift/ShiftGrid'
import LeaveMatrix from '../components/leave/LeaveMatrix'
import LeaveCsvUpload from '../components/leave/LeaveCsvUpload'
import PageHeader from '../components/common/PageHeader'

const NOW = new Date()

export default function ShiftPage() {
  const resetEditor = useEditorStore((s) => s.reset)

  const [departments, setDepartments] = useState<Department[]>([])
  const [departmentId, setDepartmentId] = useState<number | null>(null)
  // year/month は別画面遷移をまたいで保持する (再マウントで翌月デフォルトに
  // リセットされる問題の回避)。store 詳細は stores/shiftSelection.ts 参照。
  const year = useShiftSelectionStore((s) => s.year)
  const month = useShiftSelectionStore((s) => s.month)
  const setYear = useShiftSelectionStore((s) => s.setYear)
  const setMonth = useShiftSelectionStore((s) => s.setMonth)

  const [employees, setEmployees] = useState<Employee[]>([])
  const [query, setQuery] = useState('')
  const [matrixReloadToken, setMatrixReloadToken] = useState(0)
  const [matrixCellCount, setMatrixCellCount] = useState(0)

  const [generatingId, setGeneratingId] = useState<number | null>(null)
  const [failedSchedule, setFailedSchedule] = useState<Schedule | null>(null)
  // issue #212: 期間切替後に裏で完了した schedule を toast 通知するためのキュー。
  // 1 件分だけ保持 (連続切替時は最後の完了が勝つ)。クリック → 該当期間へジャンプ。
  const [crossPeriodNotice, setCrossPeriodNotice] = useState<Schedule | null>(null)
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [selectedSchedule, setSelectedSchedule] = useState<Schedule | null>(null)
  const shiftGridRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!selectedSchedule) return
    // ShiftGrid は async fetch 後に高さが伸びるので、サイズ変化を ResizeObserver で
    // 追従して最下部スクロールを繰り返す。連続発火は rAF で 1 フレーム単位にデバウンス。
    // 一定時間経過 or ユーザー操作で停止。
    let stopped = false
    let rafId: number | null = null
    const stop = () => {
      stopped = true
      if (rafId !== null) cancelAnimationFrame(rafId)
      observer.disconnect()
      window.removeEventListener('wheel', stop)
      window.removeEventListener('touchstart', stop)
      window.removeEventListener('keydown', stop)
    }
    const scheduleScroll = () => {
      if (stopped || rafId !== null) return
      rafId = requestAnimationFrame(() => {
        rafId = null
        if (stopped) return
        window.scrollTo({
          top: document.documentElement.scrollHeight,
          behavior: 'smooth',
        })
      })
    }
    const observer = new ResizeObserver(scheduleScroll)
    if (shiftGridRef.current) observer.observe(shiftGridRef.current)
    scheduleScroll()
    window.addEventListener('wheel', stop, { passive: true })
    window.addEventListener('touchstart', stop, { passive: true })
    window.addEventListener('keydown', stop)
    const timer = setTimeout(stop, 2000)
    return () => {
      clearTimeout(timer)
      stop()
    }
  }, [selectedSchedule])

  // 部門一覧
  useEffect(() => {
    listDepartments().then((deps) => {
      setDepartments(deps)
      if (deps.length > 0) setDepartmentId(deps[0].id)
    })
  }, [])

  // 従業員一覧（部門切替時）
  useEffect(() => {
    if (departmentId === null) return
    listEmployees().then((all) =>
      setEmployees(all.filter((e) => e.department_id === departmentId)),
    )
  }, [departmentId])

  // スケジュール一覧
  const reloadSchedules = useCallback(async () => {
    if (departmentId === null) return
    try {
      const list = await listSchedules(departmentId)
      setSchedules(list)
    } catch {
      /* interceptor handles auth */
    }
  }, [departmentId])

  useEffect(() => {
    reloadSchedules()
  }, [reloadSchedules])

  // 別画面から戻ってきた時に GENERATING 行があれば進捗パネルを復活させる
  useEffect(() => {
    if (generatingId !== null) return
    const inflight = schedules.find((s) => s.status === 'GENERATING')
    if (inflight) setGeneratingId(inflight.id)
  }, [schedules, generatingId])

  function handleGenerated(schedule: Schedule) {
    setGeneratingId(schedule.id)
    setFailedSchedule(null)
    setSchedules((prev) => [schedule, ...prev])
  }

  function handleGenerationDone(schedule: Schedule) {
    setGeneratingId(null)
    setSchedules((prev) => prev.map((s) => (s.id === schedule.id ? schedule : s)))

    const onCurrentPeriod =
      schedule.department_id === departmentId &&
      schedule.year === year &&
      schedule.month === month

    if (onCurrentPeriod) {
      // 通常経路: 同じ期間を表示中なので失敗パネルを inline で出す。toast は不要。
      setFailedSchedule(schedule.status === 'INFEASIBLE' ? schedule : null)
      setCrossPeriodNotice(null)
    } else {
      // issue #212: 別期間に navigate 済み。inline 通知は cleanup useEffect に
      // 即時消されるので、toast で通知する。GENERATED / PARTIAL / INFEASIBLE 全部表示。
      setFailedSchedule(null)
      if (
        schedule.status === 'GENERATED'
        || schedule.status === 'PARTIAL'
        || schedule.status === 'INFEASIBLE'
      ) {
        setCrossPeriodNotice(schedule)
      }
    }
    reloadSchedules()
  }

  function handleCrossPeriodJump() {
    if (!crossPeriodNotice) return
    setDepartmentId(crossPeriodNotice.department_id)
    setYear(crossPeriodNotice.year)
    setMonth(crossPeriodNotice.month)
    // ジャンプ先で inline failure panel が出るよう INFEASIBLE のみ failedSchedule に流す。
    if (crossPeriodNotice.status === 'INFEASIBLE') {
      setFailedSchedule(crossPeriodNotice)
    }
    setCrossPeriodNotice(null)
  }

  async function handleSelectSchedule(schedule: Schedule) {
    // list 経由の schedule には PARTIAL 派生フィールド (shortages 等) が欠落するため、
    // 単一エンドポイント `/api/v1/schedules/{id}` で _build_schedule_response を通した
    // 完全版を再 fetch する。toggle close (同一 id) はスキップ。
    if (selectedSchedule?.id === schedule.id) {
      setSelectedSchedule(null)
      return
    }
    try {
      const full = await getSchedule(schedule.id)
      setSelectedSchedule(full)
    } catch {
      // フォールバック: list 経由の schedule (shortages なし) で開く
      setSelectedSchedule(schedule)
    }
  }

  function handleDeleted(id: number) {
    setSchedules((prev) => prev.filter((s) => s.id !== id))
    if (selectedSchedule?.id === id) {
      setSelectedSchedule(null)
      resetEditor()
    }
    if (generatingId === id) setGeneratingId(null)
    if (failedSchedule?.id === id) setFailedSchedule(null)
  }

  const currentDept = useMemo(
    () => departments.find((d) => d.id === departmentId) ?? null,
    [departments, departmentId],
  )

  // 年月・部門変更時に詳細グリッドが対象外なら閉じる
  useEffect(() => {
    if (!selectedSchedule) return
    if (
      selectedSchedule.department_id !== departmentId ||
      selectedSchedule.year !== year ||
      selectedSchedule.month !== month
    ) {
      setSelectedSchedule(null)
      resetEditor()
    }
  }, [departmentId, year, month, selectedSchedule, resetEditor])

  // 年月・部門変更時に失敗パネルが対象外ならクリア
  useEffect(() => {
    if (!failedSchedule) return
    if (
      failedSchedule.department_id !== departmentId ||
      failedSchedule.year !== year ||
      failedSchedule.month !== month
    ) {
      setFailedSchedule(null)
    }
  }, [departmentId, year, month, failedSchedule])

  const filteredSchedules = useMemo(
    () => schedules.filter((s) => s.year === year && s.month === month),
    [schedules, year, month],
  )

  const yearOptions = useMemo(() => {
    const base = NOW.getFullYear()
    return [base - 1, base, base + 1, base + 2]
  }, [])

  return (
    <div className="min-h-screen">
      <div className="max-w-[1500px] mx-auto px-8 py-10">
        <PageHeader
          title="稼働表作成"
          description="希望休 (●) ・仮休 (○) ・有給を従業員 × 日のマトリックスで編集します。CSV からの一括取込も可能です。"
          rightSlot={
            <>
              <div
                className="text-[10px] tracking-[0.3em] uppercase text-ink-muted"
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                Marked / Cells
              </div>
              <div
                className="text-3xl font-medium text-brand-900 mt-1"
                style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}
              >
                {matrixCellCount}
                <span className="text-base text-ink-muted">
                  /{employees.length * new Date(year, month, 0).getDate()}
                </span>
              </div>
            </>
          }
        />

        {/* Selector bar */}
        <div className="bg-cream-50 border border-ink/10 rounded-sm px-6 py-4 flex flex-wrap items-center gap-5 mb-4">
          <label className="flex items-center gap-3">
            <span
              className="text-[10px] tracking-[0.3em] uppercase text-ink-muted"
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              部門
            </span>
            <select
              value={departmentId ?? ''}
              onChange={(e) => setDepartmentId(Number(e.target.value))}
              disabled={generatingId !== null}
              className="bg-transparent border-0 border-b border-ink/30 focus:border-brand-600 focus:outline-none px-0 py-1 text-sm font-medium"
            >
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-3">
            <span
              className="text-[10px] tracking-[0.3em] uppercase text-ink-muted"
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              年
            </span>
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              disabled={generatingId !== null}
              className="bg-transparent border-0 border-b border-ink/30 focus:border-brand-600 focus:outline-none px-0 py-1 text-sm font-medium"
              style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-3">
            <span
              className="text-[10px] tracking-[0.3em] uppercase text-ink-muted"
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              月
            </span>
            <select
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
              disabled={generatingId !== null}
              className="bg-transparent border-0 border-b border-ink/30 focus:border-brand-600 focus:outline-none px-0 py-1 text-sm font-medium"
              style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>

          <div className="flex-1 min-w-[180px]">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="氏名・社員番号で従業員絞り込み"
              className="w-full bg-transparent border-0 border-b border-ink/15 focus:border-brand-600 focus:outline-none px-0 py-1 text-sm placeholder:text-ink-muted/60"
            />
          </div>

          <span
            className="text-[10px] tracking-[0.25em] uppercase text-ink-muted"
            style={{ fontFamily: 'var(--font-mono)' }}
          >
            ● 希望休 · ○ 仮休 · 有給
          </span>
        </div>

        {/* Matrix (full width) */}
        {departmentId !== null && (
          <div className="space-y-4">
            <LeaveMatrix
              departmentId={departmentId}
              year={year}
              month={month}
              employees={employees}
              query={query}
              reloadToken={matrixReloadToken}
              onCellsChanged={setMatrixCellCount}
            />

            <div className="text-[11px] text-ink-muted leading-relaxed border-l-2 border-brand-600/40 pl-3">
              <span
                className="block text-[10px] tracking-[0.25em] uppercase text-brand-600 mb-1"
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                Note
              </span>
              セル変更は<strong>即時保存</strong>されます。空 (·) を選ぶと既存レコードを削除します。
              <strong>●（希望休）</strong>と<strong>有給</strong>は稼働表生成時に必ず休日として割り当てられます。
              <strong>○（仮休）</strong>はなるべく休みになるよう調整されますが、必要に応じて出勤に変わる場合があります。
            </div>

            {/* CSV + 自動作成（マトリックス下、横並び） */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-2">
              <LeaveCsvUpload
                departmentId={departmentId}
                year={year}
                month={month}
                onImported={() => setMatrixReloadToken((n) => n + 1)}
              />

              <div className="bg-cream-50 border border-ink/10 rounded-sm">
                <div className="px-6 py-4 border-b border-ink/10 flex items-baseline justify-between">
                  <h3
                    className="text-base font-medium text-brand-900"
                    style={{
                      fontFamily: 'var(--font-display)',
                      fontVariationSettings: '"opsz" 96',
                    }}
                  >
                    稼働表自動作成
                  </h3>
                </div>
                <div className="p-6 space-y-3">
                  <GenerateButton
                    departmentId={departmentId}
                    year={year}
                    month={month}
                    disabled={generatingId !== null}
                    onGenerated={handleGenerated}
                  />
                  {generatingId !== null && (
                    <GenerationProgress
                      scheduleId={generatingId}
                      onDone={handleGenerationDone}
                      initialSchedule={
                        schedules.find((s) => s.id === generatingId) ?? null
                      }
                    />
                  )}
                  {generatingId === null && failedSchedule && (
                    <GenerationFailurePanel schedule={failedSchedule} />
                  )}
                  {currentDept && (
                    <p className="text-[11px] text-ink-muted leading-relaxed">
                      対象: <strong>{currentDept.name}</strong> ／ {year}年{month}月
                      <br />
                      現在の入力内容と登録済みデータを基に最適な割当を探索します。
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Schedules */}
        <div className="bg-cream-50 border border-ink/10 rounded-sm mt-6">
          <div className="px-6 py-4 border-b border-ink/10 flex items-baseline justify-between">
            <h3
              className="text-base font-medium text-brand-900"
              style={{
                fontFamily: 'var(--font-display)',
                fontVariationSettings: '"opsz" 96',
              }}
            >
              生成済み稼働表一覧
            </h3>
            <span
              className="text-[10px] tracking-[0.3em] uppercase text-ink-muted"
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              {year}/{String(month).padStart(2, '0')} · {filteredSchedules.length} runs
            </span>
          </div>
          <ScheduleList
            schedules={filteredSchedules}
            selectedId={selectedSchedule?.id ?? null}
            onSelect={handleSelectSchedule}
            onDeleted={handleDeleted}
          />
        </div>

        {selectedSchedule && (
          <div
            ref={shiftGridRef}
            className="bg-cream-50 border border-ink/10 rounded-sm p-6 mt-6 scroll-mt-4 print-area"
          >
            <ShiftGrid
              schedule={selectedSchedule}
              onFinalize={(updated) => {
                setSelectedSchedule(updated)
                setSchedules((prev) =>
                  prev.map((s) => (s.id === updated.id ? updated : s)),
                )
                reloadSchedules()
              }}
            />
          </div>
        )}
      </div>

      {crossPeriodNotice && (
        <CrossPeriodCompletionToast
          schedule={crossPeriodNotice}
          onJump={handleCrossPeriodJump}
          onDismiss={() => setCrossPeriodNotice(null)}
        />
      )}
    </div>
  )
}
