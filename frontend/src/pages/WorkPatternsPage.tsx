import { useCallback, useEffect, useMemo, useState } from 'react'
import ModalShell from '../components/common/ModalShell'
import { listDepartments } from '../api/departments'
import { useWorkPatternGroupsStore } from '../stores/workPatternGroups'
import {
  createWorkPattern,
  createWorkPatternGroup,
  deleteWorkPattern,
  deleteWorkPatternGroup,
  downloadWorkPatternsCsv,
  listWorkPatternGroups,
  listWorkPatterns,
  reorderWorkPatternGroups,
  reorderWorkPatterns,
  updateWorkPattern,
  updateWorkPatternGroup,
} from '../api/workPatterns'
import PageHeader from '../components/common/PageHeader'
import WorkPatternGroupFormModal from '../components/work-pattern/WorkPatternGroupFormModal'
import WorkPatternFormModal from '../components/work-pattern/WorkPatternFormModal'
import ReorderCommitBar from '../components/reorder/ReorderCommitBar'
import ReorderToast from '../components/reorder/ReorderToast'
import SortableContainer from '../components/reorder/SortableContainer'
import SortableRow, { DragHandle } from '../components/reorder/SortableRow'
import {
  useGroupReorderStore,
  usePatternReorderStore,
} from '../stores/reorderStore'
import type {
  Department,
  WorkPattern,
  WorkPatternGroup,
} from '../types/api'

const SHIFT_LABEL: Record<number, string> = { 1: '早番', 2: 'フル番', 3: '遅番' }
const SHIFT_TONE: Record<number, string> = {
  1: 'bg-brand-600/15 text-[#7a4a1a]',
  2: 'bg-brand-900/8 text-brand-900',
  3: 'bg-[#3a6b6b]/15 text-[#1f4a4a]',
}

type GroupModal = { mode: 'create' | 'edit'; group: WorkPatternGroup | null } | null
type PatternModal = { mode: 'create' | 'edit'; pattern: WorkPattern | null } | null
type DeleteTarget =
  | { kind: 'group'; group: WorkPatternGroup; childCount: number }
  | { kind: 'pattern'; pattern: WorkPattern }
  | null

export default function WorkPatternsPage() {
  const [departments, setDepartments] = useState<Department[]>([])
  const [departmentId, setDepartmentId] = useState<number | null>(null)
  const [groups, setGroups] = useState<WorkPatternGroup[]>([])
  const [patterns, setPatterns] = useState<WorkPattern[]>([])
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  // issue #199: グループの mutation を ShiftGrid 等の他コンポーネントへ伝播。
  const groupsStoreSet = useWorkPatternGroupsStore((s) => s.setGroups)

  const [groupModal, setGroupModal] = useState<GroupModal>(null)
  const [patternModal, setPatternModal] = useState<PatternModal>(null)
  const [delTarget, setDelTarget] = useState<DeleteTarget>(null)
  const [delBusy, setDelBusy] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [showHelp, setShowHelp] = useState(false)

  // 並び替え state (グループ用)
  const groupReorderMode = useGroupReorderStore().mode
  const groupDraftOrder = useGroupReorderStore().draftOrder
  const enterGroupReorder = useGroupReorderStore().enter
  const setGroupDraft = useGroupReorderStore().setDraft
  const exitGroupReorder = useGroupReorderStore().exit
  const setGroupReorderToast = useGroupReorderStore().setToast
  const isGroupReordering = groupReorderMode === 'reorder'

  // 並び替え state (パターン用)
  const patternReorderMode = usePatternReorderStore().mode
  const patternDraftOrder = usePatternReorderStore().draftOrder
  const enterPatternReorder = usePatternReorderStore().enter
  const setPatternDraft = usePatternReorderStore().setDraft
  const exitPatternReorder = usePatternReorderStore().exit
  const setPatternReorderToast = usePatternReorderStore().setToast
  const isPatternReordering = patternReorderMode === 'reorder'

  useEffect(() => {
    listDepartments().then((d) => {
      setDepartments(d)
      if (d.length > 0) setDepartmentId(d[0].id)
    })
  }, [])

  const reload = useCallback(async () => {
    if (departmentId === null) return
    setLoading(true)
    try {
      const [gs, ps] = await Promise.all([
        listWorkPatternGroups(departmentId),
        listWorkPatterns(departmentId),
      ])
      setGroups(gs)
      setPatterns(ps)
      // issue #199: 他コンポーネント (ShiftGrid 等) のキャッシュを最新化
      groupsStoreSet(departmentId, gs)
      setSelectedGroupId((prev) => {
        if (prev !== null && gs.some((g) => g.id === prev)) return prev
        return gs.length > 0 ? gs[0].id : null
      })
    } finally {
      setLoading(false)
    }
  }, [departmentId, groupsStoreSet])

  useEffect(() => {
    reload()
  }, [reload])

  // 部門切替時は両方の並び替えモードを抜ける
  useEffect(() => {
    if (isGroupReordering) exitGroupReorder()
    if (isPatternReordering) exitPatternReorder()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [departmentId])

  const selectedGroup = useMemo(
    () => groups.find((g) => g.id === selectedGroupId) ?? null,
    [groups, selectedGroupId],
  )
  const groupPatterns = useMemo(
    () => patterns.filter((p) => p.group_id === selectedGroupId),
    [patterns, selectedGroupId],
  )
  const patternCountByGroup = useMemo(() => {
    const m = new Map<number, number>()
    for (const p of patterns) m.set(p.group_id, (m.get(p.group_id) ?? 0) + 1)
    return m
  }, [patterns])

  // reorder モード時、draftOrder 順で並べ直したリスト
  const draftGroups = useMemo(() => {
    if (!isGroupReordering) return groups
    const byId = new Map(groups.map((g) => [g.id, g]))
    return groupDraftOrder
      .map((id) => byId.get(id))
      .filter((g): g is WorkPatternGroup => !!g)
  }, [isGroupReordering, groupDraftOrder, groups])

  const draftPatterns = useMemo(() => {
    if (!isPatternReordering) return groupPatterns
    const byId = new Map(groupPatterns.map((p) => [p.id, p]))
    return patternDraftOrder
      .map((id) => byId.get(id))
      .filter((p): p is WorkPattern => !!p)
  }, [isPatternReordering, patternDraftOrder, groupPatterns])

  const displayGroups = draftGroups
  const displayPatterns = draftPatterns

  function handleEnterGroupReorder() {
    if (departmentId === null || groups.length < 2) return
    enterGroupReorder(groups.map((g) => g.id))
  }

  function handleEnterPatternReorder() {
    if (selectedGroup === null || groupPatterns.length < 2) return
    enterPatternReorder(groupPatterns.map((p) => p.id))
  }

  async function handleGroupCommit(orderedIds: number[]) {
    if (departmentId === null) return
    try {
      await reorderWorkPatternGroups(departmentId, orderedIds)
      await reload()
      exitGroupReorder()
      setGroupReorderToast({ kind: 'success', message: 'グループの並び順を保存しました' })
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: string } } })?.response?.data
          ?.detail ?? '保存に失敗しました'
      setGroupReorderToast({ kind: 'error', message: msg })
    }
  }

  async function handlePatternCommit(orderedIds: number[]) {
    if (selectedGroup === null) return
    try {
      await reorderWorkPatterns(selectedGroup.id, orderedIds)
      await reload()
      exitPatternReorder()
      setPatternReorderToast({
        kind: 'success',
        message: '作業パターンの並び順を保存しました',
      })
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: string } } })?.response?.data
          ?.detail ?? '保存に失敗しました'
      setPatternReorderToast({ kind: 'error', message: msg })
    }
  }

  async function handleGroupSubmit(payload: {
    name: string
    is_auxiliary: boolean
    color: string
  }) {
    if (departmentId === null) return
    if (groupModal?.mode === 'edit' && groupModal.group) {
      await updateWorkPatternGroup(groupModal.group.id, payload)
    } else {
      await createWorkPatternGroup({ ...payload, department_id: departmentId })
    }
    await reload()
  }

  async function handlePatternSubmit(payload: {
    pattern_name: string
    shift_type: number
    shift_start: string
    shift_end: string
  }) {
    if (selectedGroup === null) return
    if (patternModal?.mode === 'edit' && patternModal.pattern) {
      await updateWorkPattern(patternModal.pattern.id, payload)
    } else {
      await createWorkPattern({ group_id: selectedGroup.id, ...payload })
    }
    await reload()
  }

  function openGroupDelete(g: WorkPatternGroup) {
    setDelTarget({
      kind: 'group',
      group: g,
      childCount: patternCountByGroup.get(g.id) ?? 0,
    })
  }
  function openPatternDelete(p: WorkPattern) {
    setDelTarget({ kind: 'pattern', pattern: p })
  }

  async function handleExport() {
    if (departmentId === null) return
    setExporting(true)
    try {
      await downloadWorkPatternsCsv(departmentId)
    } finally {
      setExporting(false)
    }
  }

  async function handleDelete() {
    if (!delTarget) return
    setDelBusy(true)
    try {
      if (delTarget.kind === 'group') {
        await deleteWorkPatternGroup(delTarget.group.id)
      } else {
        await deleteWorkPattern(delTarget.pattern.id)
      }
      setDelTarget(null)
      await reload()
    } finally {
      setDelBusy(false)
    }
  }

  // 編集モード中の操作禁止フラグ
  const groupActionsDisabled = isGroupReordering || isPatternReordering
  const patternActionsDisabled = isGroupReordering || isPatternReordering

  return (
    <div className="min-h-screen">
      <div className="max-w-6xl mx-auto px-8 py-10">
        <PageHeader
          title="作業パターン"
          description="稼働表生成で割り当てるグループと作業パターンを管理します"
          rightSlot={
            <>
              <div
                className="text-[10px] tracking-[0.3em] uppercase text-ink-muted"
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                Group / Pattern
              </div>
              <div
                className="text-3xl font-medium text-brand-900 mt-1"
                style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}
              >
                {groups.length}
                <span className="text-base text-ink-muted"> · {patterns.length}</span>
              </div>
            </>
          }
        />

        <ReorderCommitBar
          useStore={useGroupReorderStore}
          label="グループ"
          onCommit={handleGroupCommit}
        />
        <ReorderCommitBar
          useStore={usePatternReorderStore}
          label="作業パターン"
          onCommit={handlePatternCommit}
        />

        {/* Department selector */}
        <div className="bg-cream-50 border border-ink/10 rounded-sm px-6 py-4 mb-4 flex flex-wrap items-center gap-4">
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
              disabled={groupActionsDisabled || patternActionsDisabled}
              className="bg-transparent border-0 border-b border-ink/30 focus:border-brand-600 focus:outline-none px-0 py-1 text-sm font-medium disabled:opacity-50"
            >
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          {loading && (
            <span
              className="text-[10px] tracking-[0.3em] uppercase text-ink-muted"
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              Loading…
            </span>
          )}
          <div className="ml-auto">
            <button
              onClick={handleExport}
              disabled={
                departmentId === null ||
                exporting ||
                patterns.length === 0 ||
                groupActionsDisabled
              }
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[10px] tracking-[0.25em] uppercase text-brand-600 border border-brand-600/40 hover:bg-brand-600 hover:text-white hover:border-brand-600 rounded-sm transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-brand-600"
              style={{ fontFamily: 'var(--font-mono)' }}
              title="現在の作業パターンを CSV でダウンロード"
            >
              <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 4v12m0 0l-4-4m4 4l4-4" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M4 19h16" strokeLinecap="round" />
              </svg>
              {exporting ? 'Exporting…' : 'Export CSV'}
            </button>
          </div>
        </div>

        {/* Help panel */}
        <div className="bg-cream-50 border border-ink/10 rounded-sm mb-4">
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
              <span className="text-ink">グループと作業パターンの違い</span>
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
              <div>
                <div
                  className="text-[11px] tracking-[0.25em] uppercase text-brand-600 mb-1"
                  style={{ fontFamily: 'var(--font-mono)' }}
                >
                  Groups
                </div>
                <p>
                  作業ポジションの分類。各グループは <strong>1 日 最大 1 名</strong> まで配置されます
                  （A1 と A2 を同じ日に稼働させることは不可）。
                </p>
                <p className="mt-1">
                  「<strong>補助</strong>」マークのグループは、他のグループが全て埋まった日だけ発動します。
                </p>
              </div>

              <div>
                <div
                  className="text-[11px] tracking-[0.25em] uppercase text-brand-600 mb-1"
                  style={{ fontFamily: 'var(--font-mono)' }}
                >
                  Patterns
                </div>
                <p>
                  各グループ内の勤務シフト候補。最適化はこの中から日ごとに 1 つを選びます。
                </p>
                <p className="mt-1">
                  名称・番型（早番 / フル番 / 遅番）・勤務時間で区別し、同じグループに複数定義しても
                  同日には 1 名分しか配置されません（グループ単位の制約）。
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4">
          {/* Group column */}
          <section className="bg-cream-50 border border-ink/10 rounded-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-ink/10 flex items-center justify-between">
              <span
                className="text-[10px] tracking-[0.3em] uppercase text-ink-muted"
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                Groups
              </span>
              <div className="flex items-center gap-1.5">
                {!isGroupReordering && (
                  <button
                    onClick={handleEnterGroupReorder}
                    disabled={
                      departmentId === null ||
                      groups.length < 2 ||
                      isPatternReordering
                    }
                    className="px-2.5 py-1.5 text-[11px] tracking-wider uppercase text-brand-600 border border-brand-600/40 hover:bg-brand-600 hover:text-white hover:border-brand-600 rounded-sm transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-brand-600"
                    style={{ fontFamily: 'var(--font-mono)' }}
                  >
                    ⇅ 並び替え
                  </button>
                )}
                <button
                  onClick={() => setGroupModal({ mode: 'create', group: null })}
                  disabled={departmentId === null || groupActionsDisabled}
                  className="px-3 py-1.5 text-[11px] tracking-wider uppercase bg-brand-900 text-cream-50 hover:bg-[#1a2940] rounded-sm transition-colors disabled:opacity-40"
                  style={{ fontFamily: 'var(--font-mono)' }}
                >
                  + 新規
                </button>
              </div>
            </div>
            <SortableContainer
              ids={isGroupReordering ? groupDraftOrder : []}
              onReorder={setGroupDraft}
              disabled={!isGroupReordering}
            >
              <ul>
                {displayGroups.length === 0 && !loading && (
                  <li className="px-5 py-10 text-center text-ink-muted text-sm">
                    グループがまだありません
                  </li>
                )}
                {displayGroups.map((g) => {
                  const isSelected = g.id === selectedGroupId
                  const childCount = patternCountByGroup.get(g.id) ?? 0
                  const baseCls = `border-b border-ink/5 transition-colors ${
                    isSelected
                      ? 'bg-brand-600/15 hover:bg-brand-600/20'
                      : 'hover:bg-brand-600/10'
                  }`
                  const renderRow = (
                    handle?: { attributes: React.HTMLAttributes<HTMLElement>; listeners: Record<string, unknown> | undefined },
                  ) => (
                    <div className="flex items-center gap-3 px-5 py-3">
                      {isGroupReordering && handle && (
                        <DragHandle
                          attributes={handle.attributes}
                          listeners={handle.listeners}
                        />
                      )}
                      <button
                        type="button"
                        aria-current={isSelected ? 'true' : undefined}
                        aria-label={`グループ ${g.name} を選択`}
                        onClick={() => setSelectedGroupId(g.id)}
                        disabled={isGroupReordering || isPatternReordering}
                        className="flex-1 min-w-0 flex items-center gap-3 text-left rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 disabled:cursor-default"
                      >
                        <span
                          className={`w-1 h-8 rounded-r ${
                            isSelected ? 'bg-brand-600' : 'bg-transparent'
                          }`}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-brand-900 font-medium text-sm">{g.name}</span>
                            {g.is_auxiliary && (
                              <span
                                className="text-[10px] text-[#7a5a3a] bg-[#7a5a3a]/10 px-1.5 py-0.5 rounded-sm"
                                title="他のグループが埋まったときだけ発動する補助ポジション"
                              >
                                補助
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-ink-muted mt-0.5">
                            パターン {childCount}件
                          </div>
                        </div>
                      </button>
                      {!isGroupReordering && (
                        <>
                          <button
                            type="button"
                            aria-label={`グループ ${g.name} を編集`}
                            onClick={() => setGroupModal({ mode: 'edit', group: g })}
                            disabled={groupActionsDisabled}
                            className="text-xs text-ink-muted hover:text-brand-600 transition-colors px-1.5 disabled:opacity-30"
                          >
                            編集
                          </button>
                          <button
                            type="button"
                            aria-label={`グループ ${g.name} を削除`}
                            onClick={() => openGroupDelete(g)}
                            disabled={groupActionsDisabled}
                            className="text-xs text-ink-muted hover:text-[#a83232] transition-colors px-1.5 disabled:opacity-30"
                          >
                            削除
                          </button>
                        </>
                      )}
                    </div>
                  )

                  if (isGroupReordering) {
                    return (
                      <SortableRow key={g.id} id={g.id} as="li" className={baseCls}>
                        {(handle) => renderRow(handle)}
                      </SortableRow>
                    )
                  }
                  return (
                    <li key={g.id} className={baseCls}>
                      {renderRow()}
                    </li>
                  )
                })}
              </ul>
            </SortableContainer>
          </section>

          {/* Pattern column */}
          <section className="bg-cream-50 border border-ink/10 rounded-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-ink/10 flex items-center justify-between">
              <div className="flex items-baseline gap-2">
                <span
                  className="text-[10px] tracking-[0.3em] uppercase text-ink-muted"
                  style={{ fontFamily: 'var(--font-mono)' }}
                >
                  Patterns
                </span>
                {selectedGroup && (
                  <span className="text-sm text-brand-900 font-medium">
                    / {selectedGroup.name}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                {!isPatternReordering && (
                  <button
                    onClick={handleEnterPatternReorder}
                    disabled={
                      selectedGroup === null ||
                      groupPatterns.length < 2 ||
                      isGroupReordering
                    }
                    className="px-2.5 py-1.5 text-[11px] tracking-wider uppercase text-brand-600 border border-brand-600/40 hover:bg-brand-600 hover:text-white hover:border-brand-600 rounded-sm transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-brand-600"
                    style={{ fontFamily: 'var(--font-mono)' }}
                  >
                    ⇅ 並び替え
                  </button>
                )}
                <button
                  onClick={() => setPatternModal({ mode: 'create', pattern: null })}
                  disabled={selectedGroup === null || patternActionsDisabled}
                  className="px-3 py-1.5 text-[11px] tracking-wider uppercase bg-brand-900 text-cream-50 hover:bg-[#1a2940] rounded-sm transition-colors disabled:opacity-40"
                  style={{ fontFamily: 'var(--font-mono)' }}
                >
                  + 新規
                </button>
              </div>
            </div>

            {selectedGroup === null ? (
              <div className="px-5 py-12 text-center text-ink-muted text-sm">
                左のグループを選択してください
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr
                    className="border-b border-ink/10 text-[10px] tracking-[0.2em] uppercase text-ink-muted"
                    style={{ fontFamily: 'var(--font-mono)' }}
                  >
                    {isPatternReordering && <th className="w-11 px-1 py-3"></th>}
                    <th className="text-left px-5 py-3 font-normal">名称</th>
                    <th className="text-left px-3 py-3 font-normal">番型</th>
                    <th className="text-left px-3 py-3 font-normal">時間</th>
                    {!isPatternReordering && <th className="px-3 py-3"></th>}
                  </tr>
                </thead>
                <SortableContainer
                  ids={isPatternReordering ? patternDraftOrder : []}
                  onReorder={setPatternDraft}
                  disabled={!isPatternReordering}
                >
                  <tbody>
                    {displayPatterns.length === 0 && (
                      <tr>
                        <td
                          colSpan={isPatternReordering ? 4 : 4}
                          className="text-center py-12 text-ink-muted"
                        >
                          <p className="text-sm">作業パターンがまだありません</p>
                          <p
                            className="text-[10px] tracking-widest uppercase mt-1"
                            style={{ fontFamily: 'var(--font-mono)' }}
                          >
                            + 新規 で追加
                          </p>
                        </td>
                      </tr>
                    )}
                    {displayPatterns.map((p, i) => {
                      const baseCls = `border-b border-ink/5 hover:bg-brand-600/5 transition-colors ${
                        i % 2 === 1 ? 'bg-ink/[0.015]' : ''
                      }`
                      const renderCells = (
                        handle?: { attributes: React.HTMLAttributes<HTMLElement>; listeners: Record<string, unknown> | undefined },
                      ) => (
                        <>
                          {isPatternReordering && (
                            <td className="px-1 py-1 align-middle">
                              {handle && (
                                <DragHandle
                                  attributes={handle.attributes}
                                  listeners={handle.listeners}
                                />
                              )}
                            </td>
                          )}
                          <td className="px-5 py-3 text-brand-900 font-medium">{p.pattern_name}</td>
                          <td className="px-3 py-3">
                            <span
                              className={`inline-block px-2 py-0.5 text-[10px] tracking-wider rounded-sm ${SHIFT_TONE[p.shift_type] ?? ''}`}
                              style={{ fontFamily: 'var(--font-mono)' }}
                            >
                              {SHIFT_LABEL[p.shift_type] ?? p.shift_type}
                            </span>
                          </td>
                          <td
                            className="px-3 py-3 text-ink"
                            style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}
                          >
                            {p.shift_start} – {p.shift_end}
                          </td>
                          {!isPatternReordering && (
                            <td className="px-3 py-3 text-right whitespace-nowrap">
                              <button
                                aria-label={`作業パターン ${p.pattern_name} を編集`}
                                onClick={() => setPatternModal({ mode: 'edit', pattern: p })}
                                disabled={patternActionsDisabled}
                                className="text-xs text-ink-muted hover:text-brand-600 transition-colors px-2 disabled:opacity-30"
                              >
                                編集
                              </button>
                              <button
                                aria-label={`作業パターン ${p.pattern_name} を削除`}
                                onClick={() => openPatternDelete(p)}
                                disabled={patternActionsDisabled}
                                className="text-xs text-ink-muted hover:text-[#a83232] transition-colors px-2 disabled:opacity-30"
                              >
                                削除
                              </button>
                            </td>
                          )}
                        </>
                      )

                      if (isPatternReordering) {
                        return (
                          <SortableRow key={p.id} id={p.id} as="tr" className={baseCls}>
                            {(handle) => renderCells(handle)}
                          </SortableRow>
                        )
                      }
                      return (
                        <tr key={p.id} className={baseCls}>
                          {renderCells()}
                        </tr>
                      )
                    })}
                  </tbody>
                </SortableContainer>
              </table>
            )}
          </section>
        </div>
      </div>

      <ReorderToast useStore={useGroupReorderStore} />
      <ReorderToast useStore={usePatternReorderStore} />

      {groupModal && (
        <WorkPatternGroupFormModal
          mode={groupModal.mode}
          initial={groupModal.group}
          existingGroups={groups.filter((g) => g.id !== groupModal.group?.id)}
          onClose={() => setGroupModal(null)}
          onSubmit={handleGroupSubmit}
        />
      )}

      {patternModal && selectedGroup && (
        <WorkPatternFormModal
          mode={patternModal.mode}
          initial={patternModal.pattern}
          group={selectedGroup}
          onClose={() => setPatternModal(null)}
          onSubmit={handlePatternSubmit}
        />
      )}

      {delTarget && (
        <ModalShell onClose={() => setDelTarget(null)} loading={delBusy}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-cream-50 border border-ink/10 rounded-sm shadow-2xl"
          >
            <div className="px-6 py-5 border-b border-ink/10">
              <span
                className="text-[10px] tracking-[0.3em] uppercase text-[#a83232]"
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                Delete{delTarget.kind === 'group' ? ' · Cascade' : ''}
              </span>
              <h3
                className="text-xl font-medium text-brand-900 mt-1"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                本当に削除しますか？
              </h3>
            </div>
            <div className="px-6 py-4 space-y-4 text-sm text-ink">
              {delTarget.kind === 'group' ? (
                <>
                  <p>
                    グループ <strong>{delTarget.group.name}</strong> を削除します。
                  </p>
                  {delTarget.childCount > 0 && (
                    <div className="border-l-2 border-[#a83232] bg-[#a83232]/5 pl-3 py-2 space-y-1">
                      <p
                        className="text-[11px] tracking-[0.2em] uppercase text-[#a83232]"
                        style={{ fontFamily: 'var(--font-mono)' }}
                      >
                        Cascade Impact
                      </p>
                      <p className="text-xs">
                        配下の{' '}
                        <span
                          className="font-medium"
                          style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}
                        >
                          {delTarget.childCount}
                        </span>{' '}
                        件の作業パターンも同時に削除されます。
                      </p>
                      <p className="text-[11px] text-[#7a4a1a] leading-relaxed pt-1">
                        ※ これらの作業パターンを参照している既存稼働表割当・優先設定が壊れる可能性があります。
                      </p>
                    </div>
                  )}
                </>
              ) : (
                <p>
                  作業パターン <strong>{delTarget.pattern.pattern_name}</strong> を削除します。
                  既存稼働表割当・優先設定がこのパターンを参照していると壊れる可能性があります。
                </p>
              )}
            </div>
            <div className="px-6 py-4 border-t border-ink/10 flex justify-end gap-2">
              <button
                onClick={() => setDelTarget(null)}
                className="px-4 py-2 text-sm text-ink-muted hover:text-ink transition-colors"
              >
                キャンセル
              </button>
              <button
                onClick={handleDelete}
                disabled={delBusy}
                className="px-5 py-2 text-sm bg-[#a83232] text-white hover:bg-[#8e2828] rounded-sm transition-colors disabled:opacity-50"
              >
                {delBusy ? '削除中…' : '削除する'}
              </button>
            </div>
          </div>
        </ModalShell>
      )}
    </div>
  )
}
