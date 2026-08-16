import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import EmployeePriorityCsvUpload from './EmployeePriorityCsvUpload'
import { importEmployeePrioritiesCsv } from '../../api/employeePriorities'

vi.mock('../../api/employeePriorities', () => ({
  importEmployeePrioritiesCsv: vi.fn(),
}))

const mockImport = vi.mocked(importEmployeePrioritiesCsv)

let onImported: ReturnType<typeof vi.fn>

beforeEach(() => {
  onImported = vi.fn()
  mockImport.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

function makeCsvFile(name = 'sample.csv', content = 'employee_id,pattern_name,priority\n1,A1,5'): File {
  return new File([content], name, { type: 'text/csv' })
}

// ---------------------------------------------------------------------------
// 静的レンダリング
// ---------------------------------------------------------------------------

describe('EmployeePriorityCsvUpload — static rendering', () => {
  it('renders the title and Template download link', () => {
    render(<EmployeePriorityCsvUpload departmentId={1} onImported={onImported} />)

    expect(screen.getByText('CSV 一括インポート')).toBeInTheDocument()
    const template = screen.getByRole('link', { name: /Template/ })
    expect(template).toHaveAttribute(
      'href',
      expect.stringContaining('data:text/csv;charset=utf-8'),
    )
    expect(template).toHaveAttribute('download', 'employee_priorities_template.csv')
  })

  it('renders the dropzone instruction copy', () => {
    render(<EmployeePriorityCsvUpload departmentId={1} onImported={onImported} />)

    expect(
      screen.getByText('employee_priorities.csv をドロップ、またはクリックして選択'),
    ).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// 正常系: ファイル選択
// ---------------------------------------------------------------------------

describe('EmployeePriorityCsvUpload — successful import', () => {
  it('calls the API with the selected file and departmentId, then renders the result stats', async () => {
    mockImport.mockResolvedValueOnce({
      created: 3,
      updated: 2,
      deleted: 1,
      skipped: 0,
      errors: [],
    })

    const user = userEvent.setup()
    render(<EmployeePriorityCsvUpload departmentId={42} onImported={onImported} />)

    const file = makeCsvFile()
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    await user.upload(input, file)

    await waitFor(() => expect(mockImport).toHaveBeenCalledTimes(1))
    expect(mockImport).toHaveBeenCalledWith(file, 42)
    expect(onImported).toHaveBeenCalledTimes(1)

    expect(screen.getByText('Created')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('Updated')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('Deleted')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('Skipped')).toBeInTheDocument()
  })

  it('renders an Errors section when result.errors is non-empty', async () => {
    mockImport.mockResolvedValueOnce({
      created: 0, updated: 0, deleted: 0, skipped: 2,
      errors: ['行 3: pattern_name 不一致', '行 5: priority 範囲外'],
    })

    const user = userEvent.setup()
    render(<EmployeePriorityCsvUpload departmentId={1} onImported={onImported} />)

    await user.upload(
      document.querySelector('input[type="file"]') as HTMLInputElement,
      makeCsvFile(),
    )

    await waitFor(() => {
      expect(screen.getByText(/Errors/)).toBeInTheDocument()
    })
    expect(screen.getByText('行 3: pattern_name 不一致')).toBeInTheDocument()
    expect(screen.getByText('行 5: priority 範囲外')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// バリデーション
// ---------------------------------------------------------------------------

describe('EmployeePriorityCsvUpload — file validation', () => {
  it('rejects non-CSV files without calling the API', async () => {
    render(<EmployeePriorityCsvUpload departmentId={1} onImported={onImported} />)

    const file = new File(['x'], 'wrong.txt', { type: 'text/plain' })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    // accept=".csv" のため userEvent.upload はフィルタしてしまうので fireEvent.change を直接呼ぶ
    fireEvent.change(input, { target: { files: [file] } })

    expect(await screen.findByText('CSV ファイルを選択してください')).toBeInTheDocument()
    expect(mockImport).not.toHaveBeenCalled()
    expect(onImported).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// エラー系
// ---------------------------------------------------------------------------

describe('EmployeePriorityCsvUpload — API errors', () => {
  it('shows server-provided detail message on axios-style error', async () => {
    mockImport.mockRejectedValueOnce({
      response: { data: { detail: '部門 ID が不正です' } },
    })

    const user = userEvent.setup()
    render(<EmployeePriorityCsvUpload departmentId={1} onImported={onImported} />)

    await user.upload(
      document.querySelector('input[type="file"]') as HTMLInputElement,
      makeCsvFile(),
    )

    expect(await screen.findByText('部門 ID が不正です')).toBeInTheDocument()
    expect(onImported).not.toHaveBeenCalled()
  })

  it('falls back to generic message when error has no detail', async () => {
    mockImport.mockRejectedValueOnce(new Error('network'))

    const user = userEvent.setup()
    render(<EmployeePriorityCsvUpload departmentId={1} onImported={onImported} />)

    await user.upload(
      document.querySelector('input[type="file"]') as HTMLInputElement,
      makeCsvFile(),
    )

    expect(await screen.findByText('インポートに失敗しました')).toBeInTheDocument()
  })

  it('clears any previous result on a failed import', async () => {
    // 1 回目成功
    mockImport.mockResolvedValueOnce({
      created: 1, updated: 0, deleted: 0, skipped: 0, errors: [],
    })
    const user = userEvent.setup()
    render(<EmployeePriorityCsvUpload departmentId={1} onImported={onImported} />)

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    await user.upload(input, makeCsvFile('first.csv'))
    await waitFor(() => expect(screen.getByText('Created')).toBeInTheDocument())

    // 2 回目失敗
    mockImport.mockRejectedValueOnce({
      response: { data: { detail: '失敗' } },
    })
    await user.upload(input, makeCsvFile('second.csv'))

    await waitFor(() => expect(screen.getByText('失敗')).toBeInTheDocument())
    // result セクションは消える
    expect(screen.queryByText('Created')).not.toBeInTheDocument()
  })
})
