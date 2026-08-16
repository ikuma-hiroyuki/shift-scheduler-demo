/**
 * RolesPage の主要 UI 振る舞いテスト (issue #235)。
 *
 * issue #173 で role CRUD 自体は導入済み。本テストは issue #235 で追加される
 * 月間休日数 3 フィールド (28-29日 / 30日 / 31日) の table 描画 + modal 入力
 * + submit body 検証を網羅する。
 *
 * TDD 段階: types/api.ts に rest_days_* が未追加 + RolesPage が thead 2 段 化
 * 未実装のため、本テストは初期 FAIL する想定。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import RolesPage from './RolesPage'
import {
  createRole,
  deleteRole,
  listRoles,
  reorderRoles,
  updateRole,
} from '../api/roles'
import { useRoleReorderStore } from '../stores/reorderStore'
import type { Role } from '../types/api'

vi.mock('../api/roles', () => ({
  createRole: vi.fn(),
  deleteRole: vi.fn(),
  listRoles: vi.fn(),
  reorderRoles: vi.fn(),
  updateRole: vi.fn(),
}))
vi.mock('../components/reorder/ReorderCommitBar', () => ({
  default: () => null,
}))
vi.mock('../components/reorder/ReorderToast', () => ({
  default: () => null,
}))
vi.mock('../components/reorder/SortableContainer', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
vi.mock('../components/reorder/SortableRow', () => ({
  default: ({ children, className }: {
    children: (h: { attributes: object; listeners: undefined; isDragging: false }) => React.ReactNode
    className?: string
  }) => (
    <tr className={className}>
      {children({ attributes: {}, listeners: undefined, isDragging: false })}
    </tr>
  ),
  DragHandle: () => <span data-testid="drag-handle" />,
}))
vi.mock('../stores/roles', () => ({
  useRoleStore: (selector: (s: { fetch: () => Promise<void> }) => unknown) =>
    selector({ fetch: vi.fn().mockResolvedValue(undefined) }),
}))

const CHIEF: Role = {
  code: 'CHIEF',
  name: '主任',
  order_index: 0,
  rest_days_28_29: 9,
  rest_days_30: 9,
  rest_days_31: 10,
}
const FULLPART: Role = {
  code: 'FULLPART',
  name: 'フルパート',
  order_index: 1,
  rest_days_28_29: 7,
  rest_days_30: 7,
  rest_days_31: 7,
}
const MORNINGPART: Role = {
  code: 'MORNINGPART',
  name: '早朝パート',
  order_index: 2,
  rest_days_28_29: 7,
  rest_days_30: 7,
  rest_days_31: 7,
}

const mockList = vi.mocked(listRoles)
const mockCreate = vi.mocked(createRole)
const mockUpdate = vi.mocked(updateRole)
const mockDelete = vi.mocked(deleteRole)
const mockReorder = vi.mocked(reorderRoles)

beforeEach(() => {
  useRoleReorderStore.getState().exit()
  mockList.mockReset()
  mockCreate.mockReset()
  mockUpdate.mockReset()
  mockDelete.mockReset()
  mockReorder.mockReset()
  mockList.mockResolvedValue([CHIEF, FULLPART, MORNINGPART])
})

afterEach(() => {
  useRoleReorderStore.getState().exit()
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------

describe('RolesPage — table 描画 (issue #235)', () => {
  it('thead 2 段でサブヘッダ 短月/30日/31日 を表示する', async () => {
    render(<RolesPage />)

    await screen.findByText('主任')

    // 親ヘッダ
    expect(screen.getByText('休日数 / 月')).toBeInTheDocument()
    // サブヘッダ
    expect(screen.getByText('短月')).toBeInTheDocument()
    expect(screen.getByText('30日')).toBeInTheDocument()
    expect(screen.getByText('31日')).toBeInTheDocument()
  })

  it('各 role 行に rest_days_* 3 セルを表示する', async () => {
    render(<RolesPage />)

    await screen.findByText('主任')

    // CHIEF の値 9/9/10 が表示される (mono font セル想定)
    // 個別セル取得は getAllByText で重複考慮
    const chiefRow = screen.getByText('主任').closest('tr')!
    expect(chiefRow).toBeInTheDocument()

    // 行内に 9, 9, 10 がそれぞれ含まれる
    const cells = chiefRow.querySelectorAll('td')
    const cellTexts = Array.from(cells).map((td) => td.textContent?.trim())
    expect(cellTexts).toContain('9')  // rest_days_28_29
    expect(cellTexts).toContain('10') // rest_days_31

    // MORNINGPART の値 7/7/7
    const morningRow = screen.getByText('早朝パート').closest('tr')!
    const morningTexts = Array.from(morningRow.querySelectorAll('td')).map(
      (td) => td.textContent?.trim(),
    )
    expect(morningTexts.filter((t) => t === '7').length).toBe(3)
  })
})

// ---------------------------------------------------------------------------

describe('RolesPage — modal create (issue #235)', () => {
  it('+ 新規役職 で modal が開き、3 つの数値 input が空欄で表示される', async () => {
    const user = userEvent.setup()
    render(<RolesPage />)

    await screen.findByText('主任')
    await user.click(screen.getByRole('button', { name: '+ 新規役職' }))

    // 役職コード input
    expect(screen.getByLabelText(/役職コード/)).toBeInTheDocument()
    // 休日数 3 input が空欄で required
    const shortInput = screen.getByLabelText(/短月/) as HTMLInputElement
    const m30Input = screen.getByLabelText(/30日月/) as HTMLInputElement
    const m31Input = screen.getByLabelText(/31日月/) as HTMLInputElement
    expect(shortInput.value).toBe('')
    expect(m30Input.value).toBe('')
    expect(m31Input.value).toBe('')
    expect(shortInput.required).toBe(true)
    expect(m30Input.required).toBe(true)
    expect(m31Input.required).toBe(true)
    expect(shortInput.type).toBe('number')
  })

  it('rest_days_31 に 32 を入れると HTML5 max で submit ブロックされる', async () => {
    const user = userEvent.setup()
    render(<RolesPage />)

    await screen.findByText('主任')
    await user.click(screen.getByRole('button', { name: '+ 新規役職' }))

    const m31Input = screen.getByLabelText(/31日月/) as HTMLInputElement
    expect(parseInt(m31Input.max, 10)).toBe(31)

    await user.type(screen.getByLabelText(/役職コード/), 'NEWROLE')
    await user.type(screen.getByLabelText(/表示名/), '新人')
    await user.type(screen.getByLabelText(/短月/), '9')
    await user.type(screen.getByLabelText(/30日月/), '9')
    await user.type(m31Input, '32')

    await user.click(screen.getByRole('button', { name: '保存' }))

    // 32 > max=31 のため createRole は呼ばれない
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('save が rest_days_* 3 フィールド込みで createRole を呼ぶ', async () => {
    mockCreate.mockResolvedValueOnce({
      ...CHIEF,
      code: 'NEWROLE',
      name: '新規',
      rest_days_28_29: 8,
      rest_days_30: 9,
      rest_days_31: 10,
    })
    const user = userEvent.setup()
    render(<RolesPage />)

    await screen.findByText('主任')
    await user.click(screen.getByRole('button', { name: '+ 新規役職' }))

    await user.type(screen.getByLabelText(/役職コード/), 'NEWROLE')
    await user.type(screen.getByLabelText(/表示名/), '新規')
    await user.type(screen.getByLabelText(/短月/), '8')
    await user.type(screen.getByLabelText(/30日月/), '9')
    await user.type(screen.getByLabelText(/31日月/), '10')

    await user.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
        code: 'NEWROLE',
        name: '新規',
        rest_days_28_29: 8,
        rest_days_30: 9,
        rest_days_31: 10,
      }))
    })
  })
})

// ---------------------------------------------------------------------------

describe('RolesPage — modal edit (issue #235)', () => {
  it('編集 で modal が開き、3 input に現在値がプリフィルされる', async () => {
    const user = userEvent.setup()
    render(<RolesPage />)

    await screen.findByText('主任')
    // CHIEF 行の編集ボタン
    const chiefRow = screen.getByText('主任').closest('tr')!
    const editBtn = chiefRow.querySelector('button')! // 「編集」が先頭
    await user.click(editBtn)

    const shortInput = screen.getByLabelText(/短月/) as HTMLInputElement
    const m30Input = screen.getByLabelText(/30日月/) as HTMLInputElement
    const m31Input = screen.getByLabelText(/31日月/) as HTMLInputElement
    expect(shortInput.value).toBe('9')
    expect(m30Input.value).toBe('9')
    expect(m31Input.value).toBe('10')
  })

  it('編集 save が updateRole を rest_days_* 込みで呼ぶ', async () => {
    mockUpdate.mockResolvedValueOnce({
      ...CHIEF,
      rest_days_28_29: 11,
      rest_days_30: 12,
      rest_days_31: 13,
    })
    const user = userEvent.setup()
    render(<RolesPage />)

    await screen.findByText('主任')
    const chiefRow = screen.getByText('主任').closest('tr')!
    await user.click(chiefRow.querySelector('button')!)

    const m31Input = screen.getByLabelText(/31日月/) as HTMLInputElement
    await user.clear(m31Input)
    await user.type(m31Input, '13')

    await user.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith('CHIEF', expect.objectContaining({
        name: '主任',
        rest_days_28_29: 9,
        rest_days_30: 9,
        rest_days_31: 13,
      }))
    })
  })
})
