import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import EmployeeCsvUpload from './EmployeeCsvUpload'
import { importEmployeesCsv } from '../../api/employees'

vi.mock('../../api/employees', () => ({
  importEmployeesCsv: vi.fn(),
}))

const mockImport = vi.mocked(importEmployeesCsv)

let onImported: ReturnType<typeof vi.fn>

beforeEach(() => {
  onImported = vi.fn()
  mockImport.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

function makeCsvFile(name = 'employees.csv'): File {
  return new File(['employee_number,name\n'], name, { type: 'text/csv' })
}

describe('EmployeeCsvUpload — static rendering', () => {
  it('renders the title and Template download link', () => {
    render(<EmployeeCsvUpload departmentId={1} onImported={onImported} />)

    expect(screen.getByText('CSV 一括インポート')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Template/ })).toHaveAttribute(
      'download',
      'employees_template.csv',
    )
  })
})

describe('EmployeeCsvUpload — successful import', () => {
  it('calls API with file and departmentId, displays Created/Updated/Moved stats', async () => {
    mockImport.mockResolvedValueOnce({
      created: 5, updated: 3, moved: 0, errors: [],
    })

    const user = userEvent.setup()
    render(<EmployeeCsvUpload departmentId={42} onImported={onImported} />)

    await user.upload(
      document.querySelector('input[type="file"]') as HTMLInputElement,
      makeCsvFile(),
    )

    await waitFor(() => expect(mockImport).toHaveBeenCalledTimes(1))
    expect(mockImport).toHaveBeenCalledWith(expect.any(File), 42)
    expect(onImported).toHaveBeenCalledTimes(1)

    expect(screen.getByText('Created')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('Updated')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('Moved')).toBeInTheDocument()
  })

  it('renders the Moved warning panel when moved > 0', async () => {
    mockImport.mockResolvedValueOnce({
      created: 0, updated: 2, moved: 2, errors: [],
    })

    const user = userEvent.setup()
    render(<EmployeeCsvUpload departmentId={1} onImported={onImported} />)

    await user.upload(
      document.querySelector('input[type="file"]') as HTMLInputElement,
      makeCsvFile(),
    )

    expect(
      await screen.findByText(/別部署に登録済みでした/),
    ).toBeInTheDocument()
  })

  it('renders Errors section listing each error string', async () => {
    mockImport.mockResolvedValueOnce({
      created: 1, updated: 0, moved: 0,
      errors: ['行 2: role 不正', '行 5: name 空欄'],
    })

    const user = userEvent.setup()
    render(<EmployeeCsvUpload departmentId={1} onImported={onImported} />)

    await user.upload(
      document.querySelector('input[type="file"]') as HTMLInputElement,
      makeCsvFile(),
    )

    expect(await screen.findByText(/Errors/)).toBeInTheDocument()
    expect(screen.getByText('行 2: role 不正')).toBeInTheDocument()
    expect(screen.getByText('行 5: name 空欄')).toBeInTheDocument()
  })
})

describe('EmployeeCsvUpload — validation and errors', () => {
  it('rejects non-CSV files', async () => {
    render(<EmployeeCsvUpload departmentId={1} onImported={onImported} />)

    fireEvent.change(
      document.querySelector('input[type="file"]') as HTMLInputElement,
      { target: { files: [new File(['x'], 'wrong.txt', { type: 'text/plain' })] } },
    )

    expect(await screen.findByText('CSV ファイルを選択してください')).toBeInTheDocument()
    expect(mockImport).not.toHaveBeenCalled()
  })

  it('shows axios-style detail on error', async () => {
    mockImport.mockRejectedValueOnce({
      response: { data: { detail: '部門 ID が不正です' } },
    })

    const user = userEvent.setup()
    render(<EmployeeCsvUpload departmentId={1} onImported={onImported} />)

    await user.upload(
      document.querySelector('input[type="file"]') as HTMLInputElement,
      makeCsvFile(),
    )

    expect(await screen.findByText('部門 ID が不正です')).toBeInTheDocument()
  })

  it('falls back to generic message', async () => {
    mockImport.mockRejectedValueOnce(new Error('network'))

    const user = userEvent.setup()
    render(<EmployeeCsvUpload departmentId={1} onImported={onImported} />)

    await user.upload(
      document.querySelector('input[type="file"]') as HTMLInputElement,
      makeCsvFile(),
    )

    expect(await screen.findByText('インポートに失敗しました')).toBeInTheDocument()
  })
})
