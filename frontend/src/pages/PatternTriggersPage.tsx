import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  createPatternTrigger,
  deletePatternTrigger,
  listPatternTriggers,
  reorderPatternTriggers,
  updatePatternTrigger,
} from '../api/patternTriggers'
import { listDepartments } from '../api/departments'
import { listWorkPatternGroups } from '../api/workPatterns'
import PatternTriggerCsvUpload from '../components/pattern-trigger/PatternTriggerCsvUpload'
import PatternTriggerFormModal from '../components/pattern-trigger/PatternTriggerFormModal'
import DeleteConfirm from '../components/common/DeleteConfirm'
import PageHeader from '../components/common/PageHeader'
import ReorderCommitBar from '../components/reorder/ReorderCommitBar'
import ReorderToast from '../components/reorder/ReorderToast'
import SortableContainer from '../components/reorder/SortableContainer'
import SortableRow, { DragHandle } from '../components/reorder/SortableRow'
import { usePatternTriggerReorderStore } from '../stores/reorderStore'
import type { Department, PatternTrigger, WorkPatternGroup } from '../types/api'

export default function PatternTriggersPage() {
  const [departments, setDepartments] = useState<Department[]>([])
  const [departmentId, setDepartmentId] = useState<number | null>(null)
  const [groups, setGroups] = useState<WorkPatternGroup[]>([])
  const [triggers, setTriggers] = useState<PatternTrigger[]>([])
  const [loading, setLoading] = useState(false)

  const [modal, setModal] = useState<{
    mode: 'create' | 'edit'
    item: PatternTrigger | null
  } | null>(null)
  const [confirm, setConfirm] = useState<PatternTrigger | null>(null)
  const [confirmBulk, setConfirmBulk] = useState<number[] | null>(null)
  const [delLoading, setDelLoading] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [showHelp, setShowHelp] = useState(false)

  const store = usePatternTriggerReorderStore()
  const reordering = store.mode === 'reorder'

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
      const t = await listPatternTriggers()
      setTriggers(t)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  useEffect(() => {
    if (departmentId === null) return
    listWorkPatternGroups(departmentId).then(setGroups)
  }, [departmentId])

  useEffect(() => {
    setSelectedIds(new Set())
    if (reordering) store.exit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [departmentId])

  useEffect(() => {
    if (reordering) setSelectedIds(new Set())
  }, [reordering])

  const deptTriggers = useMemo(
    () =>
      departmentId !== null
        ? triggers.filter((t) => t.department_id === departmentId)
        : [],
    [triggers, departmentId],
  )

  const draftTriggers = useMemo(() => {
    if (!reordering) return []
    const byId = new Map(deptTriggers.map((t) => [t.id, t]))
    return store.draftOrder
      .map((id) => byId.get(id))
      .filter((t): t is PatternTrigger => !!t)
  }, [reordering, store.draftOrder, deptTriggers])

  const displayedTriggers = reordering ? draftTriggers : deptTriggers

  const groupMap = useMemo(
    () => new Map(groups.map((g) => [g.id, g.name])),
    [groups],
  )

  function groupName(id: number): string {
    return groupMap.get(id) ?? `#${id}`
  }

  function requiredLabel(ids: number[]): string {
    return ids.map(groupName).join(' / ')
  }

  function handleEnterReorder() {
    if (departmentId === null) return
    store.enter(deptTriggers.map((t) => t.id))
  }

  async function handleCommit(orderedIds: number[]) {
    if (departmentId === null) return
    try {
      await reorderPatternTriggers(departmentId, orderedIds)
      await reload()
      store.exit()
      store.setToast({ kind: 'success', message: '並び順を保存しました' })
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        '保存に失敗しました'
      store.setToast({ kind: 'error', message: msg })
    }
  }

  async function handleSubmit(payload: {
    auxiliary_group_id: number
    required_group_ids: number[]
  }) {
    if (departmentId === null) return
    if (modal?.mode === 'edit' && modal.item) {
      await updatePatternTrigger(modal.item.id, payload)
    } else {
      await createPatternTrigger({ ...payload, department_id: departmentId })
    }
    await reload()
  }

  async function handleDelete(t: PatternTrigger) {
    setDelLoading(true)
    try {
      await deletePatternTrigger(t.id)
      setConfirm(null)
      await reload()
    } finally {
      setDelLoading(false)
    }
  }

  async function handleBulkDelete() {
    if (!confirmBulk) return
    setDelLoading(true)
    try {
      const results = await Promise.allSettled(
        confirmBulk.map((id) => deletePatternTrigger(id)),
      )
      const succeeded = results.filter((r) => r.status === 'fulfilled').length
      const failed = results.length - succeeded

      setSelectedIds(new Set())
      setConfirmBulk(null)
      await reload()

      if (failed === 0) {
        store.setToast({ kind: 'success', message: `${succeeded} 件を削除しました` })
      } else if (succeeded === 0) {
        store.setToast({ kind: 'error', message: `削除に失敗しました（${failed} 件）` })
      } else {
        store.setToast({ kind: 'info', message: `${succeeded} 件削除、${failed} 件失敗` })
      }
    } finally {
      setDelLoading(false)
    }
  }

  function toggleSelect(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (selectedIds.size === deptTriggers.length && deptTriggers.length > 0) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(deptTriggers.map((t) => t.id)))
    }
  }

  const currentDept = departments.find((d) => d.id === departmentId)
  const auxGroups = groups.filter((g) => g.is_auxiliary)

  return (
    <div className="min-h-screen">
      <div className="max-w-6xl mx-auto px-8 py-10">
        <PageHeader
          title="発生条件"
          description="補助ポジションが稼働するための前提条件を管理します。"
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
                {displayedTriggers.length}
              </div>
            </>
          }
        />

        <ReorderCommitBar
          useStore={usePatternTriggerReorderStore}
          label="発生条件"
          onCommit={handleCommit}
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
                  disabled={reordering}
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

              {reordering ? (
                <span
                  className="text-[10px] tracking-[0.25em] uppercase text-brand-600"
                  style={{ fontFamily: 'var(--font-mono)' }}
                >
                  並び替えモード中
                </span>
              ) : (
                <>
                  {selectedIds.size > 0 && (
                    <button
                      onClick={() => setConfirmBulk(Array.from(selectedIds))}
                      className="px-3 py-2 text-xs tracking-wider uppercase text-[#a83232] border border-[#a83232]/40 hover:bg-[#a83232] hover:text-white hover:border-[#a83232] rounded-sm transition-colors"
                      style={{ fontFamily: 'var(--font-mono)' }}
                    >
                      ✕ {selectedIds.size} 件削除
                    </button>
                  )}
                  <button
                    onClick={handleEnterReorder}
                    disabled={departmentId === null || deptTriggers.length < 2}
                    className="px-3 py-2 text-xs tracking-wider uppercase text-brand-600 border border-brand-600/40 hover:bg-brand-600 hover:text-white hover:border-brand-600 rounded-sm transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-brand-600"
                    style={{ fontFamily: 'var(--font-mono)' }}
                  >
                    ⇅ 並び替え
                  </button>
                  <button
                    onClick={() => setModal({ mode: 'create', item: null })}
                    disabled={departmentId === null || auxGroups.length === 0}
                    className="px-4 py-2 text-xs tracking-wider uppercase bg-brand-900 text-cream-50 hover:bg-[#1a2940] rounded-sm transition-colors disabled:opacity-40"
                    style={{ fontFamily: 'var(--font-mono)' }}
                  >
                    + 新規追加
                  </button>
                </>
              )}
            </div>

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
                  <span className="text-ink">「発生条件」の使い方</span>
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
                    補助ポジションは、指定した <strong>必須グループ全員に作業パターンが入った日</strong> にしか割り当てられません。基本シフトが揃っていない日に補助だけ立てるのを防ぐためのルールです（H12 制約）。
                  </p>

                  <div className="border border-ink/10 rounded-sm overflow-hidden">
                    <div
                      className="px-4 py-2 bg-brand-600/5 text-[11px] tracking-wider text-brand-600"
                      style={{ fontFamily: 'var(--font-mono)' }}
                    >
                      例：補助グループ C は B / D / E が全員揃った日のみ稼働
                    </div>
                    <div className="px-4 py-3" style={{ fontFamily: 'var(--font-mono)' }}>
                      <div className="grid grid-cols-[120px_1fr] gap-x-3 text-xs text-ink-muted mb-1">
                        <span>補助</span>
                        <span>必須</span>
                      </div>
                      <div className="grid grid-cols-[120px_1fr] gap-x-3 text-sm text-ink">
                        <span>C</span>
                        <span>B / D / E</span>
                      </div>
                    </div>
                    <div className="px-4 py-2 text-xs text-ink-muted bg-ink/[0.02] border-t border-ink/10">
                      → ある日 B, D, E のうち <strong className="text-ink">1 人でも休み</strong> なら C は誰も稼働できない
                    </div>
                  </div>

                  <div className="text-xs text-ink-muted space-y-1.5 leading-relaxed">
                    <p className="font-medium text-ink">用語</p>
                    <p>
                      ・<strong className="text-ink">補助グループ</strong>：作業パターングループ画面で <code style={{ fontFamily: 'var(--font-mono)' }}>is_auxiliary=true</code> を立てたグループ。
                    </p>
                    <p>
                      ・<strong className="text-ink">必須グループ</strong>：補助稼働の前提となる通常グループ。複数指定可。
                    </p>
                    <p>
                      ・1 つの補助グループにつき発生条件は 1 行（同じ補助グループに対する CSV 再投入は必須セットを上書きします）。
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="bg-cream-50 border border-ink/10 rounded-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr
                    className="border-b border-ink/10 text-[10px] tracking-[0.2em] uppercase text-ink-muted"
                    style={{ fontFamily: 'var(--font-mono)' }}
                  >
                    {reordering && <th className="w-11 px-1 py-3"></th>}
                    <th className="text-left px-5 py-3 font-normal w-32">補助グループ</th>
                    <th className="text-left px-3 py-3 font-normal">必須グループ</th>
                    {!reordering && <th className="px-3 py-3"></th>}
                    {!reordering && (
                      <th className="w-10 px-3 py-3 text-right">
                        <input
                          type="checkbox"
                          aria-label="全選択"
                          checked={
                            deptTriggers.length > 0 &&
                            selectedIds.size === deptTriggers.length
                          }
                          onChange={toggleSelectAll}
                          disabled={deptTriggers.length === 0}
                          className="w-4 h-4 accent-brand-600 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                        />
                      </th>
                    )}
                  </tr>
                </thead>
                <SortableContainer
                  ids={reordering ? store.draftOrder : []}
                  onReorder={store.setDraft}
                  disabled={!reordering}
                >
                  <tbody>
                    {loading && (
                      <tr>
                        <td colSpan={5} className="text-center py-8 text-ink-muted text-xs">
                          読み込み中…
                        </td>
                      </tr>
                    )}
                    {!loading && displayedTriggers.length === 0 && (
                      <tr>
                        <td colSpan={5} className="text-center py-12 text-ink-muted">
                          <p className="text-sm">該当する発生条件がありません</p>
                        </td>
                      </tr>
                    )}
                    {!loading &&
                      displayedTriggers.map((t, i) => {
                        const baseCls = `border-b border-ink/5 hover:bg-brand-600/5 transition-colors ${
                          i % 2 === 1 ? 'bg-ink/[0.015]' : ''
                        }`
                        const renderCells = (
                          handle?: { attributes: React.HTMLAttributes<HTMLElement>; listeners: Record<string, unknown> | undefined },
                        ) => (
                          <>
                            {reordering && (
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
                              {groupName(t.auxiliary_group_id)}
                            </td>
                            <td className="px-3 py-3 text-ink">
                              {requiredLabel(t.required_group_ids)}
                            </td>
                            {!reordering && (
                              <td className="px-3 py-3 text-right whitespace-nowrap">
                                <button
                                  onClick={() => setModal({ mode: 'edit', item: t })}
                                  className="text-xs text-ink-muted hover:text-brand-600 transition-colors px-2"
                                >
                                  編集
                                </button>
                                <button
                                  onClick={() => setConfirm(t)}
                                  className="text-xs text-ink-muted hover:text-[#a83232] transition-colors px-2"
                                >
                                  削除
                                </button>
                              </td>
                            )}
                            {!reordering && (
                              <td className="px-3 py-3 text-right align-middle">
                                <input
                                  type="checkbox"
                                  aria-label={`${groupName(t.auxiliary_group_id)} の行を選択`}
                                  checked={selectedIds.has(t.id)}
                                  onChange={() => toggleSelect(t.id)}
                                  className="w-4 h-4 accent-brand-600 cursor-pointer"
                                />
                              </td>
                            )}
                          </>
                        )

                        if (reordering) {
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
          </div>

          <div className="space-y-4">
            {departmentId !== null && currentDept && !reordering && (
              <>
                <PatternTriggerCsvUpload departmentId={departmentId} onImported={reload} />
                <div className="bg-cream-50 border border-ink/10 rounded-sm px-4 py-3 text-[11px] text-ink-muted leading-relaxed">
                  <span
                    className="block text-[10px] tracking-[0.25em] uppercase text-brand-600 mb-1"
                    style={{ fontFamily: 'var(--font-mono)' }}
                  >
                    Note · CSV 一括インポート
                  </span>
                  選択中の部門「<strong>{currentDept.name}</strong>」に投入されます。
                  <code style={{ fontFamily: 'var(--font-mono)' }}>(department_id, auxiliary_group_id)</code> が一致するレコードは必須グループ集合を更新、無ければ新規作成。
                </div>
              </>
            )}
            {reordering && (
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

      <ReorderToast useStore={usePatternTriggerReorderStore} />

      {modal && (
        <PatternTriggerFormModal
          mode={modal.mode}
          initial={modal.item}
          groups={groups}
          onClose={() => setModal(null)}
          onSubmit={handleSubmit}
        />
      )}

      {confirm && (
        <DeleteConfirm
          title="発生条件を削除しますか？"
          desc={`${groupName(confirm.auxiliary_group_id)} → ${requiredLabel(
            confirm.required_group_ids,
          )} を削除します。`}
          loading={delLoading}
          onCancel={() => setConfirm(null)}
          onConfirm={() => handleDelete(confirm)}
        />
      )}
      {confirmBulk && (
        <DeleteConfirm
          title={`選択した ${confirmBulk.length} 件を削除しますか？`}
          desc="選択した発生条件をまとめて削除します。"
          loading={delLoading}
          onCancel={() => setConfirmBulk(null)}
          onConfirm={handleBulkDelete}
        />
      )}
    </div>
  )
}
