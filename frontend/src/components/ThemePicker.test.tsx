import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import ThemePicker from './ThemePicker'
import { useThemeStore } from '../stores/theme'

beforeEach(() => {
  useThemeStore.setState({ presetId: 'emerald', mode: 'light' })
})

afterEach(() => {
  document.documentElement.removeAttribute('style')
  document.documentElement.classList.remove('dark')
})

describe('ThemePicker — trigger button', () => {
  it('exposes an accessible label and aria-expanded=false initially', () => {
    render(<ThemePicker collapsed={false} />)

    const trigger = screen.getByRole('button', { name: 'テーマ設定' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('shows preset label and "Light" indicator when expanded mode', () => {
    render(<ThemePicker collapsed={false} />)

    expect(screen.getByText('テーマ')).toBeInTheDocument()
    expect(screen.getByText('Light')).toBeInTheDocument()
  })

  it('hides the label text when collapsed', () => {
    render(<ThemePicker collapsed={true} />)

    expect(screen.queryByText('テーマ')).not.toBeInTheDocument()
    // collapsed では title 属性がツールチップ代わりに付く
    expect(screen.getByRole('button', { name: 'テーマ設定' })).toHaveAttribute(
      'title',
      'テーマ設定',
    )
  })

  it('shows "Dark" when current mode is dark', () => {
    useThemeStore.setState({ mode: 'dark' })

    render(<ThemePicker collapsed={false} />)
    expect(screen.getByText('Dark')).toBeInTheDocument()
  })
})

describe('ThemePicker — open/close behavior', () => {
  it('opens the dialog on trigger click', async () => {
    const user = userEvent.setup()
    render(<ThemePicker collapsed={false} />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'テーマ設定' }))

    expect(screen.getByRole('dialog', { name: 'テーマ設定' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'テーマ設定' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })

  it('toggles the dialog on repeated trigger clicks', async () => {
    const user = userEvent.setup()
    render(<ThemePicker collapsed={false} />)

    const trigger = screen.getByRole('button', { name: 'テーマ設定' })
    await user.click(trigger)
    await user.click(trigger)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('closes the dialog when Escape is pressed', async () => {
    const user = userEvent.setup()
    render(<ThemePicker collapsed={false} />)

    await user.click(screen.getByRole('button', { name: 'テーマ設定' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('closes the dialog when clicking outside the wrapper', async () => {
    const user = userEvent.setup()
    render(
      <div>
        <ThemePicker collapsed={false} />
        <button type="button">outside</button>
      </div>,
    )

    await user.click(screen.getByRole('button', { name: 'テーマ設定' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'outside' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('ThemePicker — preset selection', () => {
  it('marks the current preset as aria-pressed=true', async () => {
    const user = userEvent.setup()
    render(<ThemePicker collapsed={false} />)

    await user.click(screen.getByRole('button', { name: 'テーマ設定' }))

    const emeraldBtn = screen.getByRole('button', { name: 'エメラルド', pressed: true })
    expect(emeraldBtn).toBeInTheDocument()
  })

  it('calls setPreset and updates store when a preset is clicked', async () => {
    const user = userEvent.setup()
    render(<ThemePicker collapsed={false} />)

    await user.click(screen.getByRole('button', { name: 'テーマ設定' }))
    await user.click(screen.getByRole('button', { name: 'オーシャン' }))

    expect(useThemeStore.getState().presetId).toBe('ocean')
  })

  it('renders all 6 preset buttons', async () => {
    const user = userEvent.setup()
    render(<ThemePicker collapsed={false} />)

    await user.click(screen.getByRole('button', { name: 'テーマ設定' }))

    for (const label of ['エメラルド', 'オーシャン', 'サンセット', 'プラム', 'ローズ', 'グラファイト']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
  })
})

describe('ThemePicker — mode segmented control', () => {
  it('renders three mode options (Light / Dark / System) as a radiogroup', async () => {
    const user = userEvent.setup()
    render(<ThemePicker collapsed={false} />)

    await user.click(screen.getByRole('button', { name: 'テーマ設定' }))

    const group = screen.getByRole('radiogroup', { name: 'カラーモード' })
    expect(group).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'ライト' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'ダーク' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'システム' })).toBeInTheDocument()
  })

  it('marks the current mode with aria-checked=true', async () => {
    const user = userEvent.setup()
    render(<ThemePicker collapsed={false} />)

    await user.click(screen.getByRole('button', { name: 'テーマ設定' }))

    expect(screen.getByRole('radio', { name: 'ライト' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(screen.getByRole('radio', { name: 'ダーク' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
    expect(screen.getByRole('radio', { name: 'システム' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
  })

  it('switches to dark mode when ダーク is clicked', async () => {
    const user = userEvent.setup()
    render(<ThemePicker collapsed={false} />)

    await user.click(screen.getByRole('button', { name: 'テーマ設定' }))
    await user.click(screen.getByRole('radio', { name: 'ダーク' }))

    expect(useThemeStore.getState().mode).toBe('dark')
  })

  it('switches to system mode when システム is clicked', async () => {
    const user = userEvent.setup()
    render(<ThemePicker collapsed={false} />)

    await user.click(screen.getByRole('button', { name: 'テーマ設定' }))
    await user.click(screen.getByRole('radio', { name: 'システム' }))

    expect(useThemeStore.getState().mode).toBe('system')
  })

  it('shows "System" label on the trigger when current mode is system', () => {
    useThemeStore.setState({ mode: 'system' })

    render(<ThemePicker collapsed={false} />)
    expect(screen.getByText('System')).toBeInTheDocument()
  })
})
