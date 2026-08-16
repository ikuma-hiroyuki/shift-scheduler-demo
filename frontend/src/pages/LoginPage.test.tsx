import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import LoginPage from './LoginPage'
import { login } from '../api/auth'
import { useAuthStore } from '../stores/auth'
import { useThemeStore } from '../stores/theme'
import { renderWithRouter } from '../test/utils'

vi.mock('../api/auth', () => ({
  login: vi.fn(),
}))

// react-google-recaptcha を stub する。
// invisible モードでは executeAsync() で token を取得するので、それを mock。
const mockExecuteAsync = vi.fn<() => Promise<string | null>>()
const mockReset = vi.fn()

vi.mock('react-google-recaptcha', () => {
  const React = require('react') as typeof import('react')
  // forwardRef で ref API を提供。site_key が undefined の場合 LoginPage は描画しないので、
  // ここは描画される時のみ呼ばれる。
  const ReCAPTCHA = React.forwardRef<unknown, { sitekey: string }>((props, ref) => {
    React.useImperativeHandle(ref, () => ({
      executeAsync: mockExecuteAsync,
      reset: mockReset,
    }))
    return React.createElement('div', {
      'data-testid': 'recaptcha-widget',
      'data-sitekey': props.sitekey,
    })
  })
  return { default: ReCAPTCHA }
})

const mockLogin = vi.mocked(login)
const mockNavigate = vi.fn()

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

beforeEach(() => {
  useAuthStore.setState({ token: null })
  mockLogin.mockReset()
  mockNavigate.mockReset()
  mockExecuteAsync.mockReset()
  mockReset.mockReset()
  // env を毎回クリアする（個別テストで設定）。
  // `unstubAllEnvs` は stub だけ消し、`.env` 由来の baseline は残るため
  // 明示的に空文字をかぶせて「未設定」状態を再現する。
  vi.unstubAllEnvs()
  vi.stubEnv('VITE_RECAPTCHA_SITE_KEY', '')
})

afterEach(() => {
  vi.clearAllMocks()
})

void render

describe('LoginPage', () => {
  it('renders title, email/password fields and the login button', () => {
    renderWithRouter(<LoginPage />)

    expect(screen.getByRole('heading', { name: '稼働表管理システム' })).toBeInTheDocument()
    expect(screen.getByText('メールアドレス')).toBeInTheDocument()
    expect(screen.getByText('パスワード')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('admin@example.com')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('password')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ログイン' })).toBeInTheDocument()
  })

  it('renders the Demo Mart logo image', () => {
    renderWithRouter(<LoginPage />)

    const logo = screen.getByAltText('Demo Mart')
    expect(logo).toBeInTheDocument()
    expect(logo.tagName).toBe('IMG')
  })

  it('successful login stores token and navigates to /', async () => {
    mockLogin.mockResolvedValueOnce('jwt.token.123')
    const user = userEvent.setup()
    renderWithRouter(<LoginPage />)

    await user.type(screen.getByPlaceholderText('admin@example.com'), 'admin@test.com')
    await user.type(screen.getByPlaceholderText('password'), 'pw')
    await user.click(screen.getByRole('button', { name: 'ログイン' }))

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('admin@test.com', 'pw', null)
    })
    expect(useAuthStore.getState().token).toBe('jwt.token.123')
    expect(mockNavigate).toHaveBeenCalledWith('/')
  })

  it('shows generic error message on login failure', async () => {
    mockLogin.mockRejectedValueOnce(new Error('401'))
    const user = userEvent.setup()
    renderWithRouter(<LoginPage />)

    await user.type(screen.getByPlaceholderText('admin@example.com'), 'wrong@test.com')
    await user.type(screen.getByPlaceholderText('password'), 'bad')
    await user.click(screen.getByRole('button', { name: 'ログイン' }))

    expect(
      await screen.findByText('メールアドレスまたはパスワードが正しくありません'),
    ).toBeInTheDocument()
    expect(useAuthStore.getState().token).toBeNull()
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('shows reCAPTCHA-specific error when backend 401 detail mentions reCAPTCHA', async () => {
    // backend は siteverify NG 時に 401 + detail "reCAPTCHA 検証に失敗しました" を返す。
    // axios エラーは response.data.detail を持つ形で throw されるので、それを再現する。
    const axiosLikeError = Object.assign(new Error('Request failed with status code 401'), {
      response: {
        status: 401,
        data: { detail: 'reCAPTCHA 検証に失敗しました' },
      },
    })
    mockLogin.mockRejectedValueOnce(axiosLikeError)
    const user = userEvent.setup()
    renderWithRouter(<LoginPage />)

    await user.type(screen.getByPlaceholderText('admin@example.com'), 'a@b.com')
    await user.type(screen.getByPlaceholderText('password'), 'pw')
    await user.click(screen.getByRole('button', { name: 'ログイン' }))

    expect(
      await screen.findByText(
        'セキュリティチェックに失敗しました。再読み込みしてやり直してください。',
      ),
    ).toBeInTheDocument()
    // 認証失敗用の汎用メッセージは出さない
    expect(
      screen.queryByText('メールアドレスまたはパスワードが正しくありません'),
    ).not.toBeInTheDocument()
    expect(useAuthStore.getState().token).toBeNull()
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('reloads theme after a successful login (picks up per-user pref)', async () => {
    mockLogin.mockResolvedValueOnce('jwt.token.123')
    const reloadSpy = vi.spyOn(useThemeStore.getState(), 'reload')
    const user = userEvent.setup()
    renderWithRouter(<LoginPage />)

    await user.type(screen.getByPlaceholderText('admin@example.com'), 'a@b.com')
    await user.type(screen.getByPlaceholderText('password'), 'pw')
    await user.click(screen.getByRole('button', { name: 'ログイン' }))

    await waitFor(() => {
      expect(useAuthStore.getState().token).toBe('jwt.token.123')
    })
    expect(reloadSpy).toHaveBeenCalled()
  })

  it('disables button and shows "ログイン中..." while pending', async () => {
    let resolveLogin: (token: string) => void = () => {}
    mockLogin.mockReturnValueOnce(
      new Promise<string>((resolve) => { resolveLogin = resolve }),
    )

    const user = userEvent.setup()
    renderWithRouter(<LoginPage />)

    await user.type(screen.getByPlaceholderText('admin@example.com'), 'admin@test.com')
    await user.type(screen.getByPlaceholderText('password'), 'pw')
    await user.click(screen.getByRole('button', { name: 'ログイン' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'ログイン中...' })).toBeDisabled()
    })

    resolveLogin('tok')
    await waitFor(() => {
      expect(useAuthStore.getState().token).toBe('tok')
    })
  })

  // ----------------------------------------------------------------- //
  // reCAPTCHA
  // ----------------------------------------------------------------- //

  it('does NOT render reCAPTCHA widget when VITE_RECAPTCHA_SITE_KEY is unset', async () => {
    // site key 未設定（既定）
    mockLogin.mockResolvedValueOnce('jwt.tok')
    const user = userEvent.setup()
    renderWithRouter(<LoginPage />)

    expect(screen.queryByTestId('recaptcha-widget')).not.toBeInTheDocument()

    await user.type(screen.getByPlaceholderText('admin@example.com'), 'a@b.com')
    await user.type(screen.getByPlaceholderText('password'), 'pw')
    await user.click(screen.getByRole('button', { name: 'ログイン' }))

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('a@b.com', 'pw', null)
    })
    expect(mockExecuteAsync).not.toHaveBeenCalled()
  })

  it('shows user-friendly timeout error if executeAsync hangs past 110s in dev', async () => {
    // dev で v2 Checkbox 鍵を invisible 実装に渡すと Google スクリプトが永久 hang する。
    // race で 110s 打ち切り → ユーザー向けメッセージを出す。prod では race を張らない
    // (token 寿命 120s に任せる) が、Vitest 既定では import.meta.env.DEV = true。
    // userEvent は fake timers と相性が悪いので fireEvent + act で制御する。
    vi.stubEnv('VITE_RECAPTCHA_SITE_KEY', 'test-site-key')
    mockExecuteAsync.mockReturnValueOnce(new Promise<string>(() => {}))
    vi.useFakeTimers()
    try {
      renderWithRouter(<LoginPage />)

      fireEvent.change(screen.getByPlaceholderText('admin@example.com'), {
        target: { value: 'a@b.com' },
      })
      fireEvent.change(screen.getByPlaceholderText('password'), { target: { value: 'pw' } })
      fireEvent.click(screen.getByRole('button', { name: 'ログイン' }))

      await act(async () => {
        await vi.advanceTimersByTimeAsync(110_000)
      })

      expect(
        screen.getByText(
          'reCAPTCHA の検証がタイムアウトしました。時間を置いて再試行してください。',
        ),
      ).toBeInTheDocument()
      expect(mockLogin).not.toHaveBeenCalled()
      expect(mockReset).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('renders reCAPTCHA widget and sends token when VITE_RECAPTCHA_SITE_KEY is set', async () => {
    vi.stubEnv('VITE_RECAPTCHA_SITE_KEY', 'test-site-key')
    mockExecuteAsync.mockResolvedValueOnce('captcha-tok-xyz')
    mockLogin.mockResolvedValueOnce('jwt.tok')
    const user = userEvent.setup()
    renderWithRouter(<LoginPage />)

    expect(screen.getByTestId('recaptcha-widget')).toHaveAttribute(
      'data-sitekey',
      'test-site-key',
    )

    await user.type(screen.getByPlaceholderText('admin@example.com'), 'a@b.com')
    await user.type(screen.getByPlaceholderText('password'), 'pw')
    await user.click(screen.getByRole('button', { name: 'ログイン' }))

    await waitFor(() => {
      expect(mockExecuteAsync).toHaveBeenCalledTimes(1)
    })
    expect(mockLogin).toHaveBeenCalledWith('a@b.com', 'pw', 'captcha-tok-xyz')
    expect(mockReset).toHaveBeenCalled()
  })
})
