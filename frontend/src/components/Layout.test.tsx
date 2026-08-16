import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import Layout from './Layout'
import { useAuthStore } from '../stores/auth'
import { useThemeStore } from '../stores/theme'
import { useSidebarPatternStore } from '../stores/sidebarPattern'
import { renderWithRouter } from '../test/utils'

const mockNavigate = vi.fn()

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

beforeEach(() => {
  useAuthStore.setState({ token: null })
  useThemeStore.setState({ presetId: 'emerald', mode: 'light' })
  useSidebarPatternStore.setState({ patternId: 'none' })
  mockNavigate.mockReset()
})

afterEach(() => {
  document.documentElement.removeAttribute('style')
  document.documentElement.classList.remove('dark')
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Nav items
// ---------------------------------------------------------------------------

describe('Layout — navigation items', () => {
  it('renders all four primary nav links with correct hrefs', () => {
    renderWithRouter(<Layout />)

    const links = [
      { name: '稼働表', href: '/shift' },
      { name: '従業員', href: '/employees' },
      { name: '作業パターン', href: '/work-patterns' },
      { name: '優先パターン', href: '/employee-priorities' },
    ]
    for (const { name, href } of links) {
      const link = screen.getByRole('link', { name: new RegExp(name) })
      expect(link).toHaveAttribute('href', href)
    }
  })

  it('marks the current route as active (/shift)', () => {
    renderWithRouter(<Layout />, { route: '/shift' })

    const shiftLink = screen.getByRole('link', { name: /稼働表/ })
    expect(shiftLink.className).toContain('bg-white/20')
  })

  it('marks /employees as active when navigated there', () => {
    renderWithRouter(<Layout />, { route: '/employees' })

    const empLink = screen.getByRole('link', { name: /従業員/ })
    expect(empLink.className).toContain('bg-white/20')
  })
})

// ---------------------------------------------------------------------------
// Logo
// ---------------------------------------------------------------------------

describe('Layout — logo', () => {
  it('renders the brand logo', () => {
    renderWithRouter(<Layout />)

    expect(screen.getByAltText('Demo Mart')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

describe('Layout — logout', () => {
  it('logout button clears auth and navigates to /login', async () => {
    useAuthStore.setState({ token: 'tok-123' })
    expect(useAuthStore.getState().token).toBe('tok-123')

    const user = userEvent.setup()
    renderWithRouter(<Layout />)

    await user.click(screen.getByRole('button', { name: /ログアウト/ }))

    expect(useAuthStore.getState().token).toBeNull()
    expect(mockNavigate).toHaveBeenCalledWith('/login')
  })
})

// ---------------------------------------------------------------------------
// Sidebar collapse
// ---------------------------------------------------------------------------

describe('Layout — sidebar collapse', () => {
  it('persists collapsed state to localStorage', async () => {
    const user = userEvent.setup()
    renderWithRouter(<Layout />)

    // 初期は展開（"稼働表" テキスト見える）
    expect(screen.getByText('稼働表')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'メニューを折りたたむ' }))

    await waitFor(() => {
      expect(localStorage.getItem('sidebar_collapsed')).toBe('1')
    })
    // collapsed では nav ラベルテキスト非表示（aria-label のみ）
    expect(screen.queryByText('稼働表')).not.toBeInTheDocument()
  })

  it('reads initial collapsed state from localStorage', () => {
    localStorage.setItem('sidebar_collapsed', '1')

    renderWithRouter(<Layout />)

    // 折りたたみ初期化 → ラベル非表示、展開ボタンの aria-label 確認
    expect(screen.getByRole('button', { name: 'メニューを展開' })).toBeInTheDocument()
    expect(screen.queryByText('稼働表')).not.toBeInTheDocument()
  })

  it('expands again after toggling', async () => {
    localStorage.setItem('sidebar_collapsed', '1')
    const user = userEvent.setup()
    renderWithRouter(<Layout />)

    await user.click(screen.getByRole('button', { name: 'メニューを展開' }))

    await waitFor(() => {
      expect(localStorage.getItem('sidebar_collapsed')).toBe('0')
    })
    expect(screen.getByText('稼働表')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Mobile drawer
// ---------------------------------------------------------------------------

describe('Layout — mobile drawer', () => {
  it('opens via the mobile burger and closes via the close button', async () => {
    const user = userEvent.setup()
    renderWithRouter(<Layout />)

    // モバイルバーガーは複数（top bar + sidebar header）あり、ラベルで一意に取れる
    await user.click(screen.getByRole('button', { name: 'メニューを開く' }))

    // 閉じるボタンが押下可能になる（mobile sidebar 表示中）
    const closeBtn = screen.getByRole('button', { name: 'メニューを閉じる' })
    expect(closeBtn).toBeInTheDocument()

    await user.click(closeBtn)

    // 閉じた後はオーバーレイが消える（divback overlay）
    await waitFor(() => {
      // オーバーレイ要素は背景クリック用 div のみ。閉じれば消えるはずだが
      // sidebar 自体は md:translate-x-0 で常時 DOM 残るので、状態は class で表現される。
      // ここでは closebtn が「mobileOpen=true 時のみ意味を持つ」前提で、
      // 再度 sidebar が `-translate-x-full` を持つことで close 状態を確認。
      const aside = document.querySelector('aside')!
      expect(aside.className).toContain('-translate-x-full')
    })
  })

  it('closing drawer happens automatically when clicking a nav link', async () => {
    const user = userEvent.setup()
    renderWithRouter(<Layout />)

    await user.click(screen.getByRole('button', { name: 'メニューを開く' }))
    const aside = document.querySelector('aside')!
    expect(aside.className).toContain('translate-x-0')

    await user.click(screen.getByRole('link', { name: /従業員/ }))

    await waitFor(() => {
      expect(aside.className).toContain('-translate-x-full')
    })
  })
})

// ---------------------------------------------------------------------------
// ThemePicker mount
// ---------------------------------------------------------------------------

describe('Layout — ThemePicker', () => {
  it('mounts ThemePicker (trigger button accessible)', () => {
    renderWithRouter(<Layout />)

    expect(screen.getByRole('button', { name: 'テーマ設定' })).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Theme persistence across logout
// ---------------------------------------------------------------------------

describe('Layout — theme persists across logout', () => {
  it('does not flip back to defaults after logout (no flicker)', async () => {
    localStorage.setItem('current_user_id', 'user-1')
    localStorage.setItem(
      'theme_pref:user-1',
      JSON.stringify({ presetId: 'rose', mode: 'dark' }),
    )
    useThemeStore.setState({ presetId: 'rose', mode: 'dark' })
    document.documentElement.classList.add('dark')
    useAuthStore.setState({ token: 'tok-active' })

    const user = userEvent.setup()
    renderWithRouter(<Layout />)

    await user.click(screen.getByRole('button', { name: /ログアウト/ }))

    expect(useThemeStore.getState().presetId).toBe('rose')
    expect(useThemeStore.getState().mode).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('does not call useThemeStore.reload on token transitions (responsibility moved to LoginPage)', async () => {
    const reloadSpy = vi.spyOn(useThemeStore.getState(), 'reload')
    useAuthStore.setState({ token: 'tok-active' })

    const user = userEvent.setup()
    renderWithRouter(<Layout />)

    reloadSpy.mockClear()

    await user.click(screen.getByRole('button', { name: /ログアウト/ }))

    expect(reloadSpy).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Sidebar pattern
// ---------------------------------------------------------------------------

describe('Layout — sidebar pattern', () => {
  it('applies pattern as background-image on the aside when one is selected', () => {
    useSidebarPatternStore.setState({ patternId: 'asanoha' })
    renderWithRouter(<Layout />)

    const aside = document.querySelector('aside')!
    // jsdom は url(data:...) を CSSOM 上では空文字に正規化することがあるため、
    // 生の `style` 属性で確認する。
    const styleAttr = aside.getAttribute('style') ?? ''
    expect(styleAttr).toMatch(/background-image:\s*url\(/)
    expect(styleAttr).toContain('data:image/svg+xml')
  })

  it('does not set a data URI background when pattern is "none"', () => {
    useSidebarPatternStore.setState({ patternId: 'none' })
    renderWithRouter(<Layout />)

    const aside = document.querySelector('aside')!
    const styleAttr = aside.getAttribute('style') ?? ''
    expect(styleAttr).not.toContain('data:image/svg+xml')
  })

  it('selecting a pattern from the unified theme popover updates store and aside background', async () => {
    const user = userEvent.setup()
    renderWithRouter(<Layout />)

    // テーマ設定ポップオーバーを開いて「七宝」を選択
    await user.click(screen.getByRole('button', { name: 'テーマ設定' }))
    await user.click(screen.getByRole('button', { name: '七宝' }))

    expect(useSidebarPatternStore.getState().patternId).toBe('shippo')
    const aside = document.querySelector('aside')!
    await waitFor(() => {
      const styleAttr = aside.getAttribute('style') ?? ''
      expect(styleAttr).toContain('data:image/svg+xml')
    })
  })

  it('renders pattern swatches inside the theme popover', async () => {
    const user = userEvent.setup()
    renderWithRouter(<Layout />)

    await user.click(screen.getByRole('button', { name: 'テーマ設定' }))

    expect(screen.getByRole('button', { name: '亀甲' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '麻の葉' })).toBeInTheDocument()
  })
})
