# CLAUDE.md - 開発ワークフロー & プロジェクト基準

## 1. ワークフロー原則（最優先）

### Plan Mode Default
- 非自明なタスク（3ステップ以上、機能追加、アーキテクチャ変更、リファクタなど）は必ず Plan Mode から開始
- 計画は `tasks/todo.md` にチェック可能形式で記述
- 計画確認 → 実装 → 検証 のサイクルを厳守
- 問題発生時は即停止 → 再計画

### TDD（Test-Driven Development）徹底
- すべての新機能・バグ修正はテストコードから開始
- テストコードは失敗することを確認 → 実装 → テスト成功 → リファクタ
- テストカバレッジは常に高く保つ（特に最適化ロジックやAPIエンドポイント）

### Git Branching Rule（必須）
- **機能追加時は必ずブランチを作成する**
  - `main` への直接コミット・直接プッシュを**厳禁**
  - ブランチ命名規則：
    - 新機能：`feature/xxx`（例: `feature/add-employee-priority-matrix`）
    - バグ修正：`fix/xxx`
    - リファクタ：`refactor/xxx`
    - その他：`chore/xxx`、`docs/xxx`
- 小さな修正でも「機能追加」や「仕様変更」に該当する場合は必ずブランチを切る
- 作業フロー：ブランチ作成 → 実装 → ローカル検証 → PR作成 → レビュー → mainマージ

### Subagent / Parallel Strategy
- 複雑な調査・探索・並列作業はサブエージェントにオフロード
- 1サブエージェント = 1タスク（集中維持）

### Verification Before Done
- 動作確認・テスト・差分検証なしで「完了」としない
- 「Staff Engineer が承認するか？」を自問する

### Self-Improvement Loop
- ユーザーからの修正指示後 → `tasks/lessons.md` にパターンと防止策を記録
- セッション開始時に関連レッスンをレビュー

### Autonomous Bug Fixing
- バグ報告を受けたらログ・エラー・失敗テストを特定して即時修正
- ユーザーに手取り足取り聞かない

## 2. コア原則

- **Simplicity First**：最小限の変更で最大の効果
- **Minimal Impact**：必要な箇所のみ変更（副作用を最小化）
- **Demand Elegance**：非自明な変更時は「よりエレガントな方法はないか？」を検討
- **Root Cause**：一時しのぎ禁止。根本原因を解決
- **Documentation**：変更ごとに高レベルサマリーとレビューセクションを `tasks/todo.md` に追加

## 3. プロジェクト概要

**小売店向け月次シフト自動生成システム**
Google OR-Tools CP-SAT を用いた制約最適化 + React Web UI による手動調整機能。

### 現在のフェーズ状況（2026年5月時点）

| Phase | 内容                              | 状態     |
|-------|-----------------------------------|----------|
| 0     | CLI PoC（CP-SAT + CSV入出力）    | ✅ 完了  |
| 1     | 基盤（FastAPI + DB + Docker）    | ✅ 完了  |
| 2     | 最適化 API（ARQ + INFEASIBLE診断）| ✅ 完了  |
| 3     | Web UI（生成・グリッド表示）      | ✅ 完了  |
| 4     | 手動調整 UI（編集・バッファ・確定）| ✅ 完了 |
| 4.1   | バッチ PATCH + マスタ管理画面     | ✅ 完了  |
| 5     | 残マスタUI（issue #108）         | ✅ 完了（day_templates / choice_groups / pattern_triggers 全マスタ実装） |
| 5.1   | optimizer 制約バグ修正（#113/#114）| ✅ 完了 |
| 5.partial | PARTIAL ステータス + 部分割当 + 不足セル可視化 (PR #230) | ✅ 完了 |
| 5.priority | 優先作業パターン未設定の hard 禁止 + preflight + choice_group 不足表示 (PR #232) | ✅ 完了 |
| 5.role-rest-master | 役職別月間休日数マスタ化 (`roles.rest_days_28_29/30/31`) + H3 cascade C 案 (PR #239 / issue #235) | ✅ 完了 |
| 5.staffing-range | 日テンプレ必要人数の範囲指定 (`required_min` + `required_max`, n〜m 人) + 選択グループ表示統一 (PR #249 / issue #247, v0.6.0) | ✅ 完了 |
| 6     | 多店舗対応・AI支援                | 🔜 未着手 |

## 4. 技術スタック

**Backend**
- Python 3.13 + FastAPI + SQLAlchemy 2.0 (async) + PostgreSQL
- OR-Tools CP-SAT + ARQ (Redis) + Alembic + openpyxl

**Frontend**
- React 18 + Vite + TypeScript + Tailwind CSS + Zustand + Axios
- **Client-only SPA**（SSR 不採用）。`window` / `document` / `localStorage` は常にブラウザ上で利用可能な前提でコードを書く。SSR ガード（`typeof window === 'undefined'` 等）は追加しない。将来 Next.js などへ移行する場合は、その時点で再導入する。

**Infrastructure**
- Docker Compose（frontend / app / worker / db / redis）
- nginx リバースプロキシ

## 5. 主要ディレクトリ

/
├── frontend/          # React SPA
├── app/
│   ├── api/routers/
│   ├── optimizer/     # loader, adapter, cp_sat_model（CP-SAT本体）
│   ├── scripts/       # seed.py + seed_data/（初回シードCSV）
│   ├── services/
│   ├── tasks/         # ARQワーカー
│   └── models/
└── tasks/             # todo.md, lessons.md

## 6. 開発ガイドライン

- **命名規則**：`variant` 禁止。「作業パターン」「作業パターングループ」で統一
- **文字コード**：出力 `utf-8-sig`、読み込み `utf-8`
- **型ヒント**：Python 3.13 の型ヒントと `dataclass` を積極使用
- **ローカル開発**：
  - `docker compose up`（override.yml で Vite HMR有効）
  - 本番確認時は `docker compose -f docker-compose.yml up -d`
  - 初回シード：`docker compose exec app python -m app.scripts.seed`
- **UI開発**：計画は `/ui-ux-pro-max`、実装は `/frontend-design`

## gstack (REQUIRED — global install)

**Before doing ANY work, verify gstack is installed:**

```bash
test -d ~/.claude/skills/gstack/bin && echo "GSTACK_OK" || echo "GSTACK_MISSING"
```

If GSTACK_MISSING: STOP. Do not proceed. Tell the user:

> gstack is required for all AI-assisted work in this repo.
> Install it:
> ```bash
> git clone --depth 1 https://github.com/garrytan/gstack.git ~/.claude/skills/gstack
> cd ~/.claude/skills/gstack && ./setup --team
> ```
> Then restart your AI coding tool.

Do not skip skills, ignore gstack errors, or work around missing gstack.

Use the `/browse` skill from gstack for all web browsing.
Never use `mcp__claude-in-chrome__*` tools.

Available gstack skills:
`/office-hours`, `/plan-ceo-review`, `/plan-eng-review`, `/plan-design-review`,
`/design-consultation`, `/design-shotgun`, `/design-html`, `/review`, `/ship`,
`/land-and-deploy`, `/canary`, `/benchmark`, `/browse`, `/connect-chrome`, `/qa`,
`/qa-only`, `/design-review`, `/setup-browser-cookies`, `/setup-deploy`,
`/setup-gbrain`, `/retro`, `/investigate`, `/document-release`, `/codex`, `/cso`,
`/autoplan`, `/plan-devex-review`, `/devex-review`, `/careful`, `/freeze`,
`/guard`, `/unfreeze`, `/gstack-upgrade`, `/learn`.

Use `~/.claude/skills/gstack/...` for gstack file paths (the global path).

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
