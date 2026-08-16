import client from './client'

// ポートフォリオデモ専用。DEMO_MODE=false のバックエンドでは 403 を返す。
export async function resetDemoData(): Promise<void> {
  await client.post('/api/v1/demo/reset')
}
