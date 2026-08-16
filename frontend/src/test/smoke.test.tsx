import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

describe('vitest smoke', () => {
  it('renders a basic element', () => {
    render(<div>hello</div>)
    expect(screen.getByText('hello')).toBeInTheDocument()
  })

  it('jsdom environment is active', () => {
    expect(typeof window).toBe('object')
    expect(typeof document).toBe('object')
  })
})
