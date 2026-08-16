import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import CsvUploadShell from './CsvUploadShell'

let onFile: ReturnType<typeof vi.fn>

beforeEach(() => {
  onFile = vi.fn()
})

afterEach(() => {
  vi.restoreAllMocks()
})

function renderShell(props: Partial<React.ComponentProps<typeof CsvUploadShell>> = {}) {
  return render(
    <CsvUploadShell
      title="Test Upload"
      dropLabel="ファイルをドロップ"
      dropSubLabel="col_a · col_b"
      busy={false}
      onFile={onFile}
      {...props}
    />,
  )
}

describe('CsvUploadShell — static rendering', () => {
  it('renders the title and drop labels', () => {
    renderShell()

    expect(screen.getByText('Test Upload')).toBeInTheDocument()
    expect(screen.getByText('ファイルをドロップ')).toBeInTheDocument()
    expect(screen.getByText('col_a · col_b')).toBeInTheDocument()
  })

  it('renders the headerRight slot when provided', () => {
    renderShell({ headerRight: <span data-testid="custom-header">CUSTOM</span> })

    expect(screen.getByTestId('custom-header')).toHaveTextContent('CUSTOM')
  })

  it('omits the header slot wrapper when headerRight is undefined', () => {
    renderShell()

    expect(screen.queryByTestId('custom-header')).not.toBeInTheDocument()
  })

  it('renders children below the dropzone', () => {
    renderShell({ children: <div data-testid="result-block">RESULT</div> })

    expect(screen.getByTestId('result-block')).toHaveTextContent('RESULT')
  })

  it('renders the error banner when error is set', () => {
    renderShell({ error: 'CSV ファイルを選択してください' })

    expect(screen.getByText('CSV ファイルを選択してください')).toBeInTheDocument()
  })

  it('does not render the error banner when error is empty', () => {
    renderShell({ error: '' })

    expect(screen.queryByText(/選択してください/)).not.toBeInTheDocument()
  })
})

describe('CsvUploadShell — drag visual feedback', () => {
  it('applies brand-600 border class on drag over and removes it on drag leave', () => {
    renderShell()
    const dropzone = screen.getByRole('button', { name: 'ファイルをドロップ' })

    expect(dropzone.className).not.toContain('border-brand-600')

    fireEvent.dragOver(dropzone)
    expect(dropzone.className).toContain('border-brand-600')

    fireEvent.dragLeave(dropzone)
    expect(dropzone.className).not.toContain('border-brand-600')
  })
})

describe('CsvUploadShell — busy state', () => {
  it('applies cursor-wait class when busy', () => {
    renderShell({ busy: true })
    const dropzone = screen.getByRole('button', { name: 'ファイルをドロップ' })

    expect(dropzone.className).toContain('cursor-wait')
    expect(dropzone).toHaveAttribute('aria-disabled', 'true')
    expect(dropzone).toHaveAttribute('tabindex', '-1')
  })

  it('does not call onFile when click occurs while busy', async () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click')
    renderShell({ busy: true })

    const dropzone = screen.getByRole('button', { name: 'ファイルをドロップ' })
    await userEvent.click(dropzone)

    expect(clickSpy).not.toHaveBeenCalled()
    expect(onFile).not.toHaveBeenCalled()
  })

  it('shows the "読み込み中…" loading text when busy', () => {
    renderShell({ busy: true })

    expect(screen.getByText('読み込み中…')).toBeInTheDocument()
    expect(screen.queryByText('ファイルをドロップ')).not.toBeInTheDocument()
  })
})

describe('CsvUploadShell — file selection', () => {
  it('forwards the selected file to onFile via the hidden input', () => {
    const { container } = renderShell()
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['x'], 'sample.csv', { type: 'text/csv' })

    fireEvent.change(input, { target: { files: [file] } })

    expect(onFile).toHaveBeenCalledTimes(1)
    expect(onFile).toHaveBeenCalledWith(file)
  })

  it('forwards the dropped file to onFile', () => {
    renderShell()
    const dropzone = screen.getByRole('button', { name: 'ファイルをドロップ' })
    const file = new File(['x'], 'dropped.csv', { type: 'text/csv' })

    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } })

    expect(onFile).toHaveBeenCalledWith(file)
  })
})

describe('CsvUploadShell — keyboard a11y', () => {
  it('opens the file picker when Enter is pressed', async () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    renderShell()

    const dropzone = screen.getByRole('button', { name: 'ファイルをドロップ' })
    dropzone.focus()
    await userEvent.keyboard('{Enter}')

    expect(clickSpy).toHaveBeenCalled()
  })

  it('opens the file picker when Space is pressed', async () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    renderShell()

    const dropzone = screen.getByRole('button', { name: 'ファイルをドロップ' })
    dropzone.focus()
    await userEvent.keyboard(' ')

    expect(clickSpy).toHaveBeenCalled()
  })

  it('ignores Enter when busy', async () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    renderShell({ busy: true })

    const dropzone = screen.getByRole('button', { name: 'ファイルをドロップ' })
    dropzone.focus()
    await userEvent.keyboard('{Enter}')

    expect(clickSpy).not.toHaveBeenCalled()
  })

  it('ignores keys other than Enter and Space', async () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    renderShell()

    const dropzone = screen.getByRole('button', { name: 'ファイルをドロップ' })
    dropzone.focus()
    await userEvent.keyboard('a')

    expect(clickSpy).not.toHaveBeenCalled()
  })
})
