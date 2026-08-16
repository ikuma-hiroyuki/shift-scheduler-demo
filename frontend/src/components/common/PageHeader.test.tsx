import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import PageHeader from './PageHeader'

describe('PageHeader', () => {
  it('renders title with brand-colored period', () => {
    render(<PageHeader title="従業員" />)
    const h1 = screen.getByRole('heading', { level: 1 })
    expect(h1.textContent).toBe('従業員.')
    const dot = h1.querySelector('span.text-brand-600')
    expect(dot?.textContent).toBe('.')
  })

  it('renders description and kicker when provided', () => {
    render(
      <PageHeader title="役職" description="役職マスタを管理" kicker="Admin · Roles" />,
    )
    expect(screen.getByText('役職マスタを管理')).toBeInTheDocument()
    expect(screen.getByText('Admin · Roles')).toBeInTheDocument()
  })

  it('omits description and kicker when not provided', () => {
    const { container } = render(<PageHeader title="X" />)
    expect(container.querySelector('p')).toBeNull()
    expect(container.querySelector('span.text-brand-600')?.textContent).toBe('.')
  })

  it('renders rightSlot content', () => {
    render(
      <PageHeader title="X" rightSlot={<div data-testid="slot">stat</div>} />,
    )
    expect(screen.getByTestId('slot')).toBeInTheDocument()
  })

  it('uses h1 with text-5xl class', () => {
    render(<PageHeader title="X" />)
    const h1 = screen.getByRole('heading', { level: 1 })
    expect(h1.className).toContain('text-5xl')
  })
})
