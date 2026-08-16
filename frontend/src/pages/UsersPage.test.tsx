import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import UsersPage from './UsersPage'
import { createUser, deleteUser, listUsers, updateUser } from '../api/users'
import { useAuthStore } from '../stores/auth'
import type { User } from '../types/api'

vi.mock('../api/users', () => ({
  listUsers: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  deleteUser: vi.fn(),
}))

interface ModalProps {
  mode: 'create' | 'edit'
  initial: User | null
  disableAdminToggle?: boolean
  onClose: () => void
  onSubmit: (p: {
    email: string
    password?: string
    is_active: boolean
    is_admin: boolean
  }) => Promise<void>
}

vi.mock('../components/user/UserFormModal', () => ({
  default: ({ mode, initial, disableAdminToggle, onClose, onSubmit }: ModalProps) => (
    <div data-testid="user-form-modal">
      <span data-testid="modal-mode">{mode}</span>
      <span data-testid="modal-initial-email">{initial?.email ?? ''}</span>
      <span data-testid="modal-disable-admin">{disableAdminToggle ? '1' : '0'}</span>
      <button
        onClick={async () => {
          try {
            await onSubmit({
              email: 'submitted@x.com',
              password: 'pw',
              is_active: true,
              is_admin: false,
            })
          } catch {
            // 実機の UserFormModal は err state にセット → モックでは握りつぶす
          }
        }}
      >
        modal-submit
      </button>
      <button
        onClick={async () => {
          try {
            await onSubmit({
              email: 'submitted@x.com',
              is_active: true,
              is_admin: false,
            })
          } catch {
            // 同上
          }
        }}
      >
        modal-submit-no-password
      </button>
      <button onClick={onClose}>modal-close</button>
    </div>
  ),
}))

interface DeleteProps {
  title: string
  loading: boolean
  onCancel: () => void
  onConfirm: () => void
}

vi.mock('../components/common/DeleteConfirm', () => ({
  default: ({ title, onCancel, onConfirm }: DeleteProps) => (
    <div data-testid="delete-confirm">
      <span data-testid="delete-title">{title}</span>
      <button onClick={onConfirm}>confirm-delete</button>
      <button onClick={onCancel}>cancel-delete</button>
    </div>
  ),
}))

const mockList = vi.mocked(listUsers)
const mockCreate = vi.mocked(createUser)
const mockUpdate = vi.mocked(updateUser)
const mockDelete = vi.mocked(deleteUser)

const ADMIN: User = { id: 1, email: 'admin@x.com', is_active: true, is_admin: true }
const REGULAR: User = { id: 2, email: 'user@x.com', is_active: true, is_admin: false }

beforeEach(() => {
  mockList.mockReset()
  mockCreate.mockReset()
  mockUpdate.mockReset()
  mockDelete.mockReset()
  mockList.mockResolvedValue([ADMIN, REGULAR])
  useAuthStore.setState({ token: 'tk', currentUser: ADMIN })
})

afterEach(() => {
  vi.clearAllMocks()
  useAuthStore.setState({ token: null, currentUser: null })
})

// ---------------------------------------------------------------------------

describe('UsersPage', () => {
  it('renders user list with admin / regular badges', async () => {
    render(<UsersPage />)

    expect(await screen.findByText('admin@x.com')).toBeInTheDocument()
    expect(screen.getByText('user@x.com')).toBeInTheDocument()
    expect(screen.getByText('管理者')).toBeInTheDocument()
    expect(screen.getByText('一般')).toBeInTheDocument()
    expect(screen.getByText('自分')).toBeInTheDocument()
  })

  it('creates new user via modal', async () => {
    const user = userEvent.setup()
    mockCreate.mockResolvedValue({
      id: 3,
      email: 'submitted@x.com',
      is_active: true,
      is_admin: false,
    })
    render(<UsersPage />)
    await screen.findByText('admin@x.com')

    await user.click(screen.getByText('+ 新規追加'))
    expect(screen.getByTestId('modal-mode').textContent).toBe('create')

    await user.click(screen.getByText('modal-submit'))

    await waitFor(() => expect(mockCreate).toHaveBeenCalledOnce())
    expect(mockCreate).toHaveBeenCalledWith({
      email: 'submitted@x.com',
      password: 'pw',
      is_active: true,
      is_admin: false,
    })
  })

  it('edits user with blank password skips password field', async () => {
    const user = userEvent.setup()
    mockUpdate.mockResolvedValue(REGULAR)
    render(<UsersPage />)
    await screen.findByText('user@x.com')

    // user@x.com の行の編集ボタン
    const rows = screen.getAllByRole('row')
    const userRow = rows.find((r) => r.textContent?.includes('user@x.com'))!
    const editBtn = userRow.querySelector('button')!
    await user.click(editBtn)

    expect(screen.getByTestId('modal-mode').textContent).toBe('edit')
    expect(screen.getByTestId('modal-initial-email').textContent).toBe('user@x.com')

    // password 空欄シナリオ
    await user.click(screen.getByText('modal-submit-no-password'))

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledOnce())
    const [, body] = mockUpdate.mock.calls[0]
    expect(body).not.toHaveProperty('password')
    expect(body.email).toBe('submitted@x.com')
  })

  it('deletes user with confirmation', async () => {
    const user = userEvent.setup()
    mockDelete.mockResolvedValue()
    render(<UsersPage />)
    await screen.findByText('user@x.com')

    // user@x.com 行の削除ボタンを探す
    const rows = screen.getAllByRole('row')
    const userRow = rows.find((r) => r.textContent?.includes('user@x.com'))!
    const buttons = userRow.querySelectorAll('button')
    const deleteBtn = buttons[buttons.length - 1] // 最後が削除
    await user.click(deleteBtn)

    expect(screen.getByTestId('delete-title').textContent).toContain('user@x.com')
    await user.click(screen.getByText('confirm-delete'))

    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith(REGULAR.id))
  })

  it('disables self delete button', async () => {
    render(<UsersPage />)
    await screen.findByText('admin@x.com')

    const rows = screen.getAllByRole('row')
    const adminRow = rows.find((r) => r.textContent?.includes('admin@x.com'))!
    const buttons = adminRow.querySelectorAll('button')
    const deleteBtn = buttons[buttons.length - 1] as HTMLButtonElement
    expect(deleteBtn.disabled).toBe(true)
  })

  it('shows backend error message on duplicate email', async () => {
    const user = userEvent.setup()
    mockCreate.mockRejectedValue({
      response: { data: { detail: 'メールアドレスが既に使われています' } },
    })
    render(<UsersPage />)
    await screen.findByText('admin@x.com')

    await user.click(screen.getByText('+ 新規追加'))
    await user.click(screen.getByText('modal-submit'))

    await waitFor(() => expect(mockCreate).toHaveBeenCalledOnce())
    // モーダル内の error 表示はモック化したので、再リロードが起きないことだけ検証
    // (実機では UserFormModal 内の err state に表示される)
    expect(mockList).toHaveBeenCalledTimes(1)
  })

  it('passes disableAdminToggle=true when self is the last admin', async () => {
    const user = userEvent.setup()
    // admin が 1 人だけ (self) のシナリオ
    mockList.mockResolvedValue([ADMIN])
    render(<UsersPage />)
    await screen.findByText('admin@x.com')

    const rows = screen.getAllByRole('row')
    const adminRow = rows.find((r) => r.textContent?.includes('admin@x.com'))!
    const editBtn = adminRow.querySelector('button')!
    await user.click(editBtn)

    expect(screen.getByTestId('modal-disable-admin').textContent).toBe('1')
  })

  it('passes disableAdminToggle=false when there are multiple admins', async () => {
    const user = userEvent.setup()
    const ANOTHER_ADMIN: User = {
      id: 3,
      email: 'admin2@x.com',
      is_active: true,
      is_admin: true,
    }
    mockList.mockResolvedValue([ADMIN, ANOTHER_ADMIN])
    render(<UsersPage />)
    await screen.findByText('admin@x.com')

    const rows = screen.getAllByRole('row')
    const adminRow = rows.find((r) => r.textContent?.includes('admin@x.com'))!
    const editBtn = adminRow.querySelector('button')!
    await user.click(editBtn)

    expect(screen.getByTestId('modal-disable-admin').textContent).toBe('0')
  })
})
