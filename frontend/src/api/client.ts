import axios from 'axios'
import { useAuthStore } from '../stores/auth'

// Cloudflare Pages は外部オリジンへの200リライト（プロキシ）に非対応のため、
// 本番では VITE_API_URL で Render のバックエンド絶対URLを指定する。
// 未設定時（ローカル開発）は Vite dev server のプロキシ経由で相対パスを使う。
const client = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/' })

client.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

client.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      useAuthStore.getState().logout()
      window.location.href = '/login'
    }
    return Promise.reject(err)
  },
)

export default client
