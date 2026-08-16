import { useCallback, useEffect, useState } from 'react'
import ModalShell from '../components/common/ModalShell'
import {
  createRole,
  deleteRole,
  listRoles,
  reorderRoles,
  updateRole,
} from '../api/roles'
import DeleteConfirm from '../components/common/DeleteConfirm'
import PageHeader from '../components/common/PageHeader'
import ReorderCommitBar from '../components/reorder/ReorderCommitBar'
import ReorderToast from '../components/reorder/ReorderToast'
import SortableContainer from '../components/reorder/SortableContainer'
import SortableRow, { DragHandle } from '../components/reorder/SortableRow'
import { useRoleReorderStore } from '../stores/reorderStore'
import { useRoleStore } from '../stores/roles'
import type { Role } from '../types/api'

const CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,19}$/

interface FormState {
  mode: 'create' | 'edit'
  code: string
  name: string
  rest_days_28_29: string
  rest_days_30: string
  rest_days_31: string
  originalCode?: string
}

export default function RolesPage() {
  const fetchStoreRoles = useRoleStore((s) => s.fetch)
  const [roles, setRoles] = useState<Role[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState<FormState | null>(null)
  const [deleting, setDeleting] = useState<Role | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const isReordering = useRoleReorderStore((s) => s.mode === 'reorder')
  const draftOrder = useRoleReorderStore((s) => s.draftOrder)
  const enterReorder = useRoleReorderStore((s) => s.enter)
  const exitReorder = useRoleReorderStore((s) => s.exit)
  const setDraft = useRoleReorderStore((s) => s.setDraft)
  const setReorderToast = useRoleReorderStore((s) => s.setToast)

  const reload = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const list = await listRoles()
      setRoles(list)
    } catch {
      setError('役職一覧の取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  // role.code を index に変換した「擬似 ID」配列を SortableContainer に渡す
  const ids = roles.map((_, i) => i)
  const orderedRoles = isReordering
    ? draftOrder.map((i) => roles[i]).filter(Boolean)
    : roles

  function handleEnterReorder() {
    enterReorder(roles.map((_, i) => i))
  }

  async function handleCommitReorder(orderedIds: number[]) {
    try {
      const codes = orderedIds.map((i) => roles[i].code)
      const updated = await reorderRoles(codes)
      setRoles(updated)
      await fetchStoreRoles()
      exitReorder()
      setReorderToast({ kind: 'success', message: '役職の並び順を保存しました' })
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        '保存に失敗しました'
      setReorderToast({ kind: 'error', message: msg })
    }
  }

  async function handleSubmitForm(e: React.FormEvent) {
    e.preventDefault()
    if (!form) return
    setError('')
    if (form.mode === 'create') {
      const code = form.code.trim()
      if (!CODE_PATTERN.test(code)) {
        setError('役職コードは英大文字で始まり、英大文字・数字・_ のみ、最大20文字')
        return
      }
    }
    if (!form.name.trim()) {
      setError('役職名を入力してください')
      return
    }
    const restDays2829 = parseInt(form.rest_days_28_29, 10)
    const restDays30 = parseInt(form.rest_days_30, 10)
    const restDays31 = parseInt(form.rest_days_31, 10)
    if (
      Number.isNaN(restDays2829) ||
      Number.isNaN(restDays30) ||
      Number.isNaN(restDays31)
    ) {
      setError('休日数を数値で入力してください')
      return
    }
    try {
      if (form.mode === 'create') {
        await createRole({
          code: form.code.trim(),
          name: form.name.trim(),
          rest_days_28_29: restDays2829,
          rest_days_30: restDays30,
          rest_days_31: restDays31,
        })
      } else {
        await updateRole(form.originalCode!, {
          name: form.name.trim(),
          rest_days_28_29: restDays2829,
          rest_days_30: restDays30,
          rest_days_31: restDays31,
        })
      }
      setForm(null)
      await reload()
      await fetchStoreRoles()
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        '保存に失敗しました'
      setError(msg)
    }
  }

  async function handleDelete() {
    if (!deleting) return
    setDeleteBusy(true)
    try {
      await deleteRole(deleting.code)
      setDeleting(null)
      await reload()
      await fetchStoreRoles()
      setReorderToast({ kind: 'success', message: `役職 ${deleting.code} を削除しました` })
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        '削除に失敗しました'
      setReorderToast({ kind: 'error', message: msg })
      setDeleting(null)
    } finally {
      setDeleteBusy(false)
    }
  }

  return (
    <div className="min-h-screen">
      <div className="max-w-6xl mx-auto px-8 py-10 space-y-5">
      <ReorderCommitBar
        useStore={useRoleReorderStore}
        label="役職"
        onCommit={handleCommitReorder}
      />

      <PageHeader
        title="役職マスタ"
        description="従業員に紐づく役職を管理します。"
        kicker="Admin · Roles"
        rightSlot={
          !isReordering && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleEnterReorder}
                disabled={roles.length < 2}
                className="px-3 py-2 text-xs tracking-wider uppercase border border-ink/20 hover:border-ink/50 rounded-sm transition-colors disabled:opacity-40"
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                ⇅ 並び替え
              </button>
              <button
                type="button"
                onClick={() =>
                  setForm({
                    mode: 'create',
                    code: '',
                    name: '',
                    rest_days_28_29: '',
                    rest_days_30: '',
                    rest_days_31: '',
                  })
                }
                className="px-4 py-2 text-xs tracking-wider uppercase bg-brand-900 text-cream-50 hover:bg-[#1a2940] rounded-sm transition-colors"
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                + 新規役職
              </button>
            </div>
          )
        }
      />

      {error && (
        <p className="text-xs text-[#a83232] bg-[#a83232]/8 border-l-2 border-[#a83232] px-3 py-2">
          {error}
        </p>
      )}

      {loading ? (
        <div className="text-ink-muted text-sm">読み込み中…</div>
      ) : (
        <div className="bg-cream-50 border border-ink/10 rounded-sm overflow-hidden overflow-x-auto">
          <SortableContainer
            ids={ids}
            onReorder={setDraft}
            disabled={!isReordering}
          >
            <table className="w-full text-sm">
              <thead className="bg-ink/5 text-[10px] tracking-widest uppercase text-ink-muted">
                <tr>
                  {isReordering && <th rowSpan={2} className="w-12"></th>}
                  <th
                    rowSpan={2}
                    className="text-left px-4 py-3"
                    style={{ fontFamily: 'var(--font-mono)' }}
                  >
                    Code
                  </th>
                  <th rowSpan={2} className="text-left px-4 py-3">
                    表示名
                  </th>
                  <th
                    colSpan={3}
                    scope="colgroup"
                    className="text-center px-4 py-3 normal-case tracking-normal"
                  >
                    休日数 / 月
                  </th>
                  <th rowSpan={2} className="text-left px-4 py-3 w-24">
                    順序
                  </th>
                  {!isReordering && (
                    <th rowSpan={2} className="text-right px-4 py-3 w-40">
                      操作
                    </th>
                  )}
                </tr>
                <tr>
                  <th scope="col" className="text-center px-4 py-2 normal-case tracking-normal">
                    短月
                  </th>
                  <th scope="col" className="text-center px-4 py-2 normal-case tracking-normal">
                    30日
                  </th>
                  <th scope="col" className="text-center px-4 py-2 normal-case tracking-normal">
                    31日
                  </th>
                </tr>
              </thead>
              <tbody>
                {orderedRoles.map((r, displayIdx) => {
                  // SortableContainer の id は元配列の index
                  const sortId = isReordering
                    ? draftOrder[displayIdx]
                    : displayIdx
                  return (
                    <SortableRow
                      key={r.code}
                      id={sortId}
                      disabled={!isReordering}
                      as="tr"
                      className="border-t border-ink/10"
                    >
                      {(handle) => (
                        <>
                          {isReordering && (
                            <td className="px-2 py-2">
                              <DragHandle
                                attributes={handle.attributes}
                                listeners={handle.listeners}
                              />
                            </td>
                          )}
                          <td
                            className="px-4 py-3 text-ink"
                            style={{ fontFamily: 'var(--font-mono)' }}
                          >
                            {r.code}
                          </td>
                          <td className="px-4 py-3 text-brand-900 font-medium">
                            {r.name}
                          </td>
                          <td
                            className="px-4 py-3 text-center"
                            style={{ fontFamily: 'var(--font-mono)' }}
                          >
                            {r.rest_days_28_29}
                          </td>
                          <td
                            className="px-4 py-3 text-center"
                            style={{ fontFamily: 'var(--font-mono)' }}
                          >
                            {r.rest_days_30}
                          </td>
                          <td
                            className="px-4 py-3 text-center"
                            style={{ fontFamily: 'var(--font-mono)' }}
                          >
                            {r.rest_days_31}
                          </td>
                          <td
                            className="px-4 py-3 text-ink-muted"
                            style={{ fontFamily: 'var(--font-mono)' }}
                          >
                            {r.order_index}
                          </td>
                          {!isReordering && (
                            <td className="px-4 py-3 text-right">
                              <button
                                type="button"
                                onClick={() =>
                                  setForm({
                                    mode: 'edit',
                                    code: r.code,
                                    name: r.name,
                                    rest_days_28_29: String(r.rest_days_28_29),
                                    rest_days_30: String(r.rest_days_30),
                                    rest_days_31: String(r.rest_days_31),
                                    originalCode: r.code,
                                  })
                                }
                                className="px-2 py-1 text-xs text-ink-muted hover:text-brand-600 transition-colors"
                              >
                                編集
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleting(r)}
                                className="px-2 py-1 text-xs text-ink-muted hover:text-[#a83232] transition-colors"
                              >
                                削除
                              </button>
                            </td>
                          )}
                        </>
                      )}
                    </SortableRow>
                  )
                })}
                {roles.length === 0 && (
                  <tr>
                    <td
                      colSpan={isReordering ? 7 : 7}
                      className="px-4 py-8 text-center text-ink-muted text-sm"
                    >
                      役職がまだありません
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </SortableContainer>
        </div>
      )}

      {form && (
        <ModalShell onClose={() => setForm(null)}>
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleSubmitForm}
            className="w-full max-w-md bg-cream-50 border border-ink/10 rounded-sm shadow-2xl"
          >
            <div className="px-6 py-5 border-b border-ink/10">
              <span
                className="text-[10px] tracking-[0.3em] uppercase text-brand-600"
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                {form.mode === 'create' ? 'New Role' : 'Edit Role'}
              </span>
              <h3
                className="text-xl font-medium text-brand-900 mt-1"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {form.mode === 'create' ? '役職を追加' : '役職を編集'}
              </h3>
            </div>

            <div className="px-6 py-5 space-y-4">
              <label className="block">
                <span
                  className="text-[11px] tracking-widest uppercase text-ink-muted block mb-1.5"
                  style={{ fontFamily: 'var(--font-mono)' }}
                >
                  役職コード
                </span>
                <input
                  type="text"
                  value={form.code}
                  disabled={form.mode === 'edit'}
                  onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                  className="w-full bg-transparent border-0 border-b border-ink/30 focus:border-brand-600 focus:outline-none px-0 py-1.5 text-base disabled:text-ink-muted"
                  style={{ fontFamily: 'var(--font-mono)' }}
                  required
                  pattern="^[A-Z][A-Z0-9_]{0,19}$"
                  title="英大文字で始まり、英大文字・数字・_ のみ、最大20文字"
                />
                {form.mode === 'edit' && (
                  <span className="text-[10px] text-ink-muted">
                    コードは変更できません
                  </span>
                )}
              </label>

              <label className="block">
                <span
                  className="text-[11px] tracking-widest uppercase text-ink-muted block mb-1.5"
                  style={{ fontFamily: 'var(--font-mono)' }}
                >
                  表示名
                </span>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full bg-transparent border-0 border-b border-ink/30 focus:border-brand-600 focus:outline-none px-0 py-1.5 text-base"
                  required
                  maxLength={50}
                />
              </label>

              <div>
                <span
                  className="text-[11px] tracking-widest uppercase text-ink-muted block mb-2"
                  style={{ fontFamily: 'var(--font-mono)' }}
                >
                  休日数 / 月
                </span>
                <div className="grid grid-cols-3 gap-4">
                  <label className="block">
                    <span className="text-[10px] text-ink-muted block mb-1">
                      短月 (28-29日)
                    </span>
                    <input
                      type="number"
                      min={0}
                      max={29}
                      required
                      value={form.rest_days_28_29}
                      onChange={(e) =>
                        setForm({ ...form, rest_days_28_29: e.target.value })
                      }
                      className="w-full bg-transparent border-0 border-b border-ink/30 focus:border-brand-600 focus:outline-none px-0 py-1.5 text-base"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[10px] text-ink-muted block mb-1">
                      30日月
                    </span>
                    <input
                      type="number"
                      min={0}
                      max={30}
                      required
                      value={form.rest_days_30}
                      onChange={(e) =>
                        setForm({ ...form, rest_days_30: e.target.value })
                      }
                      className="w-full bg-transparent border-0 border-b border-ink/30 focus:border-brand-600 focus:outline-none px-0 py-1.5 text-base"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[10px] text-ink-muted block mb-1">
                      31日月
                    </span>
                    <input
                      type="number"
                      min={0}
                      max={31}
                      required
                      value={form.rest_days_31}
                      onChange={(e) =>
                        setForm({ ...form, rest_days_31: e.target.value })
                      }
                      className="w-full bg-transparent border-0 border-b border-ink/30 focus:border-brand-600 focus:outline-none px-0 py-1.5 text-base"
                    />
                  </label>
                </div>
              </div>

              {error && (
                <p className="text-xs text-[#a83232] bg-[#a83232]/8 border-l-2 border-[#a83232] px-3 py-2">
                  {error}
                </p>
              )}
            </div>

            <div className="px-6 py-4 border-t border-ink/10 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setForm(null)}
                className="px-4 py-2 text-sm text-ink-muted hover:text-ink transition-colors"
              >
                キャンセル
              </button>
              <button
                type="submit"
                className="px-5 py-2 text-sm bg-brand-900 text-cream-50 hover:bg-[#1a2940] rounded-sm transition-colors"
              >
                保存
              </button>
            </div>
          </form>
        </ModalShell>
      )}

      {deleting && (
        <DeleteConfirm
          title={`役職 ${deleting.code} を削除しますか？`}
          desc={`${deleting.name} を削除します。この役職に従業員が紐付いている場合は削除できません。`}
          loading={deleteBusy}
          onCancel={() => setDeleting(null)}
          onConfirm={handleDelete}
        />
      )}

      <ReorderToast useStore={useRoleReorderStore} />
      </div>
    </div>
  )
}
