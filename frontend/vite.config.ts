import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Docker 起動時は override で `http://app:8000` を注入。
// ホスト直起動 (`npm run dev`) のときだけ localhost フォールバックが効く。
const apiTarget = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:8000'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5273,
    watch: {
      usePolling: true,
      interval: 300,
    },
    hmr: {
      clientPort: 5273,
    },
    proxy: {
      '/api': apiTarget,
      '/auth': apiTarget,
    },
  },
  build: {
    // issue #91: production bundle に内部情報を残さない。
    // sourcemap は埋めない（コードと変数名の対応表が出るため）。
    sourcemap: false,
    minify: 'terser',
    terserOptions: {
      compress: {
        // 開発時の console / debugger を本番から完全に取り除く。
        drop_console: true,
        drop_debugger: true,
      },
    },
  },
})
