import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  createDayOverride,
  createDayTemplate,
  deleteDayOverride,
  deleteDayTemplate,
  listDayOverrides,
  listDayTemplates,
  reorderDayOverrides,
  reorderDayTemplates,
  updateDayOverride,
  updateDayTemplate,
} from '../api/dayTemplates'
import { listDepartments } from '../api/departments'
import { listWorkPatterns } from '../api/workPatterns'
import DayOverrideFormModal from '../components/day-template/DayOverrideFormModal'
import DayTemplateCsvUpload from '../components/day-template/DayTemplateCsvUpload'
import DayTemplateFormModal from '../components/day-template/DayTemplateFormModal'
import ReorderCommitBar from '../components/reorder/ReorderCommitBar'
import ReorderToast from '../components/reorder/ReorderToast'
import SortableContainer from '../components/reorder/SortableContainer'
import SortableRow, { DragHandle } from '../components/reorder/SortableRow'
import DeleteConfirm from '../components/common/DeleteConfirm'
import PageHeader from '../components/common/PageHeader'
import {
  useDayOverrideReorderStore,
  useDayTemplateReorderStore,
} from '../stores/reorderStore'
import type {
  DayOverride,
  DayTemplate,
  Department,
  WorkPattern,
} from '../types/api'

type Tab = 'templates' | 'overrides'

const WEEKDAY_LABEL: Record<number, string> = {
  [-1]: '全曜日',
  0: '月',
  1: '火',
  2: '水',
  3: '木',
  4: '金',
  5: '土',
  6: '日',
  7: '祝',
}

export default function DayTemplatesPage() {
  const [tab, setTab] = useState<Tab>('templates')
  const [departments, setDepartments] = useState<Department[]>([])
  const [departmentId, setDepartmentId] = useState<number | null>(null)
  const [patterns, setPatterns] = useState<WorkPattern[]>([])
  const [templates, setTemplates] = useState<DayTemplate[]>([])
  const [overrides, setOverrides] = useState<DayOverride[]>([])
  const [loading, setLoading] = useState(false)

  const [tmplModal, setTmplModal] = useState<{
    mode: 'create' | 'edit'
    item: DayTemplate | null
  } | null>(null)
  const [overModal, setOverModal] = useState<{
    mode: 'create' | 'edit'
    item: DayOverride | null
  } | null>(null)
  const [confirmTmpl, setConfirmTmpl] = useState<DayTemplate | null>(null)
  const [confirmOver, setConfirmOver] = useState<DayOverride | null>(null)
  const [delLoading, setDelLoading] = useState(false)

  // 一括選択
  const [selectedTmplIds, setSelectedTmplIds] = useState<Set<number>>(new Set())
  const [selectedOverIds, setSelectedOverIds] = useState<Set<number>>(new Set())
  const [confirmBulk, setConfirmBulk] = useState<
    { type: 'tmpl' | 'over'; ids: number[] } | null
  >(null)
  const [showHelp, setShowHelp] = useState(false)

  const tmplStore = useDayTemplateReorderStore()
  const overStore = useDayOverrideReorderStore()
  const tmplReordering = tmplStore.mode === 'reorder'
  const overReordering = overStore.mode === 'reorder'

  useEffect(() => {
    listDepartments().then((d) => {
      setDepartments(d)
      if (d.length > 0 && departmentId === null) setDepartmentId(d[0].id)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [t, o] = await Promise.all([listDayTemplates(), listDayOverrides()])
      setTemplates(t)
      setOverrides(o)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  useEffect(() => {
    if (departmentId === null) return
    listWorkPatterns(departmentId).then(setPatterns)
  }, [departmentId])

  // department / tab 切替時、または並び替え進入時に選択と並び替えモードをクリア
  useEffect(() => {
    setSelectedTmplIds(new Set())
    setSelectedOverIds(new Set())
    if (tmplReordering) tmplStore.exit()
    if (overReordering) overStore.exit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [departmentId, tab])

  useEffect(() => {
    if (tmplReordering) setSelectedTmplIds(new Set())
    if (overReordering) setSelectedOverIds(new Set())
  }, [tmplReordering, overReordering])

  const deptTemplates = useMemo(
    () =>
      departmentId !== null
        ? templates.filter((t) => t.department_id === departmentId)
        : [],
    [templates, departmentId],
  )
  const deptOverrides = useMemo(
    () =>
      departmentId !== null
        ? overrides.filter((o) => o.department_id === departmentId)
        : [],
    [overrides, departmentId],
  )

  const draftTemplates = useMemo(() => {
    if (!tmplReordering) return []
    const byId = new Map(deptTemplates.map((t) => [t.id, t]))
    return tmplStore.draftOrder
      .map((id) => byId.get(id))
      .filter((t): t is DayTemplate => !!t)
  }, [tmplReordering, tmplStore.draftOrder, deptTemplates])

  const draftOverrides = useMemo(() => {
    if (!overReordering) return []
    const byId = new Map(deptOverrides.map((o) => [o.id, o]))
    return overStore.draftOrder
      .map((id) => byId.get(id))
      .filter((o): o is DayOverride => !!o)
  }, [overReordering, overStore.draftOrder, deptOverrides])

  const displayedTemplates = tmplReordering ? draftTemplates : deptTemplates
  const displayedOverrides = overReordering ? draftOverrides : deptOverrides

  const patternMap = useMemo(
    () => new Map(patterns.map((p) => [p.id, p.pattern_name])),
    [patterns],
  )

  function handleEnterTmplReorder() {
    if (departmentId === null) return
    tmplStore.enter(deptTemplates.map((t) => t.id))
  }

  function handleEnterOverReorder() {
    if (departmentId === null) return
    overStore.enter(deptOverrides.map((o) => o.id))
  }

  async function handleCommitTmpl(orderedIds: number[]) {
    if (departmentId === null) return
    try {
      await reorderDayTemplates(departmentId, orderedIds)
      await reload()
      tmplStore.exit()
      tmplStore.setToast({ kind: 'success', message: '並び順を保存しました' })
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: string } } })?.response?.data
          ?.detail ?? '保存に失敗しました'
      tmplStore.setToast({ kind: 'error', message: msg })
    }
  }

  async function handleCommitOver(orderedIds: number[]) {
    if (departmentId === null) return
    try {
      await reorderDayOverrides(departmentId, orderedIds)
      await reload()
      overStore.exit()
      overStore.setToast({ kind: 'success', message: '並び順を保存しました' })
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: string } } })?.response?.data
          ?.detail ?? '保存に失敗しました'
      overStore.setToast({ kind: 'error', message: msg })
    }
  }

  async function handleSubmitTmpl(payload: {
    day_of_weeks: number[]
    pattern_id: number
    required_min: number
    required_max: number | null
  }) {
    if (departmentId === null) return
    if (tmplModal?.mode === 'edit' && tmplModal.item) {
      // edit は常に単一曜日 (FormModal が length=1 を保証)
      await updateDayTemplate(tmplModal.item.id, {
        day_of_week: payload.day_of_weeks[0],
        pattern_id: payload.pattern_id,
        required_min: payload.required_min,
        required_max: payload.required_max,
      })
    } else {
      // create は選択された曜日ごとに 1 行ずつ「直列」で作成。
      // sort_order はサーバ側で `func.max(sort_order)+1` を SELECT-then-INSERT で
      // 採番するため、並列実行すると同じ値が複数行に振られてユーザーの選択順と
      // 保存順がずれる可能性がある。直列化で順序を確定させる。
      for (const dow of payload.day_of_weeks) {
        await createDayTemplate({
          department_id: departmentId,
          day_of_week: dow,
          pattern_id: payload.pattern_id,
          required_min: payload.required_min,
          required_max: payload.required_max,
        })
      }
    }
    await reload()
  }

  async function handleSubmitOver(payload: {
    specific_date: string
    pattern_id: number
    required_min: number
    required_max: number | null
  }) {
    if (departmentId === null) return
    if (overModal?.mode === 'edit' && overModal.item) {
      await updateDayOverride(overModal.item.id, payload)
    } else {
      await createDayOverride({ ...payload, department_id: departmentId })
    }
    await reload()
  }

  async function handleDeleteTmpl(t: DayTemplate) {
    setDelLoading(true)
    try {
      await deleteDayTemplate(t.id)
      setConfirmTmpl(null)
      await reload()
    } finally {
      setDelLoading(false)
    }
  }

  async function handleDeleteOver(o: DayOverride) {
    setDelLoading(true)
    try {
      await deleteDayOverride(o.id)
      setConfirmOver(null)
      await reload()
    } finally {
      setDelLoading(false)
    }
  }

  async function handleBulkDelete() {
    if (!confirmBulk) return
    setDelLoading(true)
    try {
      const deleter =
        confirmBulk.type === 'tmpl' ? deleteDayTemplate : deleteDayOverride
      const results = await Promise.allSettled(
        confirmBulk.ids.map((id) => deleter(id)),
      )
      const succeeded = results.filter((r) => r.status === 'fulfilled').length
      const failed = results.length - succeeded

      if (confirmBulk.type === 'tmpl') {
        setSelectedTmplIds(new Set())
      } else {
        setSelectedOverIds(new Set())
      }
      setConfirmBulk(null)
      await reload()

      const store = confirmBulk.type === 'tmpl' ? tmplStore : overStore
      if (failed === 0) {
        store.setToast({
          kind: 'success',
          message: `${succeeded} 件を削除しました`,
        })
      } else if (succeeded === 0) {
        store.setToast({
          kind: 'error',
          message: `削除に失敗しました（${failed} 件）`,
        })
      } else {
        store.setToast({
          kind: 'info',
          message: `${succeeded} 件削除、${failed} 件失敗`,
        })
      }
    } finally {
      setDelLoading(false)
    }
  }

  function toggleSelectTmpl(id: number) {
    setSelectedTmplIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectOver(id: number) {
    setSelectedOverIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAllTmpl() {
    if (selectedTmplIds.size === deptTemplates.length && deptTemplates.length > 0) {
      setSelectedTmplIds(new Set())
    } else {
      setSelectedTmplIds(new Set(deptTemplates.map((t) => t.id)))
    }
  }

  function toggleSelectAllOver() {
    if (selectedOverIds.size === deptOverrides.length && deptOverrides.length > 0) {
      setSelectedOverIds(new Set())
    } else {
      setSelectedOverIds(new Set(deptOverrides.map((o) => o.id)))
    }
  }

  const currentDept = departments.find((d) => d.id === departmentId)

  return (
    <div className="min-h-screen">
      <div className="max-w-6xl mx-auto px-8 py-10">
        <PageHeader
          title="日テンプレート"
          description="曜日別の必要パターン人数と、特定日の上書きルールを管理します。"
          rightSlot={
            <>
              <div
                className="text-[10px] tracking-[0.3em] uppercase text-ink-muted"
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                Total
              </div>
              <div
                className="text-3xl font-medium text-brand-900 mt-1"
                style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}
              >
                {tab === 'templates' ? displayedTemplates.length : displayedOverrides.length}
              </div>
            </>
          }
        />

        {/* Tabs */}
        <div className="flex gap-1 mb-4 border-b border-ink/10">
          <button
            onClick={() => setTab('templates')}
            disabled={tmplReordering || overReordering}
            className={`px-5 py-2 text-sm tracking-wider transition-colors disabled:opacity-50 ${
              tab === 'templates'
                ? 'text-brand-900 border-b-2 border-brand-600 -mb-px'
                : 'text-ink-muted hover:text-brand-600'
            }`}
          >
            曜日別テンプレート
          </button>
          <button
            onClick={() => setTab('overrides')}
            disabled={tmplReordering || overReordering}
            className={`px-5 py-2 text-sm tracking-wider transition-colors disabled:opacity-50 ${
              tab === 'overrides'
                ? 'text-brand-900 border-b-2 border-brand-600 -mb-px'
                : 'text-ink-muted hover:text-brand-600'
            }`}
          >
            特定日上書き
          </button>
        </div>

        <ReorderCommitBar
          useStore={useDayTemplateReorderStore}
          label="曜日別テンプレート"
          onCommit={handleCommitTmpl}
        />
        <ReorderCommitBar
          useStore={useDayOverrideReorderStore}
          label="特定日上書き"
          onCommit={handleCommitOver}
        />

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
          <div className="space-y-4">
            {/* dept selector + actions */}
            <div className="bg-cream-50 border border-ink/10 rounded-sm px-6 py-4 flex flex-wrap items-center gap-4">
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
                  disabled={tmplReordering || overReordering}
                  className="bg-transparent border-0 border-b border-ink/30 focus:border-brand-600 focus:outline-none px-0 py-1 text-sm font-medium disabled:opacity-50"
                >
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex-1" />

              {tab === 'templates' ? (
                tmplReordering ? (
                  <span
                    className="text-[10px] tracking-[0.25em] uppercase text-brand-600"
                    style={{ fontFamily: 'var(--font-mono)' }}
                  >
                    並び替えモード中
                  </span>
                ) : (
                  <>
                    {selectedTmplIds.size > 0 && (
                      <button
                        onClick={() =>
                          setConfirmBulk({
                            type: 'tmpl',
                            ids: Array.from(selectedTmplIds),
                          })
                        }
                        className="px-3 py-2 text-xs tracking-wider uppercase text-[#a83232] border border-[#a83232]/40 hover:bg-[#a83232] hover:text-white hover:border-[#a83232] rounded-sm transition-colors"
                        style={{ fontFamily: 'var(--font-mono)' }}
                      >
                        ✕ {selectedTmplIds.size} 件削除
                      </button>
                    )}
                    <button
                      onClick={handleEnterTmplReorder}
                      disabled={departmentId === null || deptTemplates.length < 2}
                      className="px-3 py-2 text-xs tracking-wider uppercase text-brand-600 border border-brand-600/40 hover:bg-brand-600 hover:text-white hover:border-brand-600 rounded-sm transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-brand-600"
                      style={{ fontFamily: 'var(--font-mono)' }}
                    >
                      ⇅ 並び替え
                    </button>
                    <button
                      onClick={() => setTmplModal({ mode: 'create', item: null })}
                      disabled={departmentId === null || patterns.length === 0}
                      className="px-4 py-2 text-xs tracking-wider uppercase bg-brand-900 text-cream-50 hover:bg-[#1a2940] rounded-sm transition-colors disabled:opacity-40"
                      style={{ fontFamily: 'var(--font-mono)' }}
                    >
                      + 新規追加
                    </button>
                  </>
                )
              ) : overReordering ? (
                <span
                  className="text-[10px] tracking-[0.25em] uppercase text-brand-600"
                  style={{ fontFamily: 'var(--font-mono)' }}
                >
                  並び替えモード中
                </span>
              ) : (
                <>
                  {selectedOverIds.size > 0 && (
                    <button
                      onClick={() =>
                        setConfirmBulk({
                          type: 'over',
                          ids: Array.from(selectedOverIds),
                        })
                      }
                      className="px-3 py-2 text-xs tracking-wider uppercase text-[#a83232] border border-[#a83232]/40 hover:bg-[#a83232] hover:text-white hover:border-[#a83232] rounded-sm transition-colors"
                      style={{ fontFamily: 'var(--font-mono)' }}
                    >
                      ✕ {selectedOverIds.size} 件削除
                    </button>
                  )}
                  <button
                    onClick={handleEnterOverReorder}
                    disabled={departmentId === null || deptOverrides.length < 2}
                    className="px-3 py-2 text-xs tracking-wider uppercase text-brand-600 border border-brand-600/40 hover:bg-brand-600 hover:text-white hover:border-brand-600 rounded-sm transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-brand-600"
                    style={{ fontFamily: 'var(--font-mono)' }}
                  >
                    ⇅ 並び替え
                  </button>
                  <button
                    onClick={() => setOverModal({ mode: 'create', item: null })}
                    disabled={departmentId === null || patterns.length === 0}
                    className="px-4 py-2 text-xs tracking-wider uppercase bg-brand-900 text-cream-50 hover:bg-[#1a2940] rounded-sm transition-colors disabled:opacity-40"
                    style={{ fontFamily: 'var(--font-mono)' }}
                  >
                    + 新規追加
                  </button>
                </>
              )}
            </div>

            {/* Help panel (templates のみ) */}
            {tab === 'templates' && (
              <div className="bg-cream-50 border border-ink/10 rounded-sm">
                <button
                  type="button"
                  onClick={() => setShowHelp((v) => !v)}
                  aria-expanded={showHelp}
                  className="w-full flex items-center justify-between px-5 py-3 text-left hover:bg-brand-600/5 transition-colors"
                >
                  <span className="flex items-center gap-2 text-xs text-brand-600 tracking-wider">
                    <span
                      className="text-[10px] tracking-[0.25em] uppercase"
                      style={{ fontFamily: 'var(--font-mono)' }}
                    >
                      Help
                    </span>
                    <span className="text-ink">「全曜日」と「祝」の関係</span>
                  </span>
                  <span
                    className={`text-ink-muted transition-transform ${showHelp ? 'rotate-180' : ''}`}
                    aria-hidden="true"
                  >
                    ▾
                  </span>
                </button>
                {showHelp && (
                  <div className="px-5 pb-5 pt-1 text-[13px] text-ink leading-relaxed space-y-4 border-t border-ink/10">
                    <p>
                      この表に「曜日 = <strong>祝</strong>」の行があるかどうかで、祝日の挙動が変わります。
                    </p>

                    <div className="border border-ink/10 rounded-sm overflow-hidden">
                      <div
                        className="px-4 py-2 bg-brand-600/5 text-[11px] tracking-wider text-brand-600"
                        style={{ fontFamily: 'var(--font-mono)' }}
                      >
                        例 1：祝の行を作っていない
                      </div>
                      <div className="px-4 py-3" style={{ fontFamily: 'var(--font-mono)' }}>
                        <div className="grid grid-cols-[80px_60px_60px] gap-x-2 text-xs text-ink-muted mb-1">
                          <span>曜日</span>
                          <span>パターン</span>
                          <span>必要人数</span>
                        </div>
                        <div className="grid grid-cols-[80px_60px_60px] gap-x-2 text-sm text-ink">
                          <span>全曜日</span>
                          <span>E</span>
                          <span>1</span>
                        </div>
                      </div>
                      <div className="px-4 py-2 text-xs text-ink-muted bg-ink/[0.02] border-t border-ink/10">
                        → 月火水木金土日 + <strong className="text-ink">祝日も</strong> E が 1 名必要
                      </div>
                    </div>

                    <div className="border border-ink/10 rounded-sm overflow-hidden">
                      <div
                        className="px-4 py-2 bg-brand-600/5 text-[11px] tracking-wider text-brand-600"
                        style={{ fontFamily: 'var(--font-mono)' }}
                      >
                        例 2：「祝」の行を追加した
                      </div>
                      <div className="px-4 py-3" style={{ fontFamily: 'var(--font-mono)' }}>
                        <div className="grid grid-cols-[80px_60px_60px] gap-x-2 text-xs text-ink-muted mb-1">
                          <span>曜日</span>
                          <span>パターン</span>
                          <span>必要人数</span>
                        </div>
                        <div className="grid grid-cols-[80px_60px_60px] gap-x-2 text-sm text-ink">
                          <span>全曜日</span>
                          <span>E</span>
                          <span>1</span>
                        </div>
                        <div className="grid grid-cols-[80px_60px_60px] gap-x-2 text-sm text-ink mt-0.5">
                          <span className="text-brand-600">祝</span>
                          <span>F</span>
                          <span>2</span>
                        </div>
                      </div>
                      <div className="px-4 py-2 text-xs text-ink-muted bg-ink/[0.02] border-t border-ink/10 space-y-0.5">
                        <div>→ 月〜日 = E 1名</div>
                        <div>
                          → <strong className="text-ink">祝日 = F 2名のみ</strong>（E は祝日に適用されない）
                        </div>
                      </div>
                    </div>

                    <p className="text-xs text-ink-muted">
                      まとめ：祝日に別ルールを適用したい時だけ「祝」の行を作ります。作らなければ「全曜日」が祝日も覆います。
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Templates table */}
            {tab === 'templates' && (
              <div className="bg-cream-50 border border-ink/10 rounded-sm overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr
                      className="border-b border-ink/10 text-[10px] tracking-[0.2em] uppercase text-ink-muted"
                      style={{ fontFamily: 'var(--font-mono)' }}
                    >
                      {tmplReordering && <th className="w-11 px-1 py-3"></th>}
                      <th className="text-left px-5 py-3 font-normal">曜日</th>
                      <th className="text-left px-3 py-3 font-normal">作業パターン</th>
                      <th className="text-right px-3 py-3 font-normal">必要人数</th>
                      {!tmplReordering && <th className="px-3 py-3"></th>}
                      {!tmplReordering && (
                        <th className="w-10 px-3 py-3 text-right">
                          <input
                            type="checkbox"
                            aria-label="全選択"
                            checked={
                              deptTemplates.length > 0 &&
                              selectedTmplIds.size === deptTemplates.length
                            }
                            onChange={toggleSelectAllTmpl}
                            disabled={deptTemplates.length === 0}
                            className="w-4 h-4 accent-brand-600 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                          />
                        </th>
                      )}
                    </tr>
                  </thead>
                  <SortableContainer
                    ids={tmplReordering ? tmplStore.draftOrder : []}
                    onReorder={tmplStore.setDraft}
                    disabled={!tmplReordering}
                  >
                    <tbody>
                      {loading && (
                        <tr>
                          <td colSpan={6} className="text-center py-8 text-ink-muted text-xs">
                            読み込み中…
                          </td>
                        </tr>
                      )}
                      {!loading && displayedTemplates.length === 0 && (
                        <tr>
                          <td colSpan={6} className="text-center py-12 text-ink-muted">
                            <p className="text-sm">該当するテンプレートがありません</p>
                          </td>
                        </tr>
                      )}
                      {!loading &&
                        displayedTemplates.map((t, i) => {
                          const baseCls = `border-b border-ink/5 hover:bg-brand-600/5 transition-colors ${
                            i % 2 === 1 ? 'bg-ink/[0.015]' : ''
                          }`
                          const renderCells = (
                            handle?: { attributes: React.HTMLAttributes<HTMLElement>; listeners: Record<string, unknown> | undefined },
                          ) => (
                            <>
                              {tmplReordering && (
                                <td className="px-1 py-1 align-middle">
                                  {handle && (
                                    <DragHandle
                                      attributes={handle.attributes}
                                      listeners={handle.listeners}
                                    />
                                  )}
                                </td>
                              )}
                              <td className="px-5 py-3 text-brand-900 font-medium">
                                {WEEKDAY_LABEL[t.day_of_week] ?? t.day_of_week}
                              </td>
                              <td className="px-3 py-3 text-ink">
                                {patternMap.get(t.pattern_id) ?? `#${t.pattern_id}`}
                              </td>
                              <td
                                className="px-3 py-3 text-right text-brand-900"
                                style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}
                              >
                                {t.required_max != null
                                  ? `${t.required_min}〜${t.required_max}`
                                  : t.required_min}
                              </td>
                              {!tmplReordering && (
                                <td className="px-3 py-3 text-right whitespace-nowrap">
                                  <button
                                    onClick={() => setTmplModal({ mode: 'edit', item: t })}
                                    className="text-xs text-ink-muted hover:text-brand-600 transition-colors px-2"
                                  >
                                    編集
                                  </button>
                                  <button
                                    onClick={() => setConfirmTmpl(t)}
                                    className="text-xs text-ink-muted hover:text-[#a83232] transition-colors px-2"
                                  >
                                    削除
                                  </button>
                                </td>
                              )}
                              {!tmplReordering && (
                                <td className="px-3 py-3 text-right align-middle">
                                  <input
                                    type="checkbox"
                                    aria-label={`${WEEKDAY_LABEL[t.day_of_week] ?? t.day_of_week} の行を選択`}
                                    checked={selectedTmplIds.has(t.id)}
                                    onChange={() => toggleSelectTmpl(t.id)}
                                    className="w-4 h-4 accent-brand-600 cursor-pointer"
                                  />
                                </td>
                              )}
                            </>
                          )

                          if (tmplReordering) {
                            return (
                              <SortableRow key={t.id} id={t.id} as="tr" className={baseCls}>
                                {(handle) => renderCells(handle)}
                              </SortableRow>
                            )
                          }
                          return (
                            <tr key={t.id} className={baseCls}>
                              {renderCells()}
                            </tr>
                          )
                        })}
                    </tbody>
                  </SortableContainer>
                </table>
              </div>
            )}

            {/* Overrides table */}
            {tab === 'overrides' && (
              <div className="bg-cream-50 border border-ink/10 rounded-sm overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr
                      className="border-b border-ink/10 text-[10px] tracking-[0.2em] uppercase text-ink-muted"
                      style={{ fontFamily: 'var(--font-mono)' }}
                    >
                      {overReordering && <th className="w-11 px-1 py-3"></th>}
                      <th className="text-left px-5 py-3 font-normal">対象日</th>
                      <th className="text-left px-3 py-3 font-normal">作業パターン</th>
                      <th className="text-right px-3 py-3 font-normal">必要人数</th>
                      {!overReordering && <th className="px-3 py-3"></th>}
                      {!overReordering && (
                        <th className="w-10 px-3 py-3 text-right">
                          <input
                            type="checkbox"
                            aria-label="全選択"
                            checked={
                              deptOverrides.length > 0 &&
                              selectedOverIds.size === deptOverrides.length
                            }
                            onChange={toggleSelectAllOver}
                            disabled={deptOverrides.length === 0}
                            className="w-4 h-4 accent-brand-600 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                          />
                        </th>
                      )}
                    </tr>
                  </thead>
                  <SortableContainer
                    ids={overReordering ? overStore.draftOrder : []}
                    onReorder={overStore.setDraft}
                    disabled={!overReordering}
                  >
                    <tbody>
                      {loading && (
                        <tr>
                          <td colSpan={6} className="text-center py-8 text-ink-muted text-xs">
                            読み込み中…
                          </td>
                        </tr>
                      )}
                      {!loading && displayedOverrides.length === 0 && (
                        <tr>
                          <td colSpan={6} className="text-center py-12 text-ink-muted">
                            <p className="text-sm">該当する上書きがありません</p>
                          </td>
                        </tr>
                      )}
                      {!loading &&
                        displayedOverrides.map((o, i) => {
                          const baseCls = `border-b border-ink/5 hover:bg-brand-600/5 transition-colors ${
                            i % 2 === 1 ? 'bg-ink/[0.015]' : ''
                          }`
                          const renderCells = (
                            handle?: { attributes: React.HTMLAttributes<HTMLElement>; listeners: Record<string, unknown> | undefined },
                          ) => (
                            <>
                              {overReordering && (
                                <td className="px-1 py-1 align-middle">
                                  {handle && (
                                    <DragHandle
                                      attributes={handle.attributes}
                                      listeners={handle.listeners}
                                    />
                                  )}
                                </td>
                              )}
                              <td
                                className="px-5 py-3 text-brand-900 font-medium"
                                style={{ fontFamily: 'var(--font-mono)' }}
                              >
                                {o.specific_date}
                              </td>
                              <td className="px-3 py-3 text-ink">
                                {patternMap.get(o.pattern_id) ?? `#${o.pattern_id}`}
                              </td>
                              <td
                                className="px-3 py-3 text-right text-brand-900"
                                style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}
                              >
                                {o.required_max != null
                                  ? `${o.required_min}〜${o.required_max}`
                                  : o.required_min}
                              </td>
                              {!overReordering && (
                                <td className="px-3 py-3 text-right whitespace-nowrap">
                                  <button
                                    onClick={() => setOverModal({ mode: 'edit', item: o })}
                                    className="text-xs text-ink-muted hover:text-brand-600 transition-colors px-2"
                                  >
                                    編集
                                  </button>
                                  <button
                                    onClick={() => setConfirmOver(o)}
                                    className="text-xs text-ink-muted hover:text-[#a83232] transition-colors px-2"
                                  >
                                    削除
                                  </button>
                                </td>
                              )}
                              {!overReordering && (
                                <td className="px-3 py-3 text-right align-middle">
                                  <input
                                    type="checkbox"
                                    aria-label={`${o.specific_date} の行を選択`}
                                    checked={selectedOverIds.has(o.id)}
                                    onChange={() => toggleSelectOver(o.id)}
                                    className="w-4 h-4 accent-brand-600 cursor-pointer"
                                  />
                                </td>
                              )}
                            </>
                          )

                          if (overReordering) {
                            return (
                              <SortableRow key={o.id} id={o.id} as="tr" className={baseCls}>
                                {(handle) => renderCells(handle)}
                              </SortableRow>
                            )
                          }
                          return (
                            <tr key={o.id} className={baseCls}>
                              {renderCells()}
                            </tr>
                          )
                        })}
                    </tbody>
                  </SortableContainer>
                </table>
              </div>
            )}
          </div>

          {/* Right column: CSV import (Templates タブのみ) */}
          <div className="space-y-4">
            {tab === 'templates' &&
              departmentId !== null &&
              currentDept &&
              !tmplReordering && (
                <>
                  <DayTemplateCsvUpload departmentId={departmentId} onImported={reload} />
                  <div className="bg-cream-50 border border-ink/10 rounded-sm px-4 py-3 text-[11px] text-ink-muted leading-relaxed">
                    <span
                      className="block text-[10px] tracking-[0.25em] uppercase text-brand-600 mb-1"
                      style={{ fontFamily: 'var(--font-mono)' }}
                    >
                      Note · CSV 一括インポート
                    </span>
                    選択中の部門「<strong>{currentDept.name}</strong>」に投入されます。
                    既存の <code style={{ fontFamily: 'var(--font-mono)' }}>(weekday, pattern)</code> は <code>required_min</code> / <code>required_max</code> を更新、未存在は新規作成。
                  </div>
                </>
              )}
            {(tmplReordering || overReordering) && (
              <div className="bg-cream-50 border border-ink/10 rounded-sm px-4 py-3 text-[11px] text-ink-muted leading-relaxed">
                <span
                  className="block text-[10px] tracking-[0.25em] uppercase text-brand-600 mb-1"
                  style={{ fontFamily: 'var(--font-mono)' }}
                >
                  Tips · 並び替え
                </span>
                ハンドルをドラッグして順序を入れ替えます。「確定」で全件保存、「キャンセル」で元の順序に戻ります。
              </div>
            )}
          </div>
        </div>
      </div>

      <ReorderToast useStore={useDayTemplateReorderStore} />
      <ReorderToast useStore={useDayOverrideReorderStore} />

      {tmplModal && (
        <DayTemplateFormModal
          mode={tmplModal.mode}
          initial={tmplModal.item}
          patterns={patterns}
          onClose={() => setTmplModal(null)}
          onSubmit={handleSubmitTmpl}
        />
      )}

      {overModal && (
        <DayOverrideFormModal
          mode={overModal.mode}
          initial={overModal.item}
          patterns={patterns}
          onClose={() => setOverModal(null)}
          onSubmit={handleSubmitOver}
        />
      )}

      {confirmTmpl && (
        <DeleteConfirm
          title="テンプレートを削除しますか？"
          desc={`${WEEKDAY_LABEL[confirmTmpl.day_of_week] ?? confirmTmpl.day_of_week} / ${
            patternMap.get(confirmTmpl.pattern_id) ?? `#${confirmTmpl.pattern_id}`
          } を削除します。`}
          loading={delLoading}
          onCancel={() => setConfirmTmpl(null)}
          onConfirm={() => handleDeleteTmpl(confirmTmpl)}
        />
      )}
      {confirmOver && (
        <DeleteConfirm
          title="特定日上書きを削除しますか？"
          desc={`${confirmOver.specific_date} / ${
            patternMap.get(confirmOver.pattern_id) ?? `#${confirmOver.pattern_id}`
          } を削除します。`}
          loading={delLoading}
          onCancel={() => setConfirmOver(null)}
          onConfirm={() => handleDeleteOver(confirmOver)}
        />
      )}
      {confirmBulk && (
        <DeleteConfirm
          title={`選択した ${confirmBulk.ids.length} 件を削除しますか？`}
          desc={
            confirmBulk.type === 'tmpl'
              ? '選択した曜日別テンプレートをまとめて削除します。'
              : '選択した特定日上書きをまとめて削除します。'
          }
          loading={delLoading}
          onCancel={() => setConfirmBulk(null)}
          onConfirm={handleBulkDelete}
        />
      )}
    </div>
  )
}
