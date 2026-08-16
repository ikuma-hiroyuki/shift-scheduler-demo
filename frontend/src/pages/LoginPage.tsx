import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ReCAPTCHA from 'react-google-recaptcha'

import { login } from '../api/auth'
import { useAuthStore } from '../stores/auth'
import { useThemeStore } from '../stores/theme'
import logoUrl from '../assets/images/logo.svg'

function getRecaptchaSiteKey(): string | undefined {
  // 関数内で都度参照することでテスト時の vi.stubEnv に追従できる
  const key = import.meta.env.VITE_RECAPTCHA_SITE_KEY
  return typeof key === 'string' && key.length > 0 ? key : undefined
}

function getDemoCredentials(): { email: string; password: string } | undefined {
  // ポートフォリオデモ専用。VITE_DEMO_EMAIL / VITE_DEMO_PASSWORD 両方が
  // 設定されているときだけログイン画面にデモアカウントを案内する。
  const email = import.meta.env.VITE_DEMO_EMAIL
  const password = import.meta.env.VITE_DEMO_PASSWORD
  if (typeof email === 'string' && email.length > 0 && typeof password === 'string' && password.length > 0) {
    return { email, password }
  }
  return undefined
}

export default function LoginPage() {
  const navigate = useNavigate()
  const setToken = useAuthStore((s) => s.setToken)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const recaptchaRef = useRef<ReCAPTCHA | null>(null)
  const siteKey = getRecaptchaSiteKey()
  const demoCredentials = getDemoCredentials()

  function fillDemoCredentials() {
    if (!demoCredentials) return
    setEmail(demoCredentials.email)
    setPassword(demoCredentials.password)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      let captchaToken: string | null = null
      if (siteKey && recaptchaRef.current) {
        // invisible reCAPTCHA: executeAsync で token を取得。site key の type が
        // ページ実装 (size="invisible") と不一致だと Google スクリプトが解決せず
        // executeAsync が永久 hang する。dev では 110 秒で打ち切り誤鍵を即検知する。
        // prod では token 寿命 (120s) を越える 130 秒に延ばし、画像チャレンジは
        // 妨げず firewall/ad-blocker/誤鍵 deploy 等の真の hang のみで発火させる。
        const widget = recaptchaRef.current
        const timeoutMs = import.meta.env.DEV ? 110_000 : 130_000
        captchaToken = await Promise.race([
          widget.executeAsync(),
          new Promise<null>((_, reject) =>
            setTimeout(() => reject(new Error('recaptcha-timeout')), timeoutMs),
          ),
        ])
        widget.reset()
      }
      const token = await login(email, password, captchaToken)
      setToken(token)
      // is_admin 取得: AdminRoute 判定とサイドバー分岐に必要。
      await useAuthStore.getState().fetchCurrentUser()
      useThemeStore.getState().reload()
      navigate('/')
    } catch (e: unknown) {
      const msg = (e as Error)?.message
      // backend が siteverify NG 時に 401 + detail "reCAPTCHA 検証に失敗しました" を返す。
      // 認証失敗（パスワード不一致）と区別して、ユーザーに「やり直し」を促すメッセージを出す。
      const backendDetail = (e as { response?: { data?: { detail?: string } } })?.response?.data
        ?.detail
      if (msg === 'recaptcha-timeout') {
        setError(
          'reCAPTCHA の検証がタイムアウトしました。時間を置いて再試行してください。',
        )
      } else if (typeof backendDetail === 'string' && backendDetail.includes('reCAPTCHA')) {
        setError('セキュリティチェックに失敗しました。再読み込みしてやり直してください。')
      } else {
        setError('メールアドレスまたはパスワードが正しくありません')
      }
      // hang 状態の widget を強制リセット
      try {
        recaptchaRef.current?.reset()
      } catch {
        // ignore
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-cream-100 text-ink flex items-center justify-center px-4">
      <div className="bg-cream-50 border border-ink/10 rounded-2xl shadow-md w-full max-w-sm p-8">
        {/* ロゴ自体が白なので、ブランドカラーの円で囲って視認性を確保する。 */}
        <div className="flex justify-center mb-6">
          <div className="bg-brand-500 rounded-full p-4 shadow-sm flex items-center justify-center">
            <img src={logoUrl} alt="Demo Mart" className="h-12 w-auto" />
          </div>
        </div>
        <h1 className="text-2xl font-bold text-brand-900 mb-1 text-center">稼働表管理システム</h1>
        <p className="text-sm text-ink-muted text-center mb-6">ログイン</p>

        {demoCredentials && (
          <button
            type="button"
            onClick={fillDemoCredentials}
            className="w-full text-left text-xs bg-brand-50 border border-brand-200 rounded-lg px-3 py-2 mb-4 hover:bg-brand-100 transition-colors"
          >
            <p className="font-medium text-brand-900 mb-0.5">
              デモアカウント（クリックで自動入力）
            </p>
            <p className="text-ink-muted">
              {demoCredentials.email} / {demoCredentials.password}
            </p>
          </button>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">
              メールアドレス
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full bg-cream-50 border border-ink/20 text-ink rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 placeholder:text-ink-muted/60"
              placeholder="admin@example.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">
              パスワード
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full bg-cream-50 border border-ink/20 text-ink rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 placeholder:text-ink-muted/60"
              placeholder="password"
            />
          </div>

          {error && (
            <p className="text-sm text-[#a83232] bg-[#a83232]/10 border border-[#a83232]/30 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          {siteKey && (
            <ReCAPTCHA
              ref={recaptchaRef}
              sitekey={siteKey}
              size="invisible"
              badge="bottomright"
            />
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white font-medium rounded-lg py-2 text-sm transition-colors"
          >
            {loading ? 'ログイン中...' : 'ログイン'}
          </button>
        </form>
      </div>
    </div>
  )
}
