import type { ReactElement, ReactNode } from 'react'
import { render, type RenderOptions, type RenderResult } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

type RouterRenderOptions = RenderOptions & {
  route?: string
}

export function renderWithRouter(
  ui: ReactElement,
  { route = '/', ...options }: RouterRenderOptions = {},
): RenderResult {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
  )
  return render(ui, { wrapper, ...options })
}

export function renderWithProviders(
  ui: ReactElement,
  options: RenderOptions = {},
): RenderResult {
  return render(ui, options)
}
