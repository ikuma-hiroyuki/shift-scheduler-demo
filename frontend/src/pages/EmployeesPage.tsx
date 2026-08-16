import { useCallback, useEffect, useMemo, useState } from 'react'
import ModalShell from '../components/common/ModalShell'
import {
  createEmployee,
  deleteEmployee,
  getEmployeeUsage,
  listEmployees,
  reorderEmployees,
  sortEmployeesByRole,
  updateEmployee,
} from '../api/employees'
import { listDepartments } from '../api/departments'
import EmployeeCsvUpload from '../components/employee/EmployeeCsvUpload'
import PageHeader from '../components/common/PageHeader'
import EmployeeFormModal from '../components/employee/EmployeeFormModal'
import ReorderCommitBar from '../components/reorder/ReorderCommitBar'
import ReorderToast from '../components/reorder/ReorderToast'
import SortableContainer from '../components/reorder/SortableContainer'
import SortableRow, { DragHandle } from '../components/reorder/SortableRow'
import { useEmployeeReorderStore } from '../stores/reorderStore'
import type { Department, Employee, EmployeeRole, EmployeeUsage } from '../types/api'
import { roleLabel, roleTone } from '../constants/employee'

const DAY_KEYS = ['1', '2', '3', '4', '5', '6', '0']
const DAY_LABEL: Record<string, string> = {
  '0': '日', '1': '月', '2': '火', '3': '水', '4': '木', '5': '金', '6': '土',
}
const SHIFT_LABEL: Record<string, string> = { '1': '早', '2': 'フ', '3': '遅' }

function csvSet(s: string): Set<string> {
  return new Set(s.split(',').map((t) => t.trim()).filter(Boolean))
}

export default function EmployeesPage() {
  const [departments, setDepartments] = useState<Department[]>([])
  const [departmentId, setDepartmentId] = useState<number | null>(null)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(false)
  const [modal, setModal] = useState<{ mode: 'create' | 'edit'; emp: Employee | null } | null>(null)
  const [confirmDel, setConfirmDel] = useState<Employee | null>(null)
  const [delUsage, setDelUsage] = useState<EmployeeUsage | null>(null)
  const [delLoading, setDelLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [sortByRoleConfirm, setSortByRoleConfirm] = useState(false)
  const [sortByRoleBusy, setSortByRoleBusy] = useState(false)

  const reorderMode = useEmployeeReorderStore().mode
  const draftOrder = useEmployeeReorderStore().draftOrder
  const enterReorder = useEmployeeReorderStore().enter
  const setDraft = useEmployeeReorderStore().setDraft
  const exitReorder = useEmployeeReorderStore().exit
  const setReorderToast = useEmployeeReorderStore().setToast
  const isReordering = reorderMode === 'reorder'

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
      const list = await listEmployees()
      setEmployees(list)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  // 部門が変わったり、リロードでデータが入れ替わったら並び替えモードを抜ける
  // (モード中の departmentId 切替は disable 済みなので、reload 後の整合性のみ担保)
  useEffect(() => {
    if (isReordering) exitReorder()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [departmentId])

  // 部門内の従業員 (検索フィルタ前)
  const deptEmployees = useMemo(
    () =>
      departmentId !== null
        ? employees.filter((e) => e.department_id === departmentId)
        : [],
    [employees, departmentId],
  )

  // view モード: 検索フィルタを適用
  const filtered = useMemo(() => {
    let list = deptEmployees
    const q = query.trim()
    if (q) {
      list = list.filter(
        (e) =>
          e.name.includes(q) ||
          String(e.employee_number).includes(q) ||
          roleLabel(e.role).includes(q),
      )
    }
    return list
  }, [deptEmployees, query])

  // reorder モード: draftOrder 順で deptEmployees を並び替え
  const draftEmployees = useMemo(() => {
    if (!isReordering) return []
    const byId = new Map(deptEmployees.map((e) => [e.id, e]))
    return draftOrder.map((id) => byId.get(id)).filter((e): e is Employee => !!e)
  }, [isReordering, draftOrder, deptEmployees])

  const displayed = isReordering ? draftEmployees : filtered

  function handleEnterReorder() {
    if (departmentId === null) return
    enterReorder(deptEmployees.map((e) => e.id))
  }

  async function handleCommit(orderedIds: number[]) {
    if (departmentId === null) return
    try {
      await reorderEmployees(departmentId, orderedIds)
      await reload()
      exitReorder()
      setReorderToast({ kind: 'success', message: '並び順を保存しました' })
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: string } } })?.response?.data
          ?.detail ?? '保存に失敗しました'
      setReorderToast({ kind: 'error', message: msg })
    }
  }

  async function handleSortByRole() {
    if (departmentId === null) return
    setSortByRoleBusy(true)
    try {
      await sortEmployeesByRole(departmentId)
      await reload()
      setSortByRoleConfirm(false)
      setReorderToast({
        kind: 'success',
        message: '役職→社員番号順に並び替えました',
      })
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: string } } })?.response?.data
          ?.detail ?? '並び替えに失敗しました'
      setReorderToast({ kind: 'error', message: msg })
      setSortByRoleConfirm(false)
    } finally {
      setSortByRoleBusy(false)
    }
  }

  async function handleSubmit(payload: {
    employee_number: number
    name: string
    role: EmployeeRole
    available_days: string
    available_shift_types: string
    consecutive_workable: boolean
  }) {
    if (departmentId === null) return
    if (modal?.mode === 'edit' && modal.emp) {
      await updateEmployee(modal.emp.id, {
        name: payload.name,
        role: payload.role,
        available_days: payload.available_days,
        available_shift_types: payload.available_shift_types,
        consecutive_workable: payload.consecutive_workable,
      })
    } else {
      await createEmployee({ ...payload, department_id: departmentId })
    }
    await reload()
  }

  async function openDeleteConfirm(emp: Employee) {
    setConfirmDel(emp)
    setDelUsage(null)
    try {
      const u = await getEmployeeUsage(emp.id)
      setDelUsage(u)
    } catch {
      setDelUsage({ assignment_count: 0, schedule_count: 0, leave_request_count: 0 })
    }
  }

  function closeDeleteConfirm() {
    if (delLoading) return
    setConfirmDel(null)
    setDelUsage(null)
  }

  async function handleDelete(emp: Employee) {
    setDelLoading(true)
    try {
      await deleteEmployee(emp.id)
      closeDeleteConfirm()
      await reload()
    } finally {
      setDelLoading(false)
    }
  }

  const currentDept = departments.find((d) => d.id === departmentId)

  return (
    <div className="min-h-screen">
      <div className="max-w-6xl mx-auto px-8 py-10">
        <PageHeader
          title="従業員"
          description="稼働表生成の前提となる従業員マスタを管理します"
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
                {displayed.length}
                <span className="text-base text-ink-muted">/{employees.length}</span>
              </div>
            </>
          }
        />

        <ReorderCommitBar
          useStore={useEmployeeReorderStore}
          label="従業員"
          onCommit={handleCommit}
        />

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
          {/* Left column: dept selector + table */}
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
                  disabled={isReordering}
                  className="bg-transparent border-0 border-b border-ink/30 focus:border-brand-600 focus:outline-none px-0 py-1 text-sm font-medium disabled:opacity-50"
                >
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex-1 min-w-[180px]">
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  disabled={isReordering}
                  placeholder={
                    isReordering
                      ? '並び替えモード中は検索できません'
                      : '氏名・社員番号で検索'
                  }
                  className="w-full bg-transparent border-0 border-b border-ink/15 focus:border-brand-600 focus:outline-none px-0 py-1 text-sm placeholder:text-ink-muted/60 disabled:bg-ink/5 disabled:cursor-not-allowed"
                />
              </div>
              {isReordering ? (
                <span
                  className="text-[10px] tracking-[0.25em] uppercase text-brand-600"
                  style={{ fontFamily: 'var(--font-mono)' }}
                >
                  並び替えモード中
                </span>
              ) : (
                <>
                  <button
                    onClick={handleEnterReorder}
                    disabled={departmentId === null || deptEmployees.length < 2}
                    className="px-3 py-2 text-xs tracking-wider uppercase text-brand-600 border border-brand-600/40 hover:bg-brand-600 hover:text-white hover:border-brand-600 rounded-sm transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-brand-600"
                    style={{ fontFamily: 'var(--font-mono)' }}
                  >
                    ⇅ 並び替え
                  </button>
                  <button
                    onClick={() => setSortByRoleConfirm(true)}
                    disabled={departmentId === null || deptEmployees.length < 2}
                    title="役職並び順 → 社員番号順で sort_order を再採番します"
                    className="px-3 py-2 text-xs tracking-wider uppercase text-brand-600 border border-brand-600/40 hover:bg-brand-600 hover:text-white hover:border-brand-600 rounded-sm transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-brand-600"
                    style={{ fontFamily: 'var(--font-mono)' }}
                  >
                    役職→社員番号順
                  </button>
                  <button
                    onClick={() => setModal({ mode: 'create', emp: null })}
                    disabled={departmentId === null}
                    className="px-4 py-2 text-xs tracking-wider uppercase bg-brand-900 text-cream-50 hover:bg-[#1a2940] rounded-sm transition-colors disabled:opacity-40"
                    style={{ fontFamily: 'var(--font-mono)' }}
                  >
                    + 新規追加
                  </button>
                </>
              )}
            </div>

            <div className="bg-cream-50 border border-ink/10 rounded-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-ink/10 text-[10px] tracking-[0.2em] uppercase text-ink-muted" style={{ fontFamily: 'var(--font-mono)' }}>
                    {isReordering && <th className="w-11 px-1 py-3"></th>}
                    <th className="text-left px-5 py-3 font-normal">No.</th>
                    <th className="text-left px-3 py-3 font-normal">氏名</th>
                    <th className="text-left px-3 py-3 font-normal">役職</th>
                    <th className="text-left px-3 py-3 font-normal">曜日</th>
                    <th className="text-left px-3 py-3 font-normal">番型</th>
                    <th className="text-center px-3 py-3 font-normal">連勤可</th>
                    {!isReordering && <th className="px-3 py-3"></th>}
                  </tr>
                </thead>
                <SortableContainer
                  ids={isReordering ? draftOrder : []}
                  onReorder={setDraft}
                  disabled={!isReordering}
                >
                  <tbody>
                    {loading && (
                      <tr>
                        <td colSpan={isReordering ? 7 : 7} className="text-center py-8 text-ink-muted text-xs">
                          読み込み中…
                        </td>
                      </tr>
                    )}
                    {!loading && displayed.length === 0 && (
                      <tr>
                        <td colSpan={isReordering ? 7 : 7} className="text-center py-12 text-ink-muted">
                          <p className="text-sm">該当する従業員がいません</p>
                          <p
                            className="text-[10px] tracking-widest uppercase mt-1"
                            style={{ fontFamily: 'var(--font-mono)' }}
                          >
                            + 新規追加 もしくは CSV インポート
                          </p>
                        </td>
                      </tr>
                    )}
                    {!loading &&
                      displayed.map((emp, i) => {
                        const days = csvSet(emp.available_days)
                        const shifts = csvSet(emp.available_shift_types)
                        const baseCls = `border-b border-ink/5 hover:bg-brand-600/5 transition-colors group ${
                          i % 2 === 1 ? 'bg-ink/[0.015]' : ''
                        }`
                        const renderCells = (
                          handle?: { attributes: React.HTMLAttributes<HTMLElement>; listeners: Record<string, unknown> | undefined },
                        ) => (
                          <>
                            {isReordering && (
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
                              className="px-5 py-3 text-ink-muted"
                              style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}
                            >
                              {emp.employee_number}
                            </td>
                            <td className="px-3 py-3 text-brand-900 font-medium">{emp.name}</td>
                            <td className="px-3 py-3">
                              <span
                                className={`inline-block px-2 py-0.5 text-[10px] tracking-wider rounded-sm ${roleTone(emp.role)}`}
                                style={{ fontFamily: 'var(--font-mono)' }}
                              >
                                {roleLabel(emp.role)}
                              </span>
                            </td>
                            <td className="px-3 py-3">
                              <div className="flex gap-0.5">
                                {DAY_KEYS.map((d) => (
                                  <span
                                    key={d}
                                    className={`w-5 h-5 inline-flex items-center justify-center text-[10px] rounded-sm ${
                                      days.has(d)
                                        ? 'bg-brand-900 text-cream-50'
                                        : 'bg-ink/5 text-ink-muted/50'
                                    }`}
                                    style={{ fontFamily: 'var(--font-mono)' }}
                                  >
                                    {DAY_LABEL[d]}
                                  </span>
                                ))}
                              </div>
                            </td>
                            <td className="px-3 py-3">
                              <div className="flex gap-0.5">
                                {['1', '2', '3'].map((s) => (
                                  <span
                                    key={s}
                                    className={`w-5 h-5 inline-flex items-center justify-center text-[10px] rounded-sm ${
                                      shifts.has(s)
                                        ? 'bg-brand-600 text-white'
                                        : 'bg-ink/5 text-ink-muted/50'
                                    }`}
                                    style={{ fontFamily: 'var(--font-mono)' }}
                                  >
                                    {SHIFT_LABEL[s]}
                                  </span>
                                ))}
                              </div>
                            </td>
                            <td className="px-3 py-3 text-center">
                              <span
                                className={`inline-block w-1.5 h-1.5 rounded-full ${
                                  emp.consecutive_workable ? 'bg-brand-600' : 'bg-ink/15'
                                }`}
                              />
                            </td>
                            {!isReordering && (
                              <td className="px-3 py-3 text-right whitespace-nowrap">
                                <button
                                  onClick={() => setModal({ mode: 'edit', emp })}
                                  className="text-xs text-ink-muted hover:text-brand-600 transition-colors px-2"
                                >
                                  編集
                                </button>
                                <button
                                  onClick={() => openDeleteConfirm(emp)}
                                  className="text-xs text-ink-muted hover:text-[#a83232] transition-colors px-2"
                                >
                                  削除
                                </button>
                              </td>
                            )}
                          </>
                        )

                        if (isReordering) {
                          return (
                            <SortableRow key={emp.id} id={emp.id} as="tr" className={baseCls}>
                              {(handle) => renderCells(handle)}
                            </SortableRow>
                          )
                        }
                        return (
                          <tr key={emp.id} className={baseCls}>
                            {renderCells()}
                          </tr>
                        )
                      })}
                  </tbody>
                </SortableContainer>
              </table>
            </div>
          </div>

          {/* Right column: CSV import */}
          <div className="space-y-4">
            {departmentId !== null && currentDept && !isReordering && (
              <>
                <EmployeeCsvUpload
                  departmentId={departmentId}
                  onImported={reload}
                />
                <div className="bg-cream-50 border border-ink/10 rounded-sm px-4 py-3 text-[11px] text-ink-muted leading-relaxed">
                  <span className="block text-[10px] tracking-[0.25em] uppercase text-brand-600 mb-1" style={{ fontFamily: 'var(--font-mono)' }}>
                    Note · CSV 一括インポート
                  </span>
                  選択中の部門「<strong>{currentDept.name}</strong>」に投入されます。
                  既存の <code style={{ fontFamily: 'var(--font-mono)' }}>employee_number</code> は更新、未存在は新規作成。
                </div>
              </>
            )}
            {isReordering && (
              <div className="bg-cream-50 border border-ink/10 rounded-sm px-4 py-3 text-[11px] text-ink-muted leading-relaxed">
                <span
                  className="block text-[10px] tracking-[0.25em] uppercase text-brand-600 mb-1"
                  style={{ fontFamily: 'var(--font-mono)' }}
                >
                  Tips · 並び替え
                </span>
                ハンドルをドラッグして順序を入れ替えます。キーボードでもハンドルを focus → Space → 矢印 → Space で並び替え可能。
                「確定」で全件保存、「キャンセル」で元の順序に戻ります。
              </div>
            )}
          </div>
        </div>
      </div>

      <ReorderToast useStore={useEmployeeReorderStore} />

      {sortByRoleConfirm && (
        <ModalShell onClose={() => setSortByRoleConfirm(false)} loading={sortByRoleBusy}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-cream-50 border border-ink/10 rounded-sm shadow-2xl"
          >
            <div className="px-6 py-5 border-b border-ink/10">
              <span
                className="text-[10px] tracking-[0.3em] uppercase text-brand-600"
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                Sort by Role
              </span>
              <h3
                className="text-xl font-medium text-brand-900 mt-1"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                役職→社員番号順に並べ替えますか？
              </h3>
            </div>
            <div className="px-6 py-4 text-sm text-ink space-y-2">
              <p>
                現在の役職並び順 → 社員番号 (昇順) で sort_order を再採番します。
              </p>
              <p className="text-ink-muted text-xs">
                手動で行った並び替えは上書きされます。役職並び順は管理者画面「役職」で変更できます。
              </p>
            </div>
            <div className="px-6 py-4 border-t border-ink/10 flex justify-end gap-2">
              <button
                onClick={() => setSortByRoleConfirm(false)}
                disabled={sortByRoleBusy}
                className="px-4 py-2 text-sm text-ink-muted hover:text-ink transition-colors disabled:opacity-40"
              >
                キャンセル
              </button>
              <button
                onClick={handleSortByRole}
                disabled={sortByRoleBusy}
                className="px-5 py-2 text-sm bg-brand-900 text-cream-50 hover:bg-[#1a2940] rounded-sm transition-colors disabled:opacity-50"
              >
                {sortByRoleBusy ? '並び替え中…' : '並び替える'}
              </button>
            </div>
          </div>
        </ModalShell>
      )}

      {modal && (
        <EmployeeFormModal
          mode={modal.mode}
          initial={modal.emp}
          departmentId={departmentId ?? 0}
          onClose={() => setModal(null)}
          onSubmit={handleSubmit}
        />
      )}

      {confirmDel && (
        <ModalShell onClose={closeDeleteConfirm} loading={delLoading}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-cream-50 border border-ink/10 rounded-sm shadow-2xl"
          >
            <div className="px-6 py-5 border-b border-ink/10">
              <span
                className="text-[10px] tracking-[0.3em] uppercase text-[#a83232]"
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                Delete · Cascade
              </span>
              <h3
                className="text-xl font-medium text-brand-900 mt-1"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                本当に削除しますか？
              </h3>
            </div>
            <div className="px-6 py-4 space-y-4 text-sm text-ink">
              <p>
                <span style={{ fontFamily: 'var(--font-mono)' }}>{confirmDel.employee_number}</span>{' '}
                <strong>{confirmDel.name}</strong> を削除します。
              </p>

              {delUsage === null ? (
                <p className="text-xs text-ink-muted">影響範囲を確認中…</p>
              ) : delUsage.assignment_count + delUsage.leave_request_count === 0 ? (
                <p className="text-xs text-ink-muted">関連する過去データはありません。</p>
              ) : (
                <div className="border-l-2 border-[#a83232] bg-[#a83232]/5 pl-3 py-2 space-y-2">
                  <p className="text-[11px] tracking-[0.2em] uppercase text-[#a83232]" style={{ fontFamily: 'var(--font-mono)' }}>
                    Cascade Impact · 元に戻せません
                  </p>
                  <ul className="text-xs space-y-1 text-ink">
                    {delUsage.assignment_count > 0 && (
                      <li>
                        <span className="font-medium" style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>
                          {delUsage.assignment_count}
                        </span>{' '}
                        件の稼働表割当（
                        <span style={{ fontFamily: 'var(--font-mono)' }}>{delUsage.schedule_count}</span>{' '}
                        スケジュール）が同時に削除されます
                      </li>
                    )}
                    {delUsage.leave_request_count > 0 && (
                      <li>
                        <span className="font-medium" style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>
                          {delUsage.leave_request_count}
                        </span>{' '}
                        件の勤務希望（休日希望・有給）も削除されます
                      </li>
                    )}
                  </ul>
                  {delUsage.assignment_count > 0 && (
                    <p className="text-[11px] text-[#7a4a1a] leading-relaxed pt-1">
                      ※ 既に生成済みの稼働表で、この従業員の行が空欄になります。同じ社員番号で再追加しても過去データは復元されません。
                    </p>
                  )}
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t border-ink/10 flex justify-end gap-2">
              <button
                onClick={closeDeleteConfirm}
                className="px-4 py-2 text-sm text-ink-muted hover:text-ink transition-colors"
              >
                キャンセル
              </button>
              <button
                onClick={() => handleDelete(confirmDel)}
                disabled={delLoading || delUsage === null}
                className="px-5 py-2 text-sm bg-[#a83232] text-white hover:bg-[#8e2828] rounded-sm transition-colors disabled:opacity-50"
              >
                {delLoading ? '削除中…' : '削除する'}
              </button>
            </div>
          </div>
        </ModalShell>
      )}
    </div>
  )
}
