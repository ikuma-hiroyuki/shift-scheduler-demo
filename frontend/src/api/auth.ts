import client from './client'
import type { User } from '../types/api'

// ログインは OAuth2PasswordRequestForm（application/x-www-form-urlencoded）。
// captcha_token は reCAPTCHA v2 invisible で取得した token（未設定なら省略）。
export async function login(
  email: string,
  password: string,
  captchaToken?: string | null,
): Promise<string> {
  const params = new URLSearchParams()
  params.append('username', email)
  params.append('password', password)
  if (captchaToken) {
    params.append('captcha_token', captchaToken)
  }

  const res = await client.post<{ access_token: string }>('/auth/login', params, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })
  return res.data.access_token
}

// 現在ログイン中ユーザーの情報 (is_admin 含む) を取得。
// フロントは login 直後とアプリ起動時に呼ぶ。
export async function getCurrentUser(): Promise<User> {
  const res = await client.get<User>('/auth/me')
  return res.data
}
