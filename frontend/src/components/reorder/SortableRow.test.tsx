import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import SortableRow, { DragHandle } from './SortableRow'
import SortableContainer from './SortableContainer'

function withContext(ids: number[], children: React.ReactNode) {
  return (
    <SortableContainer ids={ids} onReorder={() => {}}>
      {children}
    </SortableContainer>
  )
}

describe('SortableRow', () => {
  it('renders as a <tr> by default inside a table', () => {
    const { container } = render(
      <table>
        <tbody>
          {withContext(
            [1],
            <SortableRow id={1}>
              {(h) => (
                <td>
                  <DragHandle attributes={h.attributes} listeners={h.listeners} />
                  body
                </td>
              )}
            </SortableRow>,
          )}
        </tbody>
      </table>,
    )

    const tr = container.querySelector('tr')
    expect(tr).not.toBeNull()
  })

  it('renders as <li> when as="li"', () => {
    const { container } = render(
      <ul>
        {withContext(
          [1],
          <SortableRow id={1} as="li">
            {() => <span>item</span>}
          </SortableRow>,
        )}
      </ul>,
    )

    expect(container.querySelector('li')).not.toBeNull()
  })

  it('renders as <div> when as="div"', () => {
    const { container } = render(
      <div>
        {withContext(
          [1],
          <SortableRow id={1} as="div">
            {() => <span>item</span>}
          </SortableRow>,
        )}
      </div>,
    )

    expect(container.querySelectorAll('div').length).toBeGreaterThan(0)
  })

  it('passes attributes/listeners through render prop to DragHandle', () => {
    render(
      <table>
        <tbody>
          {withContext(
            [1],
            <SortableRow id={1}>
              {(h) => (
                <td>
                  <DragHandle attributes={h.attributes} listeners={h.listeners} />
                </td>
              )}
            </SortableRow>,
          )}
        </tbody>
      </table>,
    )

    expect(screen.getByRole('button', { name: '並び順を変更' })).toBeInTheDocument()
  })
})

describe('DragHandle', () => {
  it('renders an accessible button labelled "並び順を変更"', () => {
    render(
      <DragHandle
        attributes={{} as React.HTMLAttributes<HTMLElement>}
        listeners={undefined}
      />,
    )

    expect(screen.getByRole('button', { name: '並び順を変更' })).toBeInTheDocument()
  })

  it('disables the button when disabled prop is true', () => {
    render(
      <DragHandle
        attributes={{} as React.HTMLAttributes<HTMLElement>}
        listeners={undefined}
        disabled
      />,
    )

    expect(screen.getByRole('button', { name: '並び順を変更' })).toBeDisabled()
  })
})
