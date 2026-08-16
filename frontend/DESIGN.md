# Frontend Design Rules

ページ間のビジュアル漂流を防ぐための最小規約。実装前に必ず参照する。

## 1. ページタイトル（必ず `<PageHeader>` を使う）

ページのタイトルは `frontend/src/components/common/PageHeader.tsx` 経由でのみレンダリングする。生の `<h1>` をページに直接書かない。

```tsx
import PageHeader from '../components/common/PageHeader'

<PageHeader
  title="従業員"
  description="稼働表生成の前提となる従業員マスタを管理します"
  kicker="Admin · Employees"          // optional
  rightSlot={<MyStatBlock />}          // optional
/>
```

仕様:

| 要素 | スタイル |
|------|---------|
| `h1` | `text-5xl font-normal text-brand-900 leading-none` + `font-display` (Noto Sans JP, opsz 144, wght 500, letter-spacing -0.02em) |
| 末尾ドット | `<span class="text-brand-600">.</span>` を `PageHeader` が自動付与 |
| description (`<p>`) | `text-sm text-ink-muted mt-3` |
| kicker (`<span>`) | `text-[10px] tracking-[0.3em] uppercase text-brand-600` + `font-mono` |
| 右側スロット | `text-right` 内に任意の React node。stat 表示の標準は `text-3xl font-mono tabular-nums` |
| ヘッダ要素 | `<header class="flex items-end justify-between mb-10 pb-6 border-b border-ink/10">` |

## 2. ページコンテナ

ヘッダの外側は各ページが自前で書く。標準形:

```tsx
<div className="min-h-screen">
  <div className="max-w-6xl mx-auto px-8 py-10">
    <PageHeader title="..." />
    {/* 本体 */}
  </div>
</div>
```

`max-w-*` は表組み幅の都合で `max-w-6xl` / `max-w-[1400px]` / `max-w-[1500px]` 等に拡張可。`px-8 py-10` は維持。

## 3. タイポスケール

| 用途 | クラス |
|------|--------|
| ページタイトル (`h1`) | `text-5xl font-normal` + `font-display` |
| セクション見出し (`h2` / `h3`) | `text-xl font-medium text-brand-900` |
| 本文 | `text-sm` |
| 補助テキスト | `text-xs text-ink-muted` |
| キッカー | `text-[10px] tracking-[0.3em] uppercase` + `font-mono` |
| 数値表示 (stat) | `text-3xl font-mono tabular-nums` |

ボディ最小サイズは `text-xs` (12px)。それ未満は使わない。

## 4. カラートークン

`tailwind.config.js` で CSS 変数 (`--brand-*` / `--cream-*` / `--ink` / `--ink-muted`) 経由のトークンが定義されている。**生の hex を className や style に書かない**。

| トークン | 用途 |
|---------|------|
| `text-brand-900` | プライマリテキスト・タイトル |
| `text-brand-600` | アクセント（タイトルのドット、キッカー） |
| `text-ink` | 本文 |
| `text-ink-muted` | 補助テキスト |
| `bg-brand-900 text-cream-50` | プライマリボタン |
| `border-ink/10` | 区切り線 |

ブランドカラーは `stores/theme.ts` の `applyTheme` でランタイム上書きされる前提。

## 5. フォント変数

`frontend/index.html` で定義:

| 変数 | フォント | 用途 |
|------|---------|------|
| `var(--font-display)` | Noto Sans JP | ページタイトル `h1` |
| `var(--font-mono)` | JetBrains Mono | 数値・キッカー・コード |

本文は OS デフォルト sans-serif (Tailwind 既定)。

## 6. スペーシング

4 / 8 px の倍数を基本とする (Tailwind 既定の rem スケール)。代表値:

- ページ上下 padding: `py-10` (40px)
- ページ横 padding: `px-8` (32px)
- ヘッダ下 margin: `mb-10` + `pb-6 border-b` (canonical)
- カード内 padding: `px-6 py-4`
- セクション間: `gap-6` / `space-y-4`

## 7. アンチパターン

- `<h1>` をページに直接書く（必ず `<PageHeader>` 経由）
- 生 hex / rgb 値（`#1a2940` 等）を className や style に書く
- `text-3xl` / `text-2xl` でページタイトルを書く（`text-5xl` のみ）
- 絵文字をアイコン代わりに使う（SVG / `lucide-react` 等を使う）
- `window.confirm` / `window.alert` / `prompt` を使う（必ず `<ConfirmDialog>` 経由）

## 8. 新ページ追加時のチェックリスト

- [ ] `<PageHeader>` を使っている
- [ ] モーダルを置く場合は overlay 自前定義ではなく `<ModalShell>` 経由
- [ ] コンテナが `min-h-screen` + `max-w-* mx-auto px-8 py-10` 形
- [ ] カラーは brand / cream / ink トークンのみ
- [ ] タイトル末尾ドットの色が他ページと揃う（`PageHeader` 自動）
- [ ] テストで `getByRole('heading', { level: 1 })` がタイトル文字列に一致する

## 9. 確認ダイアログ

破壊的・非可逆な操作（削除・上書き等）の確認には `<ConfirmDialog>` (`frontend/src/components/common/ConfirmDialog.tsx`) を使う。`window.confirm()` / `window.alert()` / `prompt()` は使わない（OS 依存の UI でブランドトーンから外れる、装飾入りメッセージが渡せない、テストしづらい）。

```tsx
import ConfirmDialog from '../components/common/ConfirmDialog'

const [pending, setPending] = useState<T | null>(null)
const [busy, setBusy] = useState(false)

{pending && (
  <ConfirmDialog
    tone="warning"
    title="上書きしますか？"
    description={<p><strong>{pending.name}</strong> を上書きします。</p>}
    confirmLabel="上書きする"
    loading={busy}
    onCancel={() => setPending(null)}
    onConfirm={handleConfirm}
  />
)}
```

| `tone` | 用途 | 既定 kicker / confirmLabel / カラー |
|------|------|----------------------------------|
| `delete` | 削除 | `Delete` / 「削除する」 / `#a83232` |
| `warning` | 上書き・破壊的更新（既定） | `Confirm` / 「実行する」 / `brand-600` |

仕様:

- `description` は `string` または `ReactNode`。装飾を入れたい場合は JSX を渡す
- `kicker` / `confirmLabel` / `cancelLabel` / `loadingLabel` は省略時に tone の既定値が入る
- overlay クリックおよび `Escape` キーで `onCancel` を呼ぶ（`loading` 中は無視）
- 確定ボタンに `autoFocus` 相当のフォーカスが入る
- `role="dialog"` / `aria-modal="true"` / `aria-labelledby` を自動付与

削除専用ラッパーとして `<DeleteConfirm>` (`tone='delete'` 固定) も提供しているが、新規実装は `<ConfirmDialog>` を直接使うのを推奨。

## 10. モーダル overlay の共通シェル

確認ダイアログ以外のモーダル (FormModal、ページ内インライン確認等) は `<ModalShell>` (`frontend/src/components/common/ModalShell.tsx`) を outer wrapper にする。これ単体で:

- `useModalDismiss` フック（Esc キー、`body`/`html` のスクロールロック、フォーカス復帰）
- 名前空間付き属性 `data-confirm-modal-dismiss="true"` の付与（汎用 `data-modal` だと無関係のポップオーバー等と衝突するため）
- mousedown→mouseup ドラッグ判定でテキスト選択中の意図しない overlay クリック cancel 抑制
- `loading` 中は Esc / overlay クリックを無視

を担う。既存の overlay `<div>` ＋ `useModalDismiss` ＋ `data-modal` 三点セットを書く必要はない。

```tsx
import ModalShell from '../components/common/ModalShell'

return (
  <ModalShell onClose={onClose} loading={busy}>
    <form onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit} className="...">
      {/* form 本体 */}
    </form>
  </ModalShell>
)
```

非ブランド配色のシステムダイアログ（生成中インジケータ等）は `overlayClassName` に別の Tailwind クラスを渡すと差し替えできる。`isTopmostModal()` でスタック判定をしたい呼び出し側 (`<ConfirmDialog>` の Tab focus trap など) は `forwardRef` で overlay 要素を取り出す。
