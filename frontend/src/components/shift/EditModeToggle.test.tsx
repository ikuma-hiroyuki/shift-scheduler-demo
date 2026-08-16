import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import EditModeToggle from './EditModeToggle'
import { useEditorStore } from '../../stores/editor'

beforeEach(() => {
  useEditorStore.getState().reset()
})

afterEach(() => {
  useEditorStore.getState().reset()
})

describe('EditModeToggle', () => {
  it('shows OFF state initially and switches to edit mode on click', async () => {
    const user = userEvent.setup()
    render(<EditModeToggle />)

    const btn = screen.getByRole('button', { name: '編集モード OFF' })
    await user.click(btn)

    expect(useEditorStore.getState().mode).toBe('edit')
    expect(screen.getByRole('button', { name: '編集モード ON' })).toBeInTheDocument()
  })

  it('exits edit mode on click when active', async () => {
    useEditorStore.getState().enterEditMode()
    const user = userEvent.setup()
    render(<EditModeToggle />)

    await user.click(screen.getByRole('button', { name: '編集モード ON' }))

    expect(useEditorStore.getState().mode).toBe('view')
  })

  it('shows undo/redo count hint only in edit mode and reflects stack sizes', () => {
    useEditorStore.setState({ mode: 'edit', undoStack: [{} as never, {} as never], redoStack: [{} as never] })

    render(<EditModeToggle />)

    expect(screen.getByText(/Ctrl\+Z: 取消 \(2\)/)).toBeInTheDocument()
    expect(screen.getByText(/Ctrl\+Y: やり直し \(1\)/)).toBeInTheDocument()
  })

  it('hides hint in view mode', () => {
    render(<EditModeToggle />)

    expect(screen.queryByText(/Ctrl\+Z/)).not.toBeInTheDocument()
  })
})
