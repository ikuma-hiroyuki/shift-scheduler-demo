import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import SortableContainer from './SortableContainer'

let onReorder: ReturnType<typeof vi.fn>

beforeEach(() => {
  onReorder = vi.fn()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('SortableContainer', () => {
  it('renders children unwrapped when disabled', () => {
    render(
      <SortableContainer ids={[1, 2]} onReorder={onReorder} disabled>
        <span data-testid="child">child</span>
      </SortableContainer>,
    )

    expect(screen.getByTestId('child')).toBeInTheDocument()
  })

  it('renders children inside DndContext when enabled', () => {
    render(
      <SortableContainer ids={[1, 2]} onReorder={onReorder}>
        <div data-testid="child">child</div>
      </SortableContainer>,
    )

    // 子は描画される（DndContext 自体は role を持たないが、children は通る）
    expect(screen.getByTestId('child')).toBeInTheDocument()
    // disabled=false なので何も呼ばれない（drag は別途）
    expect(onReorder).not.toHaveBeenCalled()
  })
})
