import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  createChoiceGroup,
  createIncompatibility,
  deleteChoiceGroup,
  deleteIncompatibility,
  listChoiceGroups,
  listIncompatibilities,
  reorderChoiceGroups,
  reorderIncompatibilities,
  updateChoiceGroup,
  updateIncompatibility,
} from '../api/choiceGroups'
import { listDepartments } from '../api/departments'
import { listWorkPatterns } from '../api/workPatterns'
import ChoiceGroupCsvUpload from '../components/choice-group/ChoiceGroupCsvUpload'
import ChoiceGroupFormModal from '../components/choice-group/ChoiceGroupFormModal'
import IncompatibilityFormModal from '../components/choice-group/IncompatibilityFormModal'
import DeleteConfirm from '../components/common/DeleteConfirm'
import PageHeader from '../components/common/PageHeader'
import ReorderCommitBar from '../components/reorder/ReorderCommitBar'
import ReorderToast from '../components/reorder/ReorderToast'
import SortableContainer from '../components/reorder/SortableContainer'
import SortableRow, { DragHandle } from '../components/reorder/SortableRow'
import {
  useChoiceGroupReorderStore,
  useIncompatibilityReorderStore,
} from '../stores/reorderStore'
import type {
  Department,
  PatternChoiceGroup,
  PatternIncompatibility,
  WorkPattern,
} from '../types/api'

type Tab = 'groups' | 'incompat'

const WEEKDAY_LABEL: Record<number, string> = {
  0: '月',
  1: '火',
  2: '水',
  3: '木',
  4: '金',
  5: '土',
  6: '日',
}

function dowLabel(dow: number | null): string {
  return dow === null ? '毎日' : WEEKDAY_LABEL[dow] ?? String(dow)
}

export default function ChoiceGroupsPage() {
  const [tab, setTab] = useState<Tab>('groups')
  const [departments, setDepartments] = useState<Department[]>([])
  const [departmentId, setDepartmentId] = useState<number | null>(null)
  const [patterns, setPatterns] = useState<WorkPattern[]>([])
  const [groups, setGroups] = useState<PatternChoiceGroup[]>([])
  const [incomps, setIncomps] = useState<PatternIncompatibility[]>([])
  const [loading, setLoading] = useState(false)

  const [groupModal, setGroupModal] = useState<{
    mode: 'create' | 'edit'
    item: PatternChoiceGroup | null
  } | null>(null)
  const [incompModal, setIncompModal] = useState<{
    mode: 'create' | 'edit'
    item: PatternIncompatibility | null
  } | null>(null)
  const [confirmGroup, setConfirmGroup] = useState<PatternChoiceGroup | null>(null)
  const [confirmIncomp, setConfirmIncomp] = useState<PatternIncompatibility | null>(null)
  const [delLoading, setDelLoading] = useState(false)

  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<number>>(new Set())
  const [selectedIncompIds, setSelectedIncompIds] = useState<Set<number>>(new Set())
  const [confirmBulk, setConfirmBulk] = useState<
    { type: 'group' | 'incomp'; ids: number[] } | null
  >(null)
  const [showGroupHelp, setShowGroupHelp] = useState(false)
  const [showIncompHelp, setShowIncompHelp] = useState(false)

  const groupStore = useChoiceGroupReorderStore()
  const incompStore = useIncompatibilityReorderStore()
  const groupReordering = groupStore.mode === 'reorder'
  const incompReordering = incompStore.mode === 'reorder'

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
      const [g, i] = await Promise.all([listChoiceGroups(), listIncompatibilities()])
      setGroups(g)
      setIncomps(i)
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

  useEffect(() => {
    setSelectedGroupIds(new Set())
    setSelectedIncompIds(new Set())
    if (groupReordering) groupStore.exit()
    if (incompReordering) incompStore.exit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [departmentId, tab])

  useEffect(() => {
    if (groupReordering) setSelectedGroupIds(new Set())
    if (incompReordering) setSelectedIncompIds(new Set())
  }, [groupReordering, incompReordering])

  const deptGroups = useMemo(
    () =>
      departmentId !== null
        ? groups.filter((g) => g.department_id === departmentId)
        : [],
    [groups, departmentId],
  )
  const deptIncomps = useMemo(
    () =>
      departmentId !== null
        ? incomps.filter((i) => i.department_id === departmentId)
        : [],
    [incomps, departmentId],
  )

  const draftGroups = useMemo(() => {
    if (!groupReordering) return []
    const byId = new Map(deptGroups.map((g) => [g.id, g]))
    return groupStore.draftOrder
      .map((id) => byId.get(id))
      .filter((g): g is PatternChoiceGroup => !!g)
  }, [groupReordering, groupStore.draftOrder, deptGroups])

  const draftIncomps = useMemo(() => {
    if (!incompReordering) return []
    const byId = new Map(deptIncomps.map((i) => [i.id, i]))
    return incompStore.draftOrder
      .map((id) => byId.get(id))
      .filter((i): i is PatternIncompatibility => !!i)
  }, [incompReordering, incompStore.draftOrder, deptIncomps])

  const displayedGroups = groupReordering ? draftGroups : deptGroups
  const displayedIncomps = incompReordering ? draftIncomps : deptIncomps

  const patternMap = useMemo(
    () => new Map(patterns.map((p) => [p.id, p.pattern_name])),
    [patterns],
  )

  function patternsLabel(ids: number[]): string {
    return ids.map((id) => patternMap.get(id) ?? `#${id}`).join(' / ')
  }

  function handleEnterGroupReorder() {
    if (departmentId === null) return
    groupStore.enter(deptGroups.map((g) => g.id))
  }

  function handleEnterIncompReorder() {
    if (departmentId === null) return
    incompStore.enter(deptIncomps.map((i) => i.id))
  }

  async function handleCommitGroups(orderedIds: number[]) {
    if (departmentId === null) return
    try {
      await reorderChoiceGroups(departmentId, orderedIds)
      await reload()
      groupStore.exit()
      groupStore.setToast({ kind: 'success', message: '並び順を保存しました' })
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        '保存に失敗しました'
      groupStore.setToast({ kind: 'error', message: msg })
    }
  }

  async function handleCommitIncomps(orderedIds: number[]) {
    if (departmentId === null) return
    try {
      await reorderIncompatibilities(departmentId, orderedIds)
      await reload()
      incompStore.exit()
      incompStore.setToast({ kind: 'success', message: '並び順を保存しました' })
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        '保存に失敗しました'
      incompStore.setToast({ kind: 'error', message: msg })
    }
  }

  async function handleSubmitGroup(payload: {
    day_of_weeks: (number | null)[]
    min_count: number
    max_count: number
    candidate_pattern_ids: number[]
  }) {
    if (departmentId === null) return
    if (groupModal?.mode === 'edit' && groupModal.item) {
      // edit は単一行更新（FormModal が day_of_weeks.length=1 を保証）
      await updateChoiceGroup(groupModal.item.id, {
        day_of_week: payload.day_of_weeks[0],
        min_count: payload.min_count,
        max_count: payload.max_count,
        candidate_pattern_ids: payload.candidate_pattern_ids,
      })
    } else {
      // create は選択曜日ごとに 1 行ずつ「直列」で作成。
      // POST 採番が SELECT-then-INSERT のため並列実行すると sort_order が衝突する。
      for (const dow of payload.day_of_weeks) {
        await createChoiceGroup({
          department_id: departmentId,
          day_of_week: dow,
          min_count: payload.min_count,
          max_count: payload.max_count,
          candidate_pattern_ids: payload.candidate_pattern_ids,
        })
      }
    }
    await reload()
  }

  async function handleSubmitIncomp(payload: {
    pattern_id_a: number
    pattern_id_b: number
  }) {
    if (departmentId === null) return
    if (incompModal?.mode === 'edit' && incompModal.item) {
      await updateIncompatibility(incompModal.item.id, payload)
    } else {
      await createIncompatibility({ ...payload, department_id: departmentId })
    }
    await reload()
  }

  async function handleDeleteGroup(g: PatternChoiceGroup) {
    setDelLoading(true)
    try {
      await deleteChoiceGroup(g.id)
      setConfirmGroup(null)
      await reload()
    } finally {
      setDelLoading(false)
    }
  }

  async function handleDeleteIncomp(i: PatternIncompatibility) {
    setDelLoading(true)
    try {
      await deleteIncompatibility(i.id)
      setConfirmIncomp(null)
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
        confirmBulk.type === 'group' ? deleteChoiceGroup : deleteIncompatibility
      const results = await Promise.allSettled(
        confirmBulk.ids.map((id) => deleter(id)),
      )
      const succeeded = results.filter((r) => r.status === 'fulfilled').length
      const failed = results.length - succeeded

      if (confirmBulk.type === 'group') {
        setSelectedGroupIds(new Set())
      } else {
        setSelectedIncompIds(new Set())
      }
      setConfirmBulk(null)
      await reload()

      const store = confirmBulk.type === 'group' ? groupStore : incompStore
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

  function toggleSelectGroup(id: number) {
    setSelectedGroupIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectIncomp(id: number) {
    setSelectedIncompIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAllGroup() {
    if (selectedGroupIds.size === deptGroups.length && deptGroups.length > 0) {
      setSelectedGroupIds(new Set())
    } else {
      setSelectedGroupIds(new Set(deptGroups.map((g) => g.id)))
    }
  }

  function toggleSelectAllIncomp() {
    if (selectedIncompIds.size === deptIncomps.length && deptIncomps.length > 0) {
      setSelectedIncompIds(new Set())
    } else {
      setSelectedIncompIds(new Set(deptIncomps.map((i) => i.id)))
    }
  }

  const currentDept = departments.find((d) => d.id === departmentId)

  return (
    <div className="min-h-screen">
      <div className="max-w-6xl mx-auto px-8 py-10">
        <PageHeader
          title="選択グループ"
          description="候補パターンの選択ルールと、同日に共存できないパターン対を管理します。"
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
                {tab === 'groups' ? displayedGroups.length : displayedIncomps.length}
              </div>
            </>
          }
        />

        <div className="flex gap-1 mb-4 border-b border-ink/10">
          <button
            onClick={() => setTab('groups')}
            disabled={groupReordering || incompReordering}
            className={`px-5 py-2 text-sm tracking-wider transition-colors disabled:opacity-50 ${
              tab === 'groups'
                ? 'text-brand-900 border-b-2 border-brand-600 -mb-px'
                : 'text-ink-muted hover:text-brand-600'
            }`}
          >
            選択グループ
          </button>
          <button
            onClick={() => setTab('incompat')}
            disabled={groupReordering || incompReordering}
            className={`px-5 py-2 text-sm tracking-wider transition-colors disabled:opacity-50 ${
              tab === 'incompat'
                ? 'text-brand-900 border-b-2 border-brand-600 -mb-px'
                : 'text-ink-muted hover:text-brand-600'
            }`}
          >
            非両立ルール
          </button>
        </div>

        <ReorderCommitBar
          useStore={useChoiceGroupReorderStore}
          label="選択グループ"
          onCommit={handleCommitGroups}
        />
        <ReorderCommitBar
          useStore={useIncompatibilityReorderStore}
          label="非両立ルール"
          onCommit={handleCommitIncomps}
        />

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
          <div className="space-y-4">
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
                  disabled={groupReordering || incompReordering}
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

              {tab === 'groups' ? (
                groupReordering ? (
                  <span
                    className="text-[10px] tracking-[0.25em] uppercase text-brand-600"
                    style={{ fontFamily: 'var(--font-mono)' }}
                  >
                    並び替えモード中
                  </span>
                ) : (
                  <>
                    {selectedGroupIds.size > 0 && (
                      <button
                        onClick={() =>
                          setConfirmBulk({
                            type: 'group',
                            ids: Array.from(selectedGroupIds),
                          })
                        }
                        className="px-3 py-2 text-xs tracking-wider uppercase text-[#a83232] border border-[#a83232]/40 hover:bg-[#a83232] hover:text-white hover:border-[#a83232] rounded-sm transition-colors"
                        style={{ fontFamily: 'var(--font-mono)' }}
                      >
                        ✕ {selectedGroupIds.size} 件削除
                      </button>
                    )}
                    <button
                      onClick={handleEnterGroupReorder}
                      disabled={departmentId === null || deptGroups.length < 2}
                      className="px-3 py-2 text-xs tracking-wider uppercase text-brand-600 border border-brand-600/40 hover:bg-brand-600 hover:text-white hover:border-brand-600 rounded-sm transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-brand-600"
                      style={{ fontFamily: 'var(--font-mono)' }}
                    >
                      ⇅ 並び替え
                    </button>
                    <button
                      onClick={() => setGroupModal({ mode: 'create', item: null })}
                      disabled={departmentId === null || patterns.length === 0}
                      className="px-4 py-2 text-xs tracking-wider uppercase bg-brand-900 text-cream-50 hover:bg-[#1a2940] rounded-sm transition-colors disabled:opacity-40"
                      style={{ fontFamily: 'var(--font-mono)' }}
                    >
                      + 新規追加
                    </button>
                  </>
                )
              ) : incompReordering ? (
                <span
                  className="text-[10px] tracking-[0.25em] uppercase text-brand-600"
                  style={{ fontFamily: 'var(--font-mono)' }}
                >
                  並び替えモード中
                </span>
              ) : (
                <>
                  {selectedIncompIds.size > 0 && (
                    <button
                      onClick={() =>
                        setConfirmBulk({
                          type: 'incomp',
                          ids: Array.from(selectedIncompIds),
                        })
                      }
                      className="px-3 py-2 text-xs tracking-wider uppercase text-[#a83232] border border-[#a83232]/40 hover:bg-[#a83232] hover:text-white hover:border-[#a83232] rounded-sm transition-colors"
                      style={{ fontFamily: 'var(--font-mono)' }}
                    >
                      ✕ {selectedIncompIds.size} 件削除
                    </button>
                  )}
                  <button
                    onClick={handleEnterIncompReorder}
                    disabled={departmentId === null || deptIncomps.length < 2}
                    className="px-3 py-2 text-xs tracking-wider uppercase text-brand-600 border border-brand-600/40 hover:bg-brand-600 hover:text-white hover:border-brand-600 rounded-sm transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-brand-600"
                    style={{ fontFamily: 'var(--font-mono)' }}
                  >
                    ⇅ 並び替え
                  </button>
                  <button
                    onClick={() => setIncompModal({ mode: 'create', item: null })}
                    disabled={departmentId === null || patterns.length < 2}
                    className="px-4 py-2 text-xs tracking-wider uppercase bg-brand-900 text-cream-50 hover:bg-[#1a2940] rounded-sm transition-colors disabled:opacity-40"
                    style={{ fontFamily: 'var(--font-mono)' }}
                  >
                    + 新規追加
                  </button>
                </>
              )}
            </div>

            {/* Help panel (groups タブ) */}
            {tab === 'groups' && (
              <div className="bg-cream-50 border border-ink/10 rounded-sm">
                <button
                  type="button"
                  onClick={() => setShowGroupHelp((v) => !v)}
                  aria-expanded={showGroupHelp}
                  className="w-full flex items-center justify-between px-5 py-3 text-left hover:bg-brand-600/5 transition-colors"
                >
                  <span className="flex items-center gap-2 text-xs text-brand-600 tracking-wider">
                    <span
                      className="text-[10px] tracking-[0.25em] uppercase"
                      style={{ fontFamily: 'var(--font-mono)' }}
                    >
                      Help
                    </span>
                    <span className="text-ink">「選択グループ」の使い方</span>
                  </span>
                  <span
                    className={`text-ink-muted transition-transform ${showGroupHelp ? 'rotate-180' : ''}`}
                    aria-hidden="true"
                  >
                    ▾
                  </span>
                </button>
                {showGroupHelp && (
                  <div className="px-5 pb-5 pt-1 text-[13px] text-ink leading-relaxed space-y-4 border-t border-ink/10">
                    <p>
                      候補パターンの中から「<strong>最小〜最大</strong>件」だけ選んで割り当てるルールです。同じ役割を持つパターンが複数あって <strong>1 つだけ使いたい</strong>、あるいは <strong>0〜2 件まで自由に使いたい</strong> といった制約をかけられます。
                    </p>

                    <div className="border border-ink/10 rounded-sm overflow-hidden">
                      <div
                        className="px-4 py-2 bg-brand-600/5 text-[11px] tracking-wider text-brand-600"
                        style={{ fontFamily: 'var(--font-mono)' }}
                      >
                        例 1：早番のうち 1 つだけ使う（XOR）
                      </div>
                      <div className="px-4 py-3" style={{ fontFamily: 'var(--font-mono)' }}>
                        <div className="grid grid-cols-[80px_1fr_60px] gap-x-2 text-xs text-ink-muted mb-1">
                          <span>曜日</span>
                          <span>候補</span>
                          <span className="text-right">選択数</span>
                        </div>
                        <div className="grid grid-cols-[80px_1fr_60px] gap-x-2 text-sm text-ink">
                          <span>毎日</span>
                          <span>A1 / A2 / A3</span>
                          <span className="text-right">1</span>
                        </div>
                      </div>
                      <div className="px-4 py-2 text-xs text-ink-muted bg-ink/[0.02] border-t border-ink/10">
                        → 各日 A1 / A2 / A3 のうち <strong className="text-ink">必ず 1 つ</strong> が割り当てられる
                      </div>
                    </div>

                    <div className="border border-ink/10 rounded-sm overflow-hidden">
                      <div
                        className="px-4 py-2 bg-brand-600/5 text-[11px] tracking-wider text-brand-600"
                        style={{ fontFamily: 'var(--font-mono)' }}
                      >
                        例 2：補助ポジションは 0〜2 名で可変
                      </div>
                      <div className="px-4 py-3" style={{ fontFamily: 'var(--font-mono)' }}>
                        <div className="grid grid-cols-[80px_1fr_60px] gap-x-2 text-xs text-ink-muted mb-1">
                          <span>曜日</span>
                          <span>候補</span>
                          <span className="text-right">選択数</span>
                        </div>
                        <div className="grid grid-cols-[80px_1fr_60px] gap-x-2 text-sm text-ink">
                          <span>毎日</span>
                          <span>B1 / B2</span>
                          <span className="text-right">0〜2</span>
                        </div>
                      </div>
                      <div className="px-4 py-2 text-xs text-ink-muted bg-ink/[0.02] border-t border-ink/10">
                        → 各日 B1 / B2 を <strong className="text-ink">0 件 / 1 件 / 2 件</strong> 自由に組み合わせ可能
                      </div>
                    </div>

                    <div className="border border-ink/10 rounded-sm overflow-hidden">
                      <div
                        className="px-4 py-2 bg-brand-600/5 text-[11px] tracking-wider text-brand-600"
                        style={{ fontFamily: 'var(--font-mono)' }}
                      >
                        例 3：木曜だけのルール
                      </div>
                      <div className="px-4 py-3" style={{ fontFamily: 'var(--font-mono)' }}>
                        <div className="grid grid-cols-[80px_1fr_60px] gap-x-2 text-xs text-ink-muted mb-1">
                          <span>曜日</span>
                          <span>候補</span>
                          <span className="text-right">選択数</span>
                        </div>
                        <div className="grid grid-cols-[80px_1fr_60px] gap-x-2 text-sm text-ink">
                          <span className="text-brand-600">木</span>
                          <span>C1 / C2</span>
                          <span className="text-right">1</span>
                        </div>
                      </div>
                      <div className="px-4 py-2 text-xs text-ink-muted bg-ink/[0.02] border-t border-ink/10">
                        → <strong className="text-ink">木曜のみ</strong> C1 / C2 のいずれかを 1 つ割り当てる。他曜日には影響しない。
                      </div>
                    </div>

                    <div className="text-xs text-ink-muted space-y-1.5 leading-relaxed">
                      <p className="font-medium text-ink">用語</p>
                      <p>
                        ・<strong className="text-ink">曜日</strong>：「毎日」を選ぶと全曜日に適用、特定の曜日（月〜日）を選ぶとその曜日だけに適用される。
                      </p>
                      <p>
                        ・<strong className="text-ink">選択数</strong>：候補のうち、その日に同時に使われるパターン数。範囲がある場合は <code style={{ fontFamily: 'var(--font-mono)' }}>下限〜上限</code> で表示する。<code style={{ fontFamily: 'var(--font-mono)' }}>1</code> で「必ず 1 つ」、<code style={{ fontFamily: 'var(--font-mono)' }}>0〜2</code> で「使わない日があってもよく最大 2 つまで」。
                      </p>
                      <p>
                        ・<strong className="text-ink">候補パターン</strong>：このグループの対象となる作業パターン。日テンプレート（NAV 05）で必要人数 0 にしたパターンは、ここで候補として選ばないと割り当てられない。
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Help panel (incompat タブ) */}
            {tab === 'incompat' && (
              <div className="bg-cream-50 border border-ink/10 rounded-sm">
                <button
                  type="button"
                  onClick={() => setShowIncompHelp((v) => !v)}
                  aria-expanded={showIncompHelp}
                  className="w-full flex items-center justify-between px-5 py-3 text-left hover:bg-brand-600/5 transition-colors"
                >
                  <span className="flex items-center gap-2 text-xs text-brand-600 tracking-wider">
                    <span
                      className="text-[10px] tracking-[0.25em] uppercase"
                      style={{ fontFamily: 'var(--font-mono)' }}
                    >
                      Help
                    </span>
                    <span className="text-ink">「非両立ルール」の使い方</span>
                  </span>
                  <span
                    className={`text-ink-muted transition-transform ${showIncompHelp ? 'rotate-180' : ''}`}
                    aria-hidden="true"
                  >
                    ▾
                  </span>
                </button>
                {showIncompHelp && (
                  <div className="px-5 pb-5 pt-1 text-[13px] text-ink leading-relaxed space-y-4 border-t border-ink/10">
                    <p>
                      指定した <strong>2 つの作業パターン</strong> を、<strong>同じ日の店舗運用に同時に並べない</strong> ためのルールです。役割が衝突するパターンや、稼働時間が大きく重なって意味的に共存しない組み合わせを禁止できます。
                    </p>

                    <div className="border border-ink/10 rounded-sm overflow-hidden">
                      <div
                        className="px-4 py-2 bg-brand-600/5 text-[11px] tracking-wider text-brand-600"
                        style={{ fontFamily: 'var(--font-mono)' }}
                      >
                        例：A1（フル早番）と B2（時短早番）は同日に同居しない
                      </div>
                      <div className="px-4 py-3" style={{ fontFamily: 'var(--font-mono)' }}>
                        <div className="grid grid-cols-[1fr_1fr] gap-x-2 text-xs text-ink-muted mb-1">
                          <span>パターン A</span>
                          <span>パターン B</span>
                        </div>
                        <div className="grid grid-cols-[1fr_1fr] gap-x-2 text-sm text-ink">
                          <span>A1（07:00–15:30）</span>
                          <span>B2（07:00–11:30）</span>
                        </div>
                      </div>
                      <div className="px-4 py-2 text-xs text-ink-muted bg-ink/[0.02] border-t border-ink/10">
                        → ある日 A1 が 1 名でも入っていれば、その日 B2 は 0 名になる（逆も同様）
                      </div>
                    </div>

                    <div className="text-xs text-ink-muted space-y-1.5 leading-relaxed">
                      <p className="font-medium text-ink">補足</p>
                      <p>
                        ・対象は <strong className="text-ink">同じ日</strong>。別日に A1 と B2 が並ぶのは問題なし。
                      </p>
                      <p>
                        ・順序は無関係。<code style={{ fontFamily: 'var(--font-mono)' }}>A1 ↔ B2</code> を 1 行登録すれば双方向に効く。
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Groups table */}
            {tab === 'groups' && (
              <div className="bg-cream-50 border border-ink/10 rounded-sm overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr
                      className="border-b border-ink/10 text-[10px] tracking-[0.2em] uppercase text-ink-muted"
                      style={{ fontFamily: 'var(--font-mono)' }}
                    >
                      {groupReordering && <th className="w-11 px-1 py-3"></th>}
                      <th className="text-left px-5 py-3 font-normal">曜日</th>
                      <th className="text-left px-3 py-3 font-normal">候補パターン</th>
                      <th className="text-right px-3 py-3 font-normal w-24">選択数</th>
                      {!groupReordering && <th className="px-3 py-3"></th>}
                      {!groupReordering && (
                        <th className="w-10 px-3 py-3 text-right">
                          <input
                            type="checkbox"
                            aria-label="全選択"
                            checked={
                              deptGroups.length > 0 &&
                              selectedGroupIds.size === deptGroups.length
                            }
                            onChange={toggleSelectAllGroup}
                            disabled={deptGroups.length === 0}
                            className="w-4 h-4 accent-brand-600 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                          />
                        </th>
                      )}
                    </tr>
                  </thead>
                  <SortableContainer
                    ids={groupReordering ? groupStore.draftOrder : []}
                    onReorder={groupStore.setDraft}
                    disabled={!groupReordering}
                  >
                    <tbody>
                      {loading && (
                        <tr>
                          <td colSpan={6} className="text-center py-8 text-ink-muted text-xs">
                            読み込み中…
                          </td>
                        </tr>
                      )}
                      {!loading && displayedGroups.length === 0 && (
                        <tr>
                          <td colSpan={6} className="text-center py-12 text-ink-muted">
                            <p className="text-sm">該当する選択グループがありません</p>
                          </td>
                        </tr>
                      )}
                      {!loading &&
                        displayedGroups.map((g, i) => {
                          const baseCls = `border-b border-ink/5 hover:bg-brand-600/5 transition-colors ${
                            i % 2 === 1 ? 'bg-ink/[0.015]' : ''
                          }`
                          const renderCells = (
                            handle?: { attributes: React.HTMLAttributes<HTMLElement>; listeners: Record<string, unknown> | undefined },
                          ) => (
                            <>
                              {groupReordering && (
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
                                {dowLabel(g.day_of_week)}
                              </td>
                              <td className="px-3 py-3 text-ink">
                                {patternsLabel(g.candidate_pattern_ids)}
                              </td>
                              <td
                                className="px-3 py-3 text-right text-brand-900"
                                style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}
                              >
                                {g.min_count === g.max_count
                                  ? g.min_count
                                  : `${g.min_count}〜${g.max_count}`}
                              </td>
                              {!groupReordering && (
                                <td className="px-3 py-3 text-right whitespace-nowrap">
                                  <button
                                    onClick={() => setGroupModal({ mode: 'edit', item: g })}
                                    className="text-xs text-ink-muted hover:text-brand-600 transition-colors px-2"
                                  >
                                    編集
                                  </button>
                                  <button
                                    onClick={() => setConfirmGroup(g)}
                                    className="text-xs text-ink-muted hover:text-[#a83232] transition-colors px-2"
                                  >
                                    削除
                                  </button>
                                </td>
                              )}
                              {!groupReordering && (
                                <td className="px-3 py-3 text-right align-middle">
                                  <input
                                    type="checkbox"
                                    aria-label={`${dowLabel(g.day_of_week)} の行を選択`}
                                    checked={selectedGroupIds.has(g.id)}
                                    onChange={() => toggleSelectGroup(g.id)}
                                    className="w-4 h-4 accent-brand-600 cursor-pointer"
                                  />
                                </td>
                              )}
                            </>
                          )

                          if (groupReordering) {
                            return (
                              <SortableRow key={g.id} id={g.id} as="tr" className={baseCls}>
                                {(handle) => renderCells(handle)}
                              </SortableRow>
                            )
                          }
                          return (
                            <tr key={g.id} className={baseCls}>
                              {renderCells()}
                            </tr>
                          )
                        })}
                    </tbody>
                  </SortableContainer>
                </table>
              </div>
            )}

            {/* Incompat table */}
            {tab === 'incompat' && (
              <div className="bg-cream-50 border border-ink/10 rounded-sm overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr
                      className="border-b border-ink/10 text-[10px] tracking-[0.2em] uppercase text-ink-muted"
                      style={{ fontFamily: 'var(--font-mono)' }}
                    >
                      {incompReordering && <th className="w-11 px-1 py-3"></th>}
                      <th className="text-left px-5 py-3 font-normal">パターン A</th>
                      <th className="text-left px-3 py-3 font-normal">パターン B</th>
                      {!incompReordering && <th className="px-3 py-3"></th>}
                      {!incompReordering && (
                        <th className="w-10 px-3 py-3 text-right">
                          <input
                            type="checkbox"
                            aria-label="全選択"
                            checked={
                              deptIncomps.length > 0 &&
                              selectedIncompIds.size === deptIncomps.length
                            }
                            onChange={toggleSelectAllIncomp}
                            disabled={deptIncomps.length === 0}
                            className="w-4 h-4 accent-brand-600 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                          />
                        </th>
                      )}
                    </tr>
                  </thead>
                  <SortableContainer
                    ids={incompReordering ? incompStore.draftOrder : []}
                    onReorder={incompStore.setDraft}
                    disabled={!incompReordering}
                  >
                    <tbody>
                      {loading && (
                        <tr>
                          <td colSpan={5} className="text-center py-8 text-ink-muted text-xs">
                            読み込み中…
                          </td>
                        </tr>
                      )}
                      {!loading && displayedIncomps.length === 0 && (
                        <tr>
                          <td colSpan={5} className="text-center py-12 text-ink-muted">
                            <p className="text-sm">該当する非両立ルールがありません</p>
                          </td>
                        </tr>
                      )}
                      {!loading &&
                        displayedIncomps.map((it, i) => {
                          const baseCls = `border-b border-ink/5 hover:bg-brand-600/5 transition-colors ${
                            i % 2 === 1 ? 'bg-ink/[0.015]' : ''
                          }`
                          const renderCells = (
                            handle?: { attributes: React.HTMLAttributes<HTMLElement>; listeners: Record<string, unknown> | undefined },
                          ) => (
                            <>
                              {incompReordering && (
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
                                {patternMap.get(it.pattern_id_a) ?? `#${it.pattern_id_a}`}
                              </td>
                              <td className="px-3 py-3 text-ink">
                                {patternMap.get(it.pattern_id_b) ?? `#${it.pattern_id_b}`}
                              </td>
                              {!incompReordering && (
                                <td className="px-3 py-3 text-right whitespace-nowrap">
                                  <button
                                    onClick={() => setIncompModal({ mode: 'edit', item: it })}
                                    className="text-xs text-ink-muted hover:text-brand-600 transition-colors px-2"
                                  >
                                    編集
                                  </button>
                                  <button
                                    onClick={() => setConfirmIncomp(it)}
                                    className="text-xs text-ink-muted hover:text-[#a83232] transition-colors px-2"
                                  >
                                    削除
                                  </button>
                                </td>
                              )}
                              {!incompReordering && (
                                <td className="px-3 py-3 text-right align-middle">
                                  <input
                                    type="checkbox"
                                    aria-label="この行を選択"
                                    checked={selectedIncompIds.has(it.id)}
                                    onChange={() => toggleSelectIncomp(it.id)}
                                    className="w-4 h-4 accent-brand-600 cursor-pointer"
                                  />
                                </td>
                              )}
                            </>
                          )

                          if (incompReordering) {
                            return (
                              <SortableRow key={it.id} id={it.id} as="tr" className={baseCls}>
                                {(handle) => renderCells(handle)}
                              </SortableRow>
                            )
                          }
                          return (
                            <tr key={it.id} className={baseCls}>
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

          {/* Right column: CSV import */}
          <div className="space-y-4">
            {tab === 'groups' &&
              departmentId !== null &&
              currentDept &&
              !groupReordering && (
                <>
                  <ChoiceGroupCsvUpload departmentId={departmentId} onImported={reload} />
                  <div className="bg-cream-50 border border-ink/10 rounded-sm px-4 py-3 text-[11px] text-ink-muted leading-relaxed">
                    <span
                      className="block text-[10px] tracking-[0.25em] uppercase text-brand-600 mb-1"
                      style={{ fontFamily: 'var(--font-mono)' }}
                    >
                      Note · CSV 一括インポート
                    </span>
                    選択中の部門「<strong>{currentDept.name}</strong>」に投入されます。
                    <code style={{ fontFamily: 'var(--font-mono)' }}>(day_of_week, 候補集合)</code> が一致するレコードは <code>min/max</code> を更新、無ければ新規作成。
                  </div>
                </>
              )}
            {(groupReordering || incompReordering) && (
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

      <ReorderToast useStore={useChoiceGroupReorderStore} />
      <ReorderToast useStore={useIncompatibilityReorderStore} />

      {groupModal && (
        <ChoiceGroupFormModal
          mode={groupModal.mode}
          initial={groupModal.item}
          patterns={patterns}
          onClose={() => setGroupModal(null)}
          onSubmit={handleSubmitGroup}
        />
      )}

      {incompModal && (
        <IncompatibilityFormModal
          mode={incompModal.mode}
          initial={incompModal.item}
          patterns={patterns}
          onClose={() => setIncompModal(null)}
          onSubmit={handleSubmitIncomp}
        />
      )}

      {confirmGroup && (
        <DeleteConfirm
          title="選択グループを削除しますか？"
          desc={`${dowLabel(confirmGroup.day_of_week)} / ${patternsLabel(
            confirmGroup.candidate_pattern_ids,
          )} を削除します。`}
          loading={delLoading}
          onCancel={() => setConfirmGroup(null)}
          onConfirm={() => handleDeleteGroup(confirmGroup)}
        />
      )}
      {confirmIncomp && (
        <DeleteConfirm
          title="非両立ルールを削除しますか？"
          desc={`${patternMap.get(confirmIncomp.pattern_id_a) ?? `#${confirmIncomp.pattern_id_a}`} / ${
            patternMap.get(confirmIncomp.pattern_id_b) ?? `#${confirmIncomp.pattern_id_b}`
          } を削除します。`}
          loading={delLoading}
          onCancel={() => setConfirmIncomp(null)}
          onConfirm={() => handleDeleteIncomp(confirmIncomp)}
        />
      )}
      {confirmBulk && (
        <DeleteConfirm
          title={`選択した ${confirmBulk.ids.length} 件を削除しますか？`}
          desc={
            confirmBulk.type === 'group'
              ? '選択した選択グループをまとめて削除します。'
              : '選択した非両立ルールをまとめて削除します。'
          }
          loading={delLoading}
          onCancel={() => setConfirmBulk(null)}
          onConfirm={handleBulkDelete}
        />
      )}
    </div>
  )
}
