import { useEffect, useState } from 'react'
import { useAuthStore } from '../stores/auth'
import { createUser, deleteUser, listUsers, updateUser } from '../api/users'
import { resetDemoData } from '../api/demo'
import type { User, UserCreate, UserUpdate } from '../types/api'
import UserFormModal from '../components/user/UserFormModal'
import DeleteConfirm from '../components/common/DeleteConfirm'
import ConfirmDialog from '../components/common/ConfirmDialog'
import PageHeader from '../components/common/PageHeader'

export default function UsersPage() {
  const currentUser = useAuthStore((s) => s.currentUser)
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const [modalMode, setModalMode] = useState<'create' | 'edit' | null>(null)
  const [editing, setEditing] = useState<User | null>(null)

  const [deleting, setDeleting] = useState<User | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const [resetConfirming, setResetConfirming] = useState(false)
  const [resetBusy, setResetBusy] = useState(false)
  const [resetMsg, setResetMsg] = useState('')

  async function reload() {
    setLoading(true)
    setErr('')
    try {
      const data = await listUsers()
      setUsers(data)
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
      setErr(typeof msg === 'string' ? msg : '取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reload()
  }, [])

  const adminCount = users.filter((u) => u.is_admin).length

  async function handleCreate(payload: {
    email: string
    password?: string
    is_active: boolean
    is_admin: boolean
  }) {
    const body: UserCreate = {
      email: payload.email,
      password: payload.password ?? '',
      is_active: payload.is_active,
      is_admin: payload.is_admin,
    }
    await createUser(body)
    await reload()
  }

  async function handleUpdate(payload: {
    email: string
    password?: string
    is_active: boolean
    is_admin: boolean
  }) {
    if (!editing) return
    const body: UserUpdate = {
      email: payload.email,
      is_active: payload.is_active,
      is_admin: payload.is_admin,
    }
    if (payload.password) body.password = payload.password
    await updateUser(editing.id, body)
    await reload()
  }

  async function handleDelete() {
    if (!deleting) return
    setDeleteBusy(true)
    try {
      await deleteUser(deleting.id)
      setDeleting(null)
      await reload()
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
      setErr(typeof msg === 'string' ? msg : '削除に失敗しました')
    } finally {
      setDeleteBusy(false)
    }
  }

  async function handleResetDemoData() {
    setResetBusy(true)
    setResetMsg('')
    try {
      await resetDemoData()
      setResetConfirming(false)
      setResetMsg('デモデータを初期状態に戻しました。')
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
      setResetMsg(
        typeof msg === 'string' ? msg : 'デモデータの初期化に失敗しました',
      )
    } finally {
      setResetBusy(false)
    }
  }

  return (
    <div className="min-h-screen">
      <div className="max-w-6xl mx-auto px-8 py-10">
        <PageHeader
          title="ユーザー管理"
          description="ログイン可能なアカウントを管理します。管理者は全権限を持ち、一般ユーザーは管理画面以外の機能のみ利用できます。"
        />

      <div className="mb-4 flex items-center justify-between">
        <span
          className="text-[11px] tracking-widest uppercase text-ink-muted"
          style={{ fontFamily: 'var(--font-mono)' }}
        >
          {users.length} ユーザー / 管理者 {adminCount} 名
        </span>
        <button
          onClick={() => {
            setEditing(null)
            setModalMode('create')
          }}
          className="px-4 py-2 text-sm bg-brand-900 text-cream-50 hover:bg-[#1a2940] rounded-sm transition-colors"
        >
          + 新規追加
        </button>
      </div>

      {err && (
        <p className="mb-4 text-xs text-[#a83232] bg-[#a83232]/8 border-l-2 border-[#a83232] px-3 py-2">
          {err}
        </p>
      )}

      <div className="border border-ink/10 rounded-sm overflow-hidden bg-cream-50">
        <table className="w-full text-sm">
          <thead className="bg-brand-900/5 text-ink-muted">
            <tr className="text-left">
              <th
                className="px-4 py-2 text-[10px] tracking-widest uppercase font-medium"
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                ID
              </th>
              <th
                className="px-4 py-2 text-[10px] tracking-widest uppercase font-medium"
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                メールアドレス
              </th>
              <th
                className="px-4 py-2 text-[10px] tracking-widest uppercase font-medium"
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                権限
              </th>
              <th
                className="px-4 py-2 text-[10px] tracking-widest uppercase font-medium"
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                状態
              </th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-ink-muted">
                  読み込み中…
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-ink-muted">
                  ユーザーがいません
                </td>
              </tr>
            ) : (
              users.map((u) => {
                const isSelf = currentUser?.id === u.id
                return (
                  <tr key={u.id} className="border-t border-ink/10">
                    <td
                      className="px-4 py-2.5 text-ink-muted"
                      style={{ fontFamily: 'var(--font-mono)' }}
                    >
                      {u.id}
                    </td>
                    <td className="px-4 py-2.5 text-ink">
                      {u.email}
                      {isSelf && (
                        <span className="ml-2 text-[10px] tracking-widest uppercase text-brand-600 align-middle">
                          自分
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {u.is_admin ? (
                        <span className="inline-block px-2 py-0.5 text-[10px] tracking-widest uppercase bg-brand-900 text-cream-50 rounded-sm">
                          管理者
                        </span>
                      ) : (
                        <span className="inline-block px-2 py-0.5 text-[10px] tracking-widest uppercase bg-ink/10 text-ink rounded-sm">
                          一般
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {u.is_active ? (
                        <span className="text-xs text-brand-700">有効</span>
                      ) : (
                        <span className="text-xs text-ink-muted">無効</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => {
                          setEditing(u)
                          setModalMode('edit')
                        }}
                        className="text-xs text-brand-700 hover:text-brand-900 transition-colors mr-3"
                      >
                        編集
                      </button>
                      <button
                        onClick={() => setDeleting(u)}
                        disabled={isSelf}
                        title={isSelf ? '自分自身は削除できません' : undefined}
                        className="text-xs text-[#a83232] hover:text-[#8e2828] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        削除
                      </button>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {modalMode && (
        <UserFormModal
          mode={modalMode}
          initial={modalMode === 'edit' ? editing : null}
          disableAdminToggle={
            modalMode === 'edit' &&
            editing != null &&
            currentUser?.id === editing.id &&
            editing.is_admin &&
            adminCount <= 1
          }
          onClose={() => {
            setModalMode(null)
            setEditing(null)
          }}
          onSubmit={modalMode === 'create' ? handleCreate : handleUpdate}
        />
      )}

      {deleting && (
        <DeleteConfirm
          title={`${deleting.email} を削除しますか？`}
          desc="このユーザーは即座にログインできなくなります。この操作は元に戻せません。"
          loading={deleteBusy}
          onCancel={() => setDeleting(null)}
          onConfirm={handleDelete}
        />
      )}

      <div className="mt-10 border border-ink/10 rounded-sm bg-cream-50 p-5">
        <span
          className="block text-[11px] tracking-widest uppercase text-ink-muted mb-2"
          style={{ fontFamily: 'var(--font-mono)' }}
        >
          Demo
        </span>
        <p className="text-sm text-ink-muted mb-3">
          このポートフォリオデモの部門・従業員・作業パターン・稼働表データを初期状態に戻します
          （管理者アカウントは維持されます）。DEMO_MODE が有効な環境でのみ実行できます。
        </p>
        {resetMsg && (
          <p className="mb-3 text-xs text-ink">{resetMsg}</p>
        )}
        <button
          onClick={() => {
            setResetMsg('')
            setResetConfirming(true)
          }}
          className="px-4 py-2 text-sm bg-[#a83232] text-white hover:bg-[#8e2828] rounded-sm transition-colors"
        >
          デモデータを初期化
        </button>
      </div>

      {resetConfirming && (
        <ConfirmDialog
          tone="delete"
          title="デモデータを初期化しますか？"
          description="部門・従業員・作業パターン・稼働表など、デモの入力データがすべて初期状態に戻ります。この操作は元に戻せません。"
          confirmLabel="初期化する"
          loadingLabel="初期化中…"
          loading={resetBusy}
          onCancel={() => setResetConfirming(false)}
          onConfirm={handleResetDemoData}
        />
      )}
      </div>
    </div>
  )
}
