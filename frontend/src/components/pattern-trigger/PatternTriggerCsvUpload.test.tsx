import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import PatternTriggerCsvUpload from './PatternTriggerCsvUpload'
import { importPatternTriggersCsv } from '../../api/patternTriggers'

vi.mock('../../api/patternTriggers', () => ({
  importPatternTriggersCsv: vi.fn(),
}))

const mockImport = vi.mocked(importPatternTriggersCsv)

function getInput(container: HTMLElement): HTMLInputElement {
  return container.querySelector('input[type="file"]') as HTMLInputElement
}

beforeEach(() => {
  mockImport.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('PatternTriggerCsvUpload', () => {
  it('rejects non-csv files', async () => {
    const { container } = render(
      <PatternTriggerCsvUpload departmentId={1} onImported={vi.fn()} />,
    )
    const file = new File(['x'], 'foo.txt', { type: 'text/plain' })
    fireEvent.change(getInput(container), { target: { files: [file] } })
    expect(
      await screen.findByText('CSV ファイルを選択してください'),
    ).toBeInTheDocument()
    expect(mockImport).not.toHaveBeenCalled()
  })

  it('uploads and renders result stats', async () => {
    mockImport.mockResolvedValueOnce({
      created: 1,
      updated: 0,
      skipped: 0,
      errors: [],
    })
    const onImported = vi.fn()
    const { container } = render(
      <PatternTriggerCsvUpload departmentId={42} onImported={onImported} />,
    )
    const file = new File(['hdr'], 'pattern_triggers.csv', { type: 'text/csv' })
    fireEvent.change(getInput(container), { target: { files: [file] } })
    await waitFor(() => expect(mockImport).toHaveBeenCalledWith(file, 42))
    expect(await screen.findByText('Created')).toBeInTheDocument()
    expect(onImported).toHaveBeenCalled()
  })

  it('renders error block when API returns errors', async () => {
    mockImport.mockResolvedValueOnce({
      created: 0,
      updated: 0,
      skipped: 1,
      errors: ['2行目: 不明なグループ'],
    })
    const { container } = render(
      <PatternTriggerCsvUpload departmentId={1} onImported={vi.fn()} />,
    )
    const file = new File(['hdr'], 'pattern_triggers.csv', { type: 'text/csv' })
    fireEvent.change(getInput(container), { target: { files: [file] } })
    expect(await screen.findByText(/Errors · 1/)).toBeInTheDocument()
    expect(screen.getByText('2行目: 不明なグループ')).toBeInTheDocument()
  })
})
