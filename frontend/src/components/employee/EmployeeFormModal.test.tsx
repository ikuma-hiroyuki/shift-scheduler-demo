import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import EmployeeFormModal from './EmployeeFormModal'
import type { Employee } from '../../types/api'

let onClose: ReturnType<typeof vi.fn>
let onSubmit: ReturnType<typeof vi.fn>

const EXISTING: Employee = {
  id: 7, employee_number: 1234, department_id: 1, name: 'Bob', role: 'CHIEF',
  available_days: '0,1,2', available_shift_types: '1,2',
  consecutive_workable: false, sort_order: 0,
}

beforeEach(() => {
  onClose = vi.fn()
  onSubmit = vi.fn().mockResolvedValue(undefined)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('EmployeeFormModal — create mode', () => {
  it('shows "従業員を追加" header with default selections', () => {
    render(
      <EmployeeFormModal mode="create" initial={null} departmentId={1} onClose={onClose} onSubmit={onSubmit} />,
    )

    expect(screen.getByText('従業員を追加')).toBeInTheDocument()
    // 全曜日 + 全番型 default ON: ボタン背景クラスで判定
    expect(screen.getByRole('button', { name: '月' }).className).toContain('bg-brand-600')
    expect(screen.getByRole('button', { name: '日' }).className).toContain('bg-brand-600')
    // 役職 default = STAFF (一般)
    expect(screen.getByRole('button', { name: '一般' }).className).toContain('bg-brand-900')
  })

  it('submits with all fields and calls onClose on success', async () => {
    const user = userEvent.setup()
    render(
      <EmployeeFormModal mode="create" initial={null} departmentId={1} onClose={onClose} onSubmit={onSubmit} />,
    )

    const numInput = document.querySelector('input[type="number"]') as HTMLInputElement
    await user.type(numInput, '5001')
    const nameInput = document.querySelectorAll('input[type="text"]')[0] as HTMLInputElement
    await user.type(nameInput, 'Alice')

    await user.click(screen.getByRole('button', { name: '副主任' }))
    await user.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      employee_number: 5001,
      name: 'Alice',
      role: 'DEPUTY',
      available_days: '0,1,2,3,4,5,6',
      available_shift_types: '1,2,3',
      consecutive_workable: true,
    }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('toggles weekday and shift sets', async () => {
    const user = userEvent.setup()
    render(
      <EmployeeFormModal mode="create" initial={null} departmentId={1} onClose={onClose} onSubmit={onSubmit} />,
    )

    // Default 全 ON。土曜・日曜 OFF にしてみる
    await user.click(screen.getByRole('button', { name: '土' }))
    await user.click(screen.getByRole('button', { name: '日' }))
    // ボタン背景は brand-600 でなくなる
    expect(screen.getByRole('button', { name: '土' }).className).not.toContain('bg-brand-600')
    expect(screen.getByRole('button', { name: '日' }).className).not.toContain('bg-brand-600')
  })
})

describe('EmployeeFormModal — validation', () => {
  it('rejects when no weekdays are selected', async () => {
    const user = userEvent.setup()
    render(
      <EmployeeFormModal mode="create" initial={null} departmentId={1} onClose={onClose} onSubmit={onSubmit} />,
    )

    // 全曜日 OFF
    for (const d of ['月', '火', '水', '木', '金', '土', '日']) {
      await user.click(screen.getByRole('button', { name: d }))
    }
    // 必須項目埋める
    const numInput = document.querySelector('input[type="number"]') as HTMLInputElement
    await user.type(numInput, '1')
    const nameInput = document.querySelectorAll('input[type="text"]')[0] as HTMLInputElement
    await user.type(nameInput, 'Alice')

    await user.click(screen.getByRole('button', { name: '保存' }))

    expect(
      await screen.findByText('勤務可能曜日を1つ以上選択してください'),
    ).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('rejects when no shift types are selected', async () => {
    const user = userEvent.setup()
    render(
      <EmployeeFormModal mode="create" initial={null} departmentId={1} onClose={onClose} onSubmit={onSubmit} />,
    )

    // 全番型 OFF
    for (const s of ['早番', 'フル番', '遅番']) {
      await user.click(screen.getByRole('button', { name: s }))
    }
    const numInput = document.querySelector('input[type="number"]') as HTMLInputElement
    await user.type(numInput, '1')
    const nameInput = document.querySelectorAll('input[type="text"]')[0] as HTMLInputElement
    await user.type(nameInput, 'Alice')

    await user.click(screen.getByRole('button', { name: '保存' }))

    expect(
      await screen.findByText('勤務可能番型を1つ以上選択してください'),
    ).toBeInTheDocument()
  })
})

describe('EmployeeFormModal — edit mode preload', () => {
  it('disables employee_number, preloads name/role/days/shifts/prefer', () => {
    render(
      <EmployeeFormModal mode="edit" initial={EXISTING} departmentId={1} onClose={onClose} onSubmit={onSubmit} />,
    )

    expect(screen.getByText('従業員を編集')).toBeInTheDocument()
    const numInput = document.querySelector('input[type="number"]') as HTMLInputElement
    expect(numInput.value).toBe('1234')
    expect(numInput.disabled).toBe(true)

    const nameInput = document.querySelectorAll('input[type="text"]')[0] as HTMLInputElement
    expect(nameInput.value).toBe('Bob')

    expect(screen.getByRole('button', { name: '主任' }).className).toContain('bg-brand-900')
    // available_days = "0,1,2" → 日(0), 月(1), 火(2) ON、他 OFF
    expect(screen.getByRole('button', { name: '月' }).className).toContain('bg-brand-600')
    expect(screen.getByRole('button', { name: '火' }).className).toContain('bg-brand-600')
    expect(screen.getByRole('button', { name: '日' }).className).toContain('bg-brand-600')
    expect(screen.getByRole('button', { name: '水' }).className).not.toContain('bg-brand-600')
  })
})

describe('EmployeeFormModal — error handling', () => {
  it('shows server detail on rejection', async () => {
    onSubmit.mockRejectedValueOnce({ response: { data: { detail: '社員番号 重複' } } })
    const user = userEvent.setup()
    render(
      <EmployeeFormModal mode="create" initial={null} departmentId={1} onClose={onClose} onSubmit={onSubmit} />,
    )

    const numInput = document.querySelector('input[type="number"]') as HTMLInputElement
    await user.type(numInput, '1')
    const nameInput = document.querySelectorAll('input[type="text"]')[0] as HTMLInputElement
    await user.type(nameInput, 'Alice')

    await user.click(screen.getByRole('button', { name: '保存' }))

    expect(await screen.findByText('社員番号 重複')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })
})
