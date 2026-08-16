import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import LeaveCsvUpload from './LeaveCsvUpload'
import { importRoster } from '../../api/imports'

vi.mock('../../api/imports', () => ({
  importRoster: vi.fn(),
}))

const mockImport = vi.mocked(importRoster)

let onImported: ReturnType<typeof vi.fn>

beforeEach(() => {
  onImported = vi.fn()
  mockImport.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

function makeCsvFile(name = 'sample.csv'): File {
  return new File(['番号,日付,休\n'], name, { type: 'text/csv' })
}

function makeProps(extra: Partial<{ year: number; month: number; departmentId: number }> = {}) {
  return {
    departmentId: 1,
    year: 2026,
    month: 4,
    onImported,
    ...extra,
  }
}

describe('LeaveCsvUpload — static rendering', () => {
  it('renders the title and Overwrite label with year/month', () => {
    render(<LeaveCsvUpload {...makeProps()} />)

    expect(screen.getByText('休日 CSV を読み込む')).toBeInTheDocument()
    expect(screen.getByText('Overwrite · 2026/04')).toBeInTheDocument()
  })

  it('renders Template download with leave_requests filename', () => {
    render(<LeaveCsvUpload {...makeProps()} />)

    expect(screen.getByRole('link', { name: /Template/ })).toHaveAttribute(
      'download',
      'leave_requests_template.csv',
    )
  })
})

describe('LeaveCsvUpload — confirm dialog gate', () => {
  it('shows a confirm dialog and aborts upload when cancelled', async () => {
    const user = userEvent.setup()
    render(<LeaveCsvUpload {...makeProps()} />)

    await user.upload(
      document.querySelector('input[type="file"]') as HTMLInputElement,
      makeCsvFile(),
    )

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toBeInTheDocument()
    expect(screen.getByText('希望休データを上書きしますか？')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'キャンセル' }))

    expect(mockImport).not.toHaveBeenCalled()
    expect(onImported).not.toHaveBeenCalled()
  })

  it('proceeds when confirmed and renders Year/Month/Created/Skipped stats', async () => {
    mockImport.mockResolvedValueOnce({ created: 7, skipped: 1, year: 2026, month: 4 })

    const user = userEvent.setup()
    render(<LeaveCsvUpload {...makeProps()} />)

    await user.upload(
      document.querySelector('input[type="file"]') as HTMLInputElement,
      makeCsvFile(),
    )

    await user.click(await screen.findByRole('button', { name: '上書きする' }))

    await waitFor(() => expect(mockImport).toHaveBeenCalledTimes(1))
    expect(mockImport).toHaveBeenCalledWith(expect.any(File), 1, 2026, 4)
    expect(onImported).toHaveBeenCalledWith({ created: 7, skipped: 1, year: 2026, month: 4 })

    expect(screen.getByText('Year')).toBeInTheDocument()
    expect(screen.getByText('Created')).toBeInTheDocument()
    expect(screen.getByText('7')).toBeInTheDocument()
    expect(screen.getByText('Skipped')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
  })
})

describe('LeaveCsvUpload — validation and errors', () => {
  it('rejects non-CSV files and never opens the confirm dialog', async () => {
    render(<LeaveCsvUpload {...makeProps()} />)

    const file = new File(['x'], 'wrong.txt', { type: 'text/plain' })
    fireEvent.change(
      document.querySelector('input[type="file"]') as HTMLInputElement,
      { target: { files: [file] } },
    )

    expect(await screen.findByText('CSV ファイルを選択してください')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mockImport).not.toHaveBeenCalled()
  })

  it('shows server detail message on rejection', async () => {
    mockImport.mockRejectedValueOnce({
      response: { data: { detail: '2026/04 のデータが空です' } },
    })

    const user = userEvent.setup()
    render(<LeaveCsvUpload {...makeProps()} />)

    await user.upload(
      document.querySelector('input[type="file"]') as HTMLInputElement,
      makeCsvFile(),
    )
    await user.click(await screen.findByRole('button', { name: '上書きする' }))

    expect(await screen.findByText('2026/04 のデータが空です')).toBeInTheDocument()
  })

  it('falls back to generic error message', async () => {
    mockImport.mockRejectedValueOnce(new Error('boom'))

    const user = userEvent.setup()
    render(<LeaveCsvUpload {...makeProps()} />)

    await user.upload(
      document.querySelector('input[type="file"]') as HTMLInputElement,
      makeCsvFile(),
    )
    await user.click(await screen.findByRole('button', { name: '上書きする' }))

    expect(await screen.findByText('インポートに失敗しました')).toBeInTheDocument()
  })
})
