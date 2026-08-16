# シフト自動作成システム

> **本リポジトリはポートフォリオ用のデモです。** 実在の店舗プロジェクトを元に、企業名・ロゴ・従業員データ・実業務ファイルをすべて架空のものに置き換えています。「Demo Mart」は説明のための架空のスーパーマーケットであり、実在の企業とは関係ありません。

小売店舗の**月次シフトを CP-SAT ソルバーで自動生成**するシステム。
Excel VBA による手動管理から Python ベースの自動化へ段階的に移行するという想定のもとで設計されている。

---

## 目次

- [これは何？何ができる？](#これは何何ができる)
- [「Docker」「FastAPI」って何？（用語の説明）](#dockerfastapiって何用語の説明)
- [シフトを自動生成するには（毎月の手順）](#シフトを自動生成するには毎月の手順)
- [UI 文言ポリシー（ユーザー向け表示）](#ui-文言ポリシーユーザー向け表示)
- [プロジェクト現状](#プロジェクト現状)
- [業務ドメイン概要](#業務ドメイン概要)
- [要件と実装状況の対応](#要件と実装状況の対応)
- [仕様詳細：C グループの発生ロジック](#仕様詳細c-グループの発生ロジック)
- [Phase 0 アーカイブ](#phase-0-アーカイブ)
- [CSV フォーマット早見表](#csv-フォーマット早見表)
- [アーキテクチャ（Phase 0）](#アーキテクチャphase-0)
- [レガシー（Excel VBA システム）](#レガシーexcel-vba-システム)
- [Phase 1 — FastAPI Web アプリ基盤](#phase-1--fastapi-web-アプリ基盤)
  - [技術スタック](#技術スタック)
  - [ディレクトリ構成](#ディレクトリ構成)
  - [セットアップ・起動](#セットアップ起動)
  - [よく使う Docker コマンド](#よく使う-docker-コマンド)
  - [コード変更を Docker に反映するコマンド](#コード変更を-docker-に反映するコマンド)
  - [開発モード（HMR）と 本番ビルドモードの切り替え](#開発モードhmrと-本番ビルドモードの切り替え)
  - [API 確認](#api-確認)
- [Phase 2 — シフト生成 API・エクスポート・インポート](#phase-2--シフト生成-apiエクスポートインポート)
- [将来フェーズの技術スタック（計画）](#将来フェーズの技術スタック計画)
- [Production Deploy](#production-deploy)

---

## これは何？何ができる？

### 一言で言うと

**「誰がいつ何の仕事をするか」を、ルールに従って自動で決めてくれるシステムです。**

毎月、シフト担当者が手動でエクセルに書き込んでいた作業を、コンピュータが自動でやってくれます。

### 具体的に何をしてくれるか

- 従業員14名分の1か月シフトを数分で自動生成
- 「木曜は主任をA3に入れる」「月末は主任をA2に入れる」など、複雑なルールを全部守ってくれる
- 「この日は有給」「この日は希望休」を入力しておけば、それも守ってくれる
- 「Cポジションはその日B・D・Eが全員揃っているときだけ立てる」など、条件付きのルールも自動判断
- 不公平にならないよう、社員間の出勤日数をなるべく均等にしてくれる
- ルール的に解決不能な場合は「どの制約が原因か」を教えてくれる

### 今できること・できないこと

|     | できること                                                     |
| --- | -------------------------------------------------------------- |
| ✅  | コマンドラインでCSVを渡してシフトを自動生成                    |
| ✅  | 結果をExcelファイルで出力                                      |
| ✅  | 従業員・勤務パターンなどをAPI経由で登録・編集                  |
| ✅  | データをデータベースに保存（複数月のデータが蓄積される）       |
| ✅  | 解が見つからない場合の原因制約を自動診断                       |
| ✅  | 手動調整後の代休候補日を自動提案                               |
| ✅  | **ブラウザの Web UI でログインしてシフト操作をすべて完結**     |
| ✅  | **勤務希望CSVをアップロードするだけで年月を自動検出して登録**  |
| ✅  | **シフト生成中の進捗インジケーター表示**                       |
| ✅  | **生成済みシフト一覧から削除・Excelエクスポート**              |
| ✅  | **詳細グリッドで●/○/有給/割当休日/作業パターンを表示**         |
| ✅  | **対象部門をドロップダウンで動的に選択（API から自動取得）**   |
| ✅  | **セル編集ポップオーバーで割当変更（割当休日/●/○/有給/作業パターン）** |
| ✅  | **クライアント側バッファで swap 可能・確定で一括 PATCH**       |
| ✅  | **Ctrl+Z / Ctrl+Y によるローカル undo / redo**                 |
| ✅  | **REST→WORK 時の代休候補自動提案（セル編集と同じくバッファ）** |
| ✅  | **マスタ管理画面（従業員 / 作業パターン / 日テンプレート / 選択グループ / 補助ポジション発生条件 / 優先作業パターン / ユーザー）** |
| ✅  | **ログイン reCAPTCHA v2 invisible 検証（本番環境必須）**       |
| ✅  | **管理者権限（is_admin）でユーザー CRUD 画面を保護**           |
| ✅  | **ダークモード対応**                                           |
| ✅  | **祝日マスタ（DB 永続化 + jpholiday 自動取得）と稼働表ヘッダー祝日色塗り** |
| ✅  | **月次稼働表の Excel 自動生成（部門別テンプレ → 1〜末日シート展開）** |
| ✅  | **希望休が重なって完全に埋められない月でも、出勤可能な人員だけで部分割当 + 不足セル可視化（PARTIAL ステータス）** |
| ✅  | **優先作業パターン未設定の作業をその従業員に絶対割り当てない（hard 禁止）/ マスタ不備は生成前に preflight で検出** |
| ✅  | **OR グループ（例: G早/Gフル/G週）の不足もグループ全体で 1 件として不足セルに表示** |
| ❌  | ドラッグ&ドロップによるセル swap UI（ポップオーバー + 手動選択で代替） |
| ❌  | 複数店舗・複数部門の同時管理（Phase 6 で実装予定）             |
| ❌  | AI チャットによるシフト微調整（Phase 6 で実装予定）            |

---

## 「Docker」「FastAPI」って何？（用語の説明）

このシステムを動かすには、いくつかのソフトウェアが必要です。それを一括で管理しているのが以下の仕組みです。

### Docker（ドッカー）とは

「アプリを箱に入れて、どのパソコンでも同じように動かせる仕組み」です。

このシステムは内部で複数のプログラムが同時に動いています。それらをまとめて起動・管理するのが Docker です。

```
docker compose up -d  ← この1コマンドで以下が全部起動する
```

| 起動するもの                       | 役割                                                     |
| ---------------------------------- | -------------------------------------------------------- |
| **frontend**（Web 画面）           | ブラウザで操作する画面（React + nginx）、ポート 8080（開発時は Vite dev server がポート 5273 で HMR 配信） |
| **app**（アプリ本体）              | シフト計算ロジック・API サーバー（FastAPI）。シフト生成もバックグラウンドタスクとして同一プロセス内で実行、ポート 8000 |
| **db**（データベース）             | 従業員データ・ルール設定などの保存先（PostgreSQL）       |

### FastAPI（ファストAPI）とは

「外部のプログラムやブラウザとデータをやり取りするための窓口」です。

たとえば「従業員の一覧を取得する」「新しいルールを追加する」といった操作を、HTTPリクエスト（URLへのアクセス）で行えます。将来 Web 画面を作るときに、この窓口を通してデータを取得します。

### データベース（PostgreSQL）とは

「データを永続的に保存する場所」です。

Phase 0 では CSV ファイルに書いていたデータ（従業員・作業パターン・ルールなど）を、Phase 1 からはデータベースに保存します。これにより：

- 毎月のデータが蓄積・比較できる
- 複数人が同時に操作しても壊れない
- 将来の Web 画面からも参照できる

### Alembic（アレンビック）とは

「データベースのテーブル構造を変更するときの変更履歴管理ツール」です。

Git がソースコードの変更を管理するように、Alembic はデータベースの構造変更を管理します。`alembic upgrade head` を実行すると、必要なテーブルがすべて自動作成されます。

---

## シフトを自動生成するには（毎月の手順）

システムを起動したら、ブラウザの Web UI から操作します。
コマンドは一切不要です。

> 開発者向け API の直接操作は http://localhost:8000/docs から行えます。
> CLI 版（Phase 0 PoC）は廃止済みです。Phase 0 の経緯は [こちら](#phase-0-アーカイブ) に概要を残してあります（コードは git 履歴で参照可能）。

---

### 前提：システムを起動する

```bash
docker compose up -d
```

初回のみ、データベースの初期化とマスターデータの投入を行ってください：

```bash
# 1. データベースのテーブルを作成
docker compose exec app alembic upgrade head

# 2. マスターデータを投入
docker compose exec app python -m app.scripts.seed
```

---

### ステップ 1：Web UI を開いてログインする

ブラウザで http://localhost:5273 を開きます（デフォルトの開発モードでは Vite dev server が 5273 で配信）。

> 本番ビルドモード（`docker compose -f docker-compose.yml up -d --build`）で起動した場合のみ http://localhost:8080 を使います。両モードの違いは [開発モード（HMR）と 本番ビルドモードの切り替え](#開発モードhmrと-本番ビルドモードの切り替え) を参照。

ログイン画面が表示されたら以下を入力して「ログイン」を押します：

| 項目           | デフォルト値        |
| -------------- | ------------------- |
| メールアドレス | `admin@example.com` |
| パスワード     | `password`          |

> **reCAPTCHA v2 invisible** が組み込まれています（本番環境では `RECAPTCHA_SECRET` / `VITE_RECAPTCHA_SITE_KEY` が必須）。
> 通常はユーザー操作不要で背後で検証されます。Google が画像チャレンジを要求したときのみ追加操作が必要です。
> dev 環境で `VITE_RECAPTCHA_SITE_KEY` 未設定時は検証をスキップします。

---

### ステップ 2：勤務希望 CSV を読み込む

ログイン後のシフトページで「① 勤務希望 CSV を読み込む」エリアに操作します。

**対応している CSV 形式（MonShift 形式）:**

| 列名         | 内容                             | 例         |
| ------------ | -------------------------------- | ---------- |
| `従業員番号` | 社員番号                         | `1001`   |
| `日付`       | 年/月/日 形式                    | `2026/5/1` |
| `休日区分`   | 1=希望休(●) / 2=仮休(○) / 3=有給 | `1`        |

**手順:**

1. CSV ファイルをエリアにドラッグ＆ドロップ、またはクリックして選択
2. アップロードが成功すると、対象年月が自動検出されて表示されます（例：「2026年5月」）

> 対象年月は CSV の日付列から自動検出されます。指定は不要です。
> 同年月のデータは上書きされます。複数回アップロードしても大丈夫です。

---

### ステップ 3：シフトを自動作成する

「② シフトを自動作成する」の「2026年5月 シフト自動作成」ボタンをクリックします。

- ボタンは CSV の読み込みが完了すると活性化されます
- クリックするとバックグラウンドで計算が始まり、進捗インジケーターが表示されます
- 計算は数秒〜数分かかります（規模や time_limit の設定による）

---

### ステップ 4：生成結果を確認する

計算が完了すると「生成済みシフト一覧」に結果が追加されます。

| ステータス | 意味                                                                   |
| ---------- | ---------------------------------------------------------------------- |
| 計算中     | バックグラウンドで計算中                                               |
| GENERATED  | **生成完了。クリックして詳細を確認できます**                           |
| INFEASIBLE | ルールが矛盾して解が見つからなかった（下記「うまくいかないとき」参照） |

一覧の行をクリックすると、従業員×日付のシフト詳細グリッドが開きます。

**グリッドの表示記号:**

| 記号           | 意味                       |
| -------------- | -------------------------- |
| `A1` `B2` など | 作業パターン（出勤）       |
| `●`            | 希望休                     |
| `○`            | 仮休                       |
| `有給`         | 有給休暇                   |
| `割当休日`     | システムが自動割当した休日 |

---

### ステップ 5：Excel をダウンロードする

一覧の「Excel」ボタンをクリックするとダウンロードが始まります。

ダウンロードされる Excel ファイルの書式：

- 作業パターン（A1/B2/C など）はグループごとに色分け
- 土曜は青、日曜・祝日は赤でヘッダーが色分け
- 氏名・役職列は固定されて横スクロールしても見える
- 勤務日数・休日数が自動集計

---

### うまくいかないとき

#### `status` が `DRAFT` に戻り `diagnosis` に文字が入っている場合

ルール的に矛盾があって解が見つからなかった状態です。
`diagnosis` フィールドに原因が書かれています。

よくある原因と対処法：

| 表示される原因           | 対処法                                                                                 |
| ------------------------ | -------------------------------------------------------------------------------------- |
| `H10: 有給・希望休`      | 同じ日に希望休が集中しています。勤務希望CSVを見直して重複を減らしてください            |
| `H5: 管理職毎日出勤`     | 主任・副主任が同日に休み希望を出しています。どちらかを出勤にしてください               |
| `H1: 作業パターン枠充足` | 出勤できる人数が必要人数を下回っています。勤務希望を減らすか必要人数を確認してください |

診断後は勤務希望 CSV を修正して再度ステップ 2〜4 を実施してください。

#### http://localhost:8080 に繋がらない / http://localhost:8000 が `{"detail":"Not Found"}` を返す

ポートとモードの取り違えが原因。

| URL | 用途 | 開発モード（override 有効・デフォルト） | 本番ビルドモード（`-f docker-compose.yml`） |
| --- | --- | --- | --- |
| http://localhost:5273 | Vite dev server（HMR あり） | ✅ 利用可 | ❌ 未起動 |
| http://localhost:8080 | nginx 配信（本番ビルド） | ❌ コンテナに listener 無し → `Connection reset by peer` | ✅ 利用可 |
| http://localhost:8000 | FastAPI 直叩き（API のみ） | `/` ハンドラ無しのため `{"detail":"Not Found"}` が正常応答。`/docs` `/api/v1/...` を使用 | 同左 |

- 開発中は **http://localhost:5273/login** にアクセスする
- nginx 配信を 8080 で確認したい場合は override を無効化して起動する: `docker compose -f docker-compose.yml up -d --build`
- 8000 のヘルスチェックは `curl http://localhost:8000/health`、API 一覧は http://localhost:8000/docs

#### 時間がかかりすぎる・途中で止まった場合

生成リクエスト時の `time_limit` を短くすると早く結果が出ます（精度は下がります）。

```json
{
  "department_id": 1,
  "year": 2026,
  "month": 5,
  "time_limit": 30
}
```

---

### ステップ 6：シフトを手動で調整する（編集モード）

生成結果の詳細グリッド画面で「編集モード」トグルを ON にすると、セルをクリックしてシフトを直接書き換えられます。

**操作の流れ:**

1. グリッド画面右上の「編集モード」トグルを ON（編集可能なセルは hover で青枠が出る）
2. 対象セル（従業員 × 日付）をクリック → ポップオーバーが表示される
3. ポップオーバー内のラジオから以下を選択:
   - `割当休日` / `● 希望休` / `○ 仮休` / `有給` / 各作業パターン
   - 作業パターンの行には「当日その作業パターンを割り当てられている他従業員の氏名」がグレーで表示される
4. 「反映」をクリック → セルがローカルで更新され、境界に **amber ring** が付く（未確定の印）
5. 必要なら他のセルも同様に編集（この段階ではサーバに送信されない）
6. 画面上部の **CommitBar**「確定」ボタンで全変更を一括 PATCH → ハード制約に違反しなければ保存、違反時はロールバックしてトースト表示
7. REST → WORK の変更があった場合、確定成功後に代休候補ポップオーバーが自動表示 → 候補日を選ぶと再びバッファに載る（更に「確定」で保存）

**ポップオーバーのヒント:**

- ヘッダ部分（`従業員 ID ... / 日`）をドラッグすると他セルを隠さない位置に移動できる
- Esc または外クリックで閉じる（ドラッグ中は閉じない）

**Undo / Redo:**

- 編集モード中に **Ctrl+Z / Ctrl+Y**（Mac は Cmd+Z / Cmd+Shift+Z）で未確定変更をローカルに巻き戻せる
- 「破棄」ボタンで全未確定変更を一括破棄
- ブラウザを閉じようとすると未確定時は `beforeunload` 警告が出る

**ハード制約エラー（409）:**

| コード | 発火条件                                         |
| ------ | ------------------------------------------------ |
| H8     | 同日に併用不可な作業パターンペアが発生           |
| H10    | `MANDATORY`（有給）のセルを作業パターンへ変更    |
| H11    | choice group の min / max 人数を逸脱             |
| H13    | 同日に同一作業パターングループを複数名割当       |

> 確定時は全編集を 1 トランザクションで upsert → **最終状態**に対して H8/H10/H11/H13 を検査するため、単体では違反になる中間状態（swap 等）も一括確定なら通る。

---

### CLI でのシフト生成（廃止）

> Phase 0 の CLI（`poc/poc_cli.py`）は廃止済みです。生成は Web UI（`http://localhost:5273`）から行ってください。
> Phase 0 のコード・実行例・出力フォーマットは git 履歴で参照可能です（`git log -- poc/poc_cli.py`、`git checkout <SHA> -- poc/`）。

---

## UI 文言ポリシー（ユーザー向け表示）

ユーザー（店長・主任）はソルバー実装の詳細を知らない前提で UI を作る。
**`H1`〜`H15` / `S1`〜`S5` / `CP-SAT` / `INFEASIBLE` などの開発内部用語は、Web UI の本文・見出し・ツールチップ・エラーメッセージに直接出さない。** 制約 ID ではなく、業務上の意味を日本語で書く。

例:
- ✕ 「シフト生成時のソフト制約 S3 に反映されます」 → ○ 「値が高いほど優先して割り当てられます」
- ✕ 「H10 違反」 → ○ 「希望休が集中しています」

このドキュメントや `plan.md` 内の制約 ID 一覧（後述の「要件と実装状況の対応」表）、API レスポンスの `code` フィールド、コード内コメントは開発者向けなので制約 ID を維持してよい。区別の基準は **「画面に出る文章として人間が読むかどうか」**。

---

## プロジェクト現状

| フェーズ    | 内容                                                                             | 状態      |
| ----------- | -------------------------------------------------------------------------------- | --------- |
| **Phase 0** | CLI PoC（CSV 入出力・DB なし）                                                   | ✅ 完了   |
| **Phase 1** | FastAPI + PostgreSQL + Docker Compose 基盤・マスタ CRUD                          | ✅ 完了   |
| **Phase 2** | シフト生成 API（バックグラウンドタスク非同期）・Excel エクスポート・CSV インポート・代休提案       | ✅ 完了   |
| **Phase 3** | React Web UI（CSV 読込・生成進捗・一覧・詳細グリッド・削除・Excel エクスポート・部門動的選択） | ✅ 完了   |
| **Phase 4** | 月次グリッド手動調整 UI（セル編集ポップオーバー + バッファリング + バッチ確定 + 代休提案） | ✅ 完了   |
| **Phase 4.1** | バッチ PATCH + 従業員 / 作業パターン / 優先作業パターン / 希望休マスタ管理画面 | ✅ 完了   |
| **Phase 5** | 残マスタ UI（day_templates / choice_groups / pattern_incompatibilities / pattern_triggers）+ DayOverride バグ修正 + SpecialAssignmentRule role 単位分離 | ✅ 完了   |
| **Phase 5.x** | reCAPTCHA v2 invisible / 管理者権限（is_admin）/ ユーザー CRUD / ダークモード / ログイン UI 改善 / UI 用語「稼働表」統一 | ✅ 完了   |
| **Phase 5.deploy** | Cloudflare Pages + Render + Neon + Upstash 本番デプロイ準備（bootstrap_admin / `_redirects` / preview env scope） | ✅ 完了   |
| **Phase 5.holidays** | 祝日マスタ（`Holiday` モデル + `holiday_service` 年単位 lazy fetch）/ 稼働表ヘッダー祝日色塗り / `optimizer/loader.py` も DB 経由に統合 | ✅ 完了   |
| **Phase 5.excel_monthly** | 月次稼働表 Excel 自動生成（issue #90）/ `ExcelMonthlyTemplate` 部門別テンプレ + `app/excel_monthly/` 疎結合パッケージ / 「作業割当表」雛形 → 1〜末日シート展開 + 印刷範囲 / 条件付き書式 / 改ページプレビュー継承 + VBA イベント切離し | ✅ 完了（本フォークでは過渡期モジュールとして削除済み） |
| **Phase 5.partial** | PARTIAL ステータス導入（希望休が重なって INFEASIBLE になるとき、出勤可能な人員だけで部分割当 + 不足セル可視化 / `ShiftShortageSlot` テーブル / 手動編集で不足消費 / 「シフトを確定」ボタン） | ✅ 完了 (PR #230) |
| **Phase 5.priority** | 優先作業パターン (priority) 厳格化（未設定 pattern を CP-SAT で hard 禁止 / loader preflight でマスタ不備を生成前に検出 / S3 weight を pri * 100 に scale up / choice_group OR グループの不足を ShortageRow で表示） | ✅ 完了 (PR #232) |
| **Phase 5.staffing-range** | 日テンプレ必要人数の範囲指定（`required_min` + `required_max` で n〜m 人 / H1 を範囲対応 / 選択グループ表示を「選択数」に統一） | ✅ 完了 (PR #249 / issue #247, v0.6.0) |
| Phase 6     | 多店舗・多部門同時管理 / AI チャット微調整                                       | 🔜 未着手 |

---

## 業務ドメイン概要

### 階層構造

```
店（Tenant）
└── 部門（Department）
    └── 作業パターングループ（WorkPatternGroup）
        ├── 作業パターン A
        │   ├── A1（早番 07:00〜15:30）
        │   │   └── 作業内容 1, 2, 3, …
        │   ├── A2（フル番 07:00〜20:20）
        │   │   └── 作業内容 1, 2, 3, …
        │   └── A3（遅番 07:00〜17:00）
        │       └── 作業内容 1, 2, 3, …
        ├── 作業パターン B  ── B1 / B2 / B3
        ├── 作業パターン C  ── C（補助ポジション、is_auxiliary=true）
        ├── 作業パターン D  ── D1 / D2
        ├── 作業パターン E  ── E
        ├── 作業パターン F  ── F
        └── …（G, H, I など）
```

> **Phase 0 での扱い:** 店・部門の概念は未実装。作業パターン以下を CSV で管理。
> 作業内容（タスクリスト）は未実装。

### 番型（shift_type）

| 値  | 名称   | 代表時間帯                         |
| --- | ------ | ---------------------------------- |
| 1   | 早番   | 06:00〜15:30 前後                  |
| 2   | フル番 | 07:00〜20:20（休憩込み実働約 10h） |
| 3   | 遅番   | 10:00〜20:20 前後                  |

### 役職（role）

| 値            | 説明             |
| ------------- | ---------------- |
| `CHIEF`       | 主任             |
| `DEPUTY`      | 副主任           |
| `STAFF`       | 社員・アルバイト |
| `FULLPART`    | フルタイムパート |
| `MORNINGPART` | 午前パート       |

---

## 要件と実装状況の対応

### ✅ Phase 0 で実装済み

| 要件                                                              | 実装内容                                                                          | 制約ID |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------ |
| 作業パターン・グループの登録                                      | `patterns.csv`（group_name / pattern_name）                                       | —      |
| 各作業パターンへの必要人数設定（曜日別・祝日別）                  | `day_templates.csv`（weekday: -1=全日 / 0〜6=曜日 / 7=祝日）                      | H1     |
| 作業パターン選択グループ（A2 XOR B2 XOR C など）                  | `choice_groups.csv`                                                               | H11    |
| 同日使用不可の組み合わせ（C+A2=NG, C+B2=NG など）                 | `patterns.csv` の is_auxiliary + H8 制約                                          | H8     |
| 1 人 1 日 1 アサイン（勤務か休日か）                              | XOR 制約                                                                          | H2     |
| 役職別・月間休日数（28-29日/30日/31日の 3 バケツ、`/admin/roles` で編集可）          | `Role.rest_days_28_29 / 30 / 31` → `rest_days_by_role`                            | H3     |
| 社員の月残業上限 40 時間未満                                      | overtime_limit                                                                    | H4     |
| 主任・副主任どちらかは毎日出勤                                    | manager_daily_coverage                                                            | H5     |
| 木曜は主任を A3 に、月末は主任を A2 に固定                        | `special_assignments.csv`                                                         | H6/H7  |
| 従業員ごとの出勤可能日・番型制限                                  | `available_days` / `available_shift_types`                                        | H9     |
| 有給・希望休（●希望休 / ○仮休 / 有給）                            | `leave_requests.csv` / 勤務希望 CSV                                               | H10    |
| グループ内の勤務日数公平化（max − min 最小化）                    | FAIRNESS_WEIGHT=20                                                                | S1     |
| 主任は早番多め、副主任も早番優先                                  | CHIEF=3点 / DEPUTY=2点 ボーナス                                                   | S2     |
| 作業パターンへの従業員優先割当                                    | `employee_priorities.csv`（priority 0〜10）                                       | S3     |
| 連勤の許容 / 歯抜け希望                                           | `consecutive_workable`（1=連勤可能・上限6 / 0=連勤NG=歯抜け）                     | S4/S5/H15 |
| CSV 入出力（月次シフト表・日別集計）                              | `export_shift()` / `export_daily_summary()`                                       | —      |
| Excel 出力（作業パターン色分け・土日祝カラー）                    | `export_shift_xlsx()`                                                             | —      |
| 祝日自動認識（jpholiday）                                         | `_get_holidays()`・weekday=7 テンプレート対応                                     | —      |
| C グループの発生条件（B・D・E 全員出勤時のみ C 発生）             | H12: `PatternTrigger` + `pattern_triggers.csv` で CP-SAT の条件付き制約として実装 | H12    |
| 各作業パターングループは 1 日 1 名まで（A1=3 など複数名配置禁止） | H13: グループ内の全パターン合計 ≤ 1 の上限制約                                    | H13    |
| 入力 CSV バリデーション                                           | `validation.py`（ValidationError）                                                | —      |
| INFEASIBLE 診断（原因制約の特定＋詳細）                           | `diagnose_infeasible()`（従業員・日付レベルで詳細表示）                           | —      |

### ⚠️ Phase 0 で部分実装（仕様と差異あり）

| 要件                                   | 現状の実装                             | 差異・メモ                                                                                |
| -------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------- |
| フル番（shift_type=2）の割当日数公平化 | S1: グループ内の**総勤務日数**の公平化 | フル番に特化した公平化ではなくグループ全体の勤務日数を均等化。フル番特化は Phase 1 で検討 |

### ❌ 未実装（将来フェーズ）

| 要件                                       | 未実装の理由                   | 対応フェーズ |
| ------------------------------------------ | ------------------------------ | ------------ |
| 店・部門の上位階層（マルチテナント）       | DB・API が必要                 | Phase 6      |
| 各作業パターン内の作業内容（タスクリスト） | 本フェーズのシフト生成には不要 | Phase 6      |
| AIチャットによる微調整                     | Claude API 統合                | Phase 6      |

> Phase 4 / 5 / 5.x で完了した項目（手動調整 UI / 残マスタ UI / reCAPTCHA / 管理者権限）は「フェーズ別実装履歴」を参照。

---

## 仕様詳細：C グループの発生ロジック

```
通常日（非木曜）:
  - B, D, E が全員出勤 → C が発生、A は A1 のみ、B は B1 のみ（A2・B2 は登場しない）
  - B, D, E が揃わない → C は登場せず、A2 または B2 のいずれか 1 つが登場

木曜日:
  - C が必ず発生（day_templates.csv: weekday=3, C=1）
  - H12 トリガーにより B・D・E も必発
  - A3 が必ず発生（主任固定、H6）
  - A3 が出ているので A1・A2 は登場しない（H13: グループ A は 1 日 1 名まで）
```

- H12（PatternTrigger）: 「B・D・E 全員出勤時のみ C 発生」を CP-SAT 制約として実装済み
- 木曜の C 必発は `day_templates.csv` の `weekday=3,pattern_id=7,required_min=1` で設定

---

## Phase 0 アーカイブ

> Phase 0 は CLI ベースの CP-SAT PoC（OR-Tools + CSV 入出力、DB なし、Python 3.13）でした。
> 本番アプリへの統合に伴い `poc/` ディレクトリは削除済みです。

| 旧位置 | 現在 | 備考 |
|---|---|---|
| `poc/model.py` | `app/optimizer/cp_sat_model.py` | CP-SAT エンジン本体（中身は不変） |
| `poc/data/*.csv` (7 ファイル) | `app/scripts/seed_data/` | 初期シードデータ |
| `poc/poc_cli.py` | （廃止） | CLI エントリは Web UI に置き換え |
| `poc/csv_io.py` | （廃止） | エクスポート系は `app/services/export_service.py` に移植 |
| `poc/validation.py` | （廃止） | バリデーションは Pydantic スキーマ + サービス層へ |
| `poc/tests/` | （廃止） | 制約テストは `app/tests/test_optimizer_*.py` でカバー |

廃止ファイルのコード・当時のディレクトリ構成・CLI 実行例は git 履歴で参照可能です。

```bash
git log -- poc/                      # poc/ 配下の全変更履歴
git checkout <SHA> -- poc/csv_io.py  # 必要に応じて単一ファイルを復元
```

設計詳細は `plan_detail.md` の Phase 0 セクション（同じく git 履歴参照）を参照してください。

---

## CSV フォーマット早見表

### `employees.csv`

```csv
employee_number,name,role,available_days,available_shift_types,consecutive_workable
1001,山田太郎,CHIEF,0123456,12,1
```

- `available_days`: 曜日番号を連結（0=月〜6=日）。全員 `0123456`。曜日制御は leave_requests で行う
- `available_shift_types`: 番型番号を連結（1=早 2=フル 3=遅）
- `consecutive_workable`: 1=連勤可能（上限 6 連勤・凸ペナルティ） / 0=連勤NG（歯抜け選好・線形ペナルティ）

### `patterns.csv`

```csv
id,group_name,pattern_name,shift_type,shift_start,shift_end,is_auxiliary
3,A,A3,1,07:00,17:00,0
7,C,C,3,10:00,20:20,1
```

- `is_auxiliary=1`: 補助ポジション（C グループなど）

### `day_templates.csv`

```csv
weekday,pattern_id,required_min,required_max
-1,1,1,
0,2,1,2
7,3,0,
```

- `weekday=-1`: 全曜日に適用（曜日指定が優先）
- `weekday=7`: 祝日（優先順位: 祝日 > 曜日 > 全日）
- `required_min`: 最小必要人数
- `required_max`: 最大必要人数（任意）。空欄なら「ちょうど `required_min` 人」（厳格）、値があれば `required_min`〜`required_max` の範囲（issue #247）
- 単一パターンのグループ（E/F/H/I）のみ記載。複数パターンのグループは `choice_groups.csv` で管理

### `choice_groups.csv`

```csv
pattern_ids,min_count,max_count
2;5;7,1,1
```

- `2;5;7`: A2(2) / B2(5) / C(7) のうち 1 日に必ずどれか 1 つ

### `special_assignments.csv`

```csv
condition_type,condition_value,role,pattern_name
WEEKDAY,3,CHIEF,A3
LAST_DAY,0,CHIEF,A2
```

- `condition_type`: `WEEKDAY`（曜日指定）/ `LAST_DAY`（月末）
- 対象役職が有給の場合は DEPUTY にフォールバック

---

## アーキテクチャ（Phase 0）

```
CSV ファイル群
  → csv_io.py: build_input()
      ├── validation.py: 各 CSV のバリデーション（ValidationError）
      └── ShiftModelInput（dataclass）
          → model.py: ShiftModelBuilder.build_and_solve()
              ├── ハード制約 H1〜H14（充足必須）
              └── ソフト制約 S1〜S5（目的関数、最大化）
          → CP-SAT ソルバー
          → extract_result()
  → csv_io.py: export_shift() / export_shift_xlsx() / export_daily_summary()
  → 出力 CSV / xlsx
```

### ハード制約（H1〜H15）

| ID  | 内容                                                                      |
| --- | ------------------------------------------------------------------------- |
| H1  | 作業パターン枠の必要人数充足                                              |
| H2  | 1人1日1アサイン（勤務 XOR 休日）                                          |
| H3  | 役職別の月間休日数（下限 hard / 上限 +2 hard、partial fallback で上限 soft） |
| H4  | 残業上限（CHIEF / DEPUTY / STAFF のみ）                                   |
| H5  | 管理職（CHIEF / DEPUTY）の毎日出勤保証                                    |
| H6  | 木曜は主任を A3 に固定                                                    |
| H7  | 月末最終日は主任を A2 に固定                                              |
| H8  | 作業パターン非両立制約（同日使用不可ペア）                                |
| H9  | 従業員の出勤可能曜日・番型の制限                                          |
| H10 | 有給・希望休（強制 REST）                                                 |
| H11 | PatternChoiceGroup（日次の作業パターン使用数の min/max）                  |
| H12 | PatternTrigger（補助ポジション発生条件: C は B+D+E 全員出勤時のみ使用可） |
| H13 | 各作業パターングループは 1 日に最大 1 名まで（複数名配置禁止）            |
| H14 | 休日前フル番禁止（翌日が ●/○/有給/割当休日 の前日に shift_type=2 を割当不可。祝日・週末・月末日は対象外） |
| H15 | `consecutive_workable=True` 従業員の最大連勤数 6（任意の 7 日窓内に最低 1 休を強制） |

### ソフト制約（目的関数・最大化）

| ID  | 内容                                                                | 重み               |
| --- | ------------------------------------------------------------------- | ------------------ |
| S1  | 同 role グループ内の勤務日数公平化（max − min 最小化）              | 20                 |
| S2  | 主任・副主任の早番（shift_type=1）優先割当                          | CHIEF=3 / DEPUTY=2 |
| S3  | employee_priorities に基づく優先作業パターンへの割当最大化          | priority 値        |
| S4  | `consecutive_workable=True`: 連勤窓 (k=3..6) に凸ペナルティ −(k−2)² | k=3:−1 / k=4:−4 / k=5:−9 / k=6:−16 |
| S5  | `consecutive_workable=False`: 連続勤務ペアにペナルティ              | −2                 |

---

## レガシー（Excel VBA システム）

本システムは、Excel VBA (.xlsm) による手動シフト管理からの移行を想定して設計された。
移行元の VBA モジュール一式（実データを含む）は本フォーク（ポートフォリオ用デモ）では削除している。

---

## Phase 1 — FastAPI Web アプリ基盤

### 技術スタック

| 層               | 技術                                 |
| ---------------- | ------------------------------------ |
| Backend API      | FastAPI + uvicorn                    |
| DB               | SQLAlchemy 2.0 async + PostgreSQL 16 |
| マイグレーション | Alembic                              |
| 認証             | JWT（python-jose） + bcrypt          |
| インフラ         | Docker Compose（app + db）            |

### ディレクトリ構成

```
app/
├── main.py                  # FastAPI エントリーポイント
├── core/
│   ├── config.py            # pydantic-settings（.env 読み込み）
│   ├── database.py          # 非同期 SQLAlchemy エンジン・セッション
│   └── security.py          # JWT / bcrypt
├── models/                  # SQLAlchemy ORM モデル（15テーブル）
├── schemas/                 # Pydantic v2 スキーマ
├── api/
│   ├── deps.py              # get_db, get_current_user
│   └── routers/             # CRUD エンドポイント
│       ├── auth.py
│       ├── employees.py
│       ├── work_patterns.py
│       ├── day_templates.py
│       ├── choice_groups.py
│       ├── pattern_rules.py
│       └── leave_requests.py
├── migrations/              # Alembic マイグレーション
│   └── versions/
│       └── 0001_initial_schema.py
└── scripts/
    ├── seed.py              # app/scripts/seed_data/ CSV → DB 初期投入
    └── seed_data/           # 初期シード CSV (7 ファイル)
```

### セットアップ・起動

```bash
# 1. 起動（初回は DB ヘルスチェック後に app が起動する）
docker compose up -d

# 2. マイグレーション実行
docker compose exec app alembic upgrade head

# 3. シードデータ投入（app/scripts/seed_data/ CSV → DB）
docker compose exec app python -m app.scripts.seed
```

### よく使う Docker コマンド

システムの起動や停止など、日常開発でよく使うコマンドです。

```bash
# 全てのコンテナを起動（バックグラウンドで実行）
docker compose up -d

# 全てのコンテナを停止
docker compose stop

# コンテナを再起動（ソースを変更して手動で再起動したい場合など）
docker compose restart app

# コンテナを停止し、ネットワークなども削除（完全に終了・リセットしたい時）
docker compose down

# 全体のログをリアルタイムで確認する（終了は Ctrl+C）
docker compose logs -f

# app コンテナ（API サーバー）のログのみを確認する
docker compose logs -f app

# app コンテナの中に入ってコマンドを実行する
docker compose exec app bash

# 再ビルド
docker compose up --build
```

### コード変更を Docker に反映するコマンド

開発モード（`docker compose up -d` で起動 = override 適用）での反映ルール。
**変更したファイル / 種別ごとに必要な操作が異なる**。

| 変更したもの | 必要な操作 | 理由 |
| --- | --- | --- |
| `frontend/src/**` | **不要**（自動反映） | Vite HMR がファイルを監視。ブラウザで `[vite] hot updated` ログを確認 |
| `app/api/`, `app/services/`, `app/optimizer/` 等の Python コード | **不要**（自動反映） | `app` コンテナは `uvicorn --reload` で起動。保存で再読込 |
| `app/tasks/**`（バックグラウンド生成タスク） | **不要**（自動反映） | `app` コンテナ内で `uvicorn --reload` により実行、専用プロセスは無い |
| `app/models/**`（SQLAlchemy モデル） | 1) Alembic でマイグレーション作成 → 2) `docker compose exec app alembic upgrade head` | DB スキーマ反映が必要 |
| 既存マイグレーション追加（`app/migrations/versions/*.py`） | `docker compose exec app alembic upgrade head` | DB に DDL 適用 |
| `requirements`/`pyproject.toml` 等の依存追加 | `docker compose up -d --build app` | パッケージ取り込みのため再ビルド |
| `frontend/package.json` の依存追加 | `docker compose up -d --build frontend` | `node_modules` 再構築 |
| `Dockerfile*` / `docker-compose*.yml` | `docker compose up -d --build` | イメージ・サービス定義変更のため再ビルド |
| 環境変数（`.env`） | `docker compose up -d`（再作成） or `docker compose restart` | プロセスへの env 注入は再起動時 |

> 反映できているか不安なときは `docker compose logs -f app` でログを見ながら再保存すると確認しやすい。
> 完全リセットしたい場合は `docker compose down` → `docker compose up -d --build`。

### 開発モード（HMR）と 本番ビルドモードの切り替え

frontend は2つのモードで起動できる。`docker-compose.override.yml` が読み込まれるかで分岐する。

| モード | 入口 URL | 配信元 | HMR | 用途 |
| --- | --- | --- | --- | --- |
| **開発モード**（デフォルト） | http://localhost:5273 | Vite dev server | ✅ あり | コード書きながらの即時反映 |
| **本番ビルドモード** | http://localhost:8080 | nginx + `dist/` | ❌ なし | 本番イメージの最終確認 |

#### 開発モード（HMR）で起動

```bash
docker compose up -d --build frontend     # 初回 / Dockerfile.dev 変更時
docker compose up -d                      # 2回目以降は --build 不要
```

- ブラウザ: http://localhost:5273
- `frontend/src/` を保存 → 即時反映、DevTools コンソールに `[vite] hot updated`
- ソースは `./frontend` を bind mount、`node_modules` はコンテナ内を保持
- API/auth は Vite proxy 経由で `http://app:8000` に転送（`VITE_API_PROXY_TARGET` 環境変数で上書き可）
- ファイル監視は polling（Docker Desktop での変更検知のため）

#### 本番ビルドモードで起動（nginx 配信）

override を無効化するため `-f docker-compose.yml` を明示する：

```bash
docker compose -f docker-compose.yml up -d --build      # 全サービス起動（必須）
```

- ブラウザ: http://localhost:8080
- 5273 は閉じる。HMR は効かない
- ソース変更を反映したい場合は再度 `--build` 必要

> ⚠️ `frontend` 単体起動 (`up -d frontend`) は不可。`app` 未起動で API プロキシが 502 になる。必ず全サービスを起動する。

#### モード切替時の注意

- `--build` を忘れるとイメージがキャッシュされた前モードのまま。**切り替え時は必ず `--build`** を付ける
- 完全リセットしたいときは `docker compose down` してから起動
- 開発モードに戻すコマンド: `docker compose up -d --build frontend`

### API 確認

```bash
# Swagger UI（全エンドポイント一覧）
open http://localhost:8000/docs

# ログイン（JWT取得）
curl -X POST http://localhost:8000/auth/login \
  -d "username=admin@example.com&password=password" \
  -H "Content-Type: application/x-www-form-urlencoded"
# → {"access_token": "eyJ...", "token_type": "bearer"}

# 従業員一覧
TOKEN=<上記のaccess_token>
curl -H "Authorization: Bearer $TOKEN" http://localhost:8000/api/v1/employees

# ヘルスチェック
curl http://localhost:8000/health
```

### 主要エンドポイント

| リソース                  | エンドポイント                                                        |
| ------------------------- | --------------------------------------------------------------------- |
| 認証                      | `POST /auth/login`                                                    |
| 従業員                    | `GET/POST /api/v1/employees`, `GET/PUT/DELETE /api/v1/employees/{id}` |
| 作業パターングループ      | `GET/POST /api/v1/work-pattern-groups`, `GET/PUT/DELETE /{id}`        |
| 作業パターン              | `GET/POST /api/v1/work-patterns`, `GET/PUT/DELETE /{id}`              |
| 曜日別テンプレート        | `GET/POST /api/v1/day-templates`, `GET/PUT/DELETE /{id}`              |
| 日別オーバーライド        | `GET/POST /api/v1/day-overrides`, `GET/PUT/DELETE /{id}`              |
| 選択グループ              | `GET/POST /api/v1/choice-groups`, `GET/PUT/DELETE /{id}`              |
| 非両立ルール              | `GET/POST /api/v1/pattern-incompatibilities`, `DELETE /{id}`          |
| パターントリガー          | `GET/POST /api/v1/pattern-triggers`, `GET/DELETE /{id}`               |
| 特別割当ルール            | `GET/POST /api/v1/special-assignment-rules`, `GET/PUT/DELETE /{id}`   |
| 希望休申請                | `GET/POST /api/v1/leave-requests`, `GET/PUT/DELETE /{id}`             |
| **部門一覧**              | **`GET /api/v1/departments`**                                         |
| **シフト生成**            | **`POST /api/v1/schedules/generate`**                                 |
| **シフト状態確認**        | **`GET /api/v1/schedules/{id}`**                                      |
| **Excelエクスポート**     | **`GET /api/v1/schedules/{id}/export`**                               |
| **代休提案**              | **`POST /api/v1/schedules/{id}/compensatory`**                        |
| **勤務希望CSVインポート** | **`POST /api/v1/imports/roster`**                                     |
| **シフト割当 一括 PATCH** | **`PATCH /api/v1/schedules/{id}/assignments/batch`**                  |
| **優先作業パターン**      | **`GET/POST/PUT/DELETE /api/v1/employee-priorities`**                 |
| **ユーザー管理（管理者専用）** | **`GET/POST/PUT/DELETE /api/v1/users`**                          |
| **祝日マスタ（読取専用）** | **`GET /api/v1/holidays?year=&month=`**（年単位 lazy fetch + DB 永続化） |
| **月次 Excel テンプレ**   | **`GET/PUT /api/v1/excel-monthly/template`, `GET /api/v1/excel-monthly/template/download`** |
| **月次 Excel 生成**       | **`POST /api/v1/excel-monthly/generate/{schedule_id}`**（同期 / xlsm を返す） |

### デフォルトシードデータ

| 項目                 | 内容                                                          |
| -------------------- | ------------------------------------------------------------- |
| 部門                 | 鮮魚部門                                                      |
| 従業員               | 14名（CHIEF 1・DEPUTY 1・STAFF 2・FULLPART 4・MORNINGPART 6） |
| 作業パターングループ | 9グループ（A〜I）                                             |
| 作業パターン         | 15件（A1/A2/A3, B1/B2/B3, C, D1/D2, E, F, G1/G2, H, I）       |
| 管理者ユーザー       | `admin@example.com` / `password`（is_admin=true）             |

> 本番 DB には `seed.py` を投入しないこと。本番管理者は `python -m app.scripts.bootstrap_admin` を介して env (`ADMIN_EMAIL` / `ADMIN_PASSWORD`) から作成する。

---

## Phase 2 — シフト生成 API・エクスポート・インポート

### 追加された機能

| 機能                    | 内容                                                                                     |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| シフト生成 API          | `POST /api/v1/schedules/generate` → バックグラウンドタスクとして起動、CP-SAT 実行     |
| INFEASIBLE 診断         | 解なし時に原因制約グループを自動特定して `diagnosis` フィールドに保存                    |
| Excel エクスポート      | `GET /api/v1/schedules/{id}/export` → 色付き書式・ウィンドウ枠固定の xlsx をダウンロード |
| 勤務希望 CSV インポート | `POST /api/v1/imports/roster` → MonShift 形式 CSV → LeaveRequest 一括登録                |
| 代休提案                | `POST /api/v1/schedules/{id}/compensatory` → 手動調整後の代休候補日（最大3件）を返す     |

### 追加された技術スタック

| 層             | 技術                                                                            |
| -------------- | ------------------------------------------------------------------------------- |
| 非同期タスク   | FastAPI プロセス内 `asyncio` タスク（`asyncio.to_thread` で CP-SAT を非ブロッキング実行・冪等性保証）|
| 最適化エンジン | **OR-Tools CP-SAT**（`app/optimizer/cp_sat_model.py` を DB アダプター経由で呼び出し） |
| Excel 出力     | **openpyxl**（色付き書式・ウィンドウ枠固定）                                    |
| 祝日判定       | **jpholiday**                                                                   |

### ディレクトリ構成（追加分）

```
app/
├── optimizer/
│   ├── loader.py        # DB → ShiftModelInput 変換（全マスタを async で取得）
│   └── adapter.py       # solver 呼び出し → ShiftAssignment[] 変換
├── tasks/
│   └── shift_tasks.py   # generate_shift タスク（冪等・INFEASIBLE 診断組み込み、FastAPI プロセス内で実行）
├── services/
│   ├── schedule_service.py      # 生成キュー投入・一覧取得
│   ├── export_service.py        # xlsx 生成
│   ├── import_service.py        # CSV パース・LeaveRequest 登録
│   └── compensatory_service.py  # 代休候補日スコアリング
└── api/routers/
    ├── schedules.py     # generate / status / export / compensatory
    └── imports.py       # roster CSV インポート
```

### シフト生成のフロー

```
POST /api/v1/schedules/generate
  ↓ ShiftSchedule レコード作成（status=DRAFT）
  ↓ asyncio.create_task で generate_shift をバックグラウンド起動
  ↓ [バックグラウンド]
      → loader.py: DB から ShiftModelInput を組み立て
      → adapter.py: CP-SAT ソルバー実行
      → FEASIBLE/OPTIMAL → ShiftAssignment を DB に保存 → status=GENERATED
      → INFEASIBLE      → diagnose_infeasible() 実行 → status=DRAFT + diagnosis に原因を記録
  ↓ GET /api/v1/schedules/{id} でポーリング（status が GENERATED になるまで）
  ↓ GET /api/v1/schedules/{id}/export で xlsx ダウンロード
```

### テスト

```bash
docker compose exec app python3 -m pytest app/tests/ -v
# → 59 tests passed
```

---

## 将来フェーズの技術スタック（計画）

| 層        | 採用予定技術                                                                |
| --------- | --------------------------------------------------------------------------- |
| AI 微調整 | Claude API（チャット形式のシフト調整）                                      |

インフラは下記「Production Deploy」の構成を採用済み（当初計画の DigitalOcean 案からは変更）。

> Frontend は Phase 3〜4 で React 18 + Vite + TypeScript + Tailwind + Zustand を採用済み（月次グリッド・手動調整 UI・バッファリング確定・代休提案を実装）。当初計画の Vue 3 からの変更は確定。

---

## Production Deploy

このポートフォリオデモは **全て無料枠** で動いている。

### 採用構成

| 層 | ホスト | プラン |
|---|---|---|
| Frontend (React+Vite SPA) | **Cloudflare Pages** | Free（スリープなし） |
| Backend (FastAPI) | **Render Web Service** (Docker, 単一サービス) | Free（15分無操作でスリープ、復帰30〜60秒） |
| Postgres | **Supabase** (ap-northeast-1) | Free |

Redis・ARQ ワーカーは使わない。稼働表生成は FastAPI プロセス内の `asyncio` バックグラウンドタスクとして実行する（詳細は上の「非同期タスク」参照）。Render 無料枠に Background Worker の枠が無いための構成でもあり、単一サービスで完結するぶんデプロイもシンプルになる。

フロントエンドとバックエンドは別オリジンになる（Cloudflare Pages は外部オリジンへの200プロキシに非対応のため）。ビルド時に `VITE_API_URL` でバックエンドの絶対URLを埋め込み、バックエンド側は `CORS_ALLOWED_ORIGINS` でフロントのオリジンを許可する。

### Supabase 接続の注意点

Supabase の Postgres には「直結（5432）」「Session Pooler（5432）」「Transaction Pooler（6543）」の3種類の接続方法がある。Render の Web Service は永続プロセスなので **Session Pooler** を使う。

Transaction Pooler（pgBouncer transaction mode）配下で asyncpg のデフォルト（prepared statement キャッシュ有効）を使うと `prepared statement "..." does not exist` エラーが出る。本リポジトリでは `app/core/database.py` の `PGBOUNCER_CONNECT_ARGS`（`statement_cache_size=0`）を全ての `create_async_engine` 呼び出しに適用済みなので、Transaction Pooler でも動く。

```
# 接続文字列の形（DATABASE_URL、asyncpg ドライバ用に +asyncpg を付ける）
postgresql+asyncpg://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
```

### デプロイ手順

#### 1. Supabase プロジェクト作成

```bash
supabase login
supabase projects create <name> --org-id <org-id> --region ap-northeast-1 --db-password <password>
```

Session Pooler の接続文字列（上記の形）を控えておく。

#### 2. Render Web Service 作成

無料プランには Pre-Deploy Command が無いため、マイグレーション + 管理者upsertは `render-start.sh`（`dockerCommand` から起動、コンテナ起動のたびに実行・冪等）で行う。

```bash
render login
render services create \
  --name <name> --type web_service \
  --repo https://github.com/<owner>/<repo> --branch main \
  --runtime docker --plan free --region singapore \
  --health-check-path /health --output json --confirm
```

`render services create` / `update` の CLI には `dockerCommand` を設定するフラグが無いため、Render API を直接叩く（`~/.render/cli.yaml` の `api.key` が使える）:

```bash
curl -X PATCH "https://api.render.com/v1/services/<service-id>" \
  -H "Authorization: Bearer <api-key>" -H "Content-Type: application/json" \
  -d '{"serviceDetails":{"envSpecificDetails":{"dockerCommand":"/app/render-start.sh"}}}'
```

環境変数（同じく `PUT /v1/services/<service-id>/env-vars`、または Dashboard の Environment タブ）:

```
DATABASE_URL=<Supabase Session Pooler の接続文字列>
SECRET_KEY=<python -c "import secrets; print(secrets.token_urlsafe(48))" で生成>
RECAPTCHA_SECRET=            # 空 = デモではreCAPTCHA無効（コードは実装済み・本番運用時は設定を推奨）
CORS_ALLOWED_ORIGINS=<Cloudflare Pages の URL>
DEMO_MODE=true               # デモデータ初期化APIを有効化
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=<強パスワード>
```

Render 側の URL（`https://<name>.onrender.com`）が確定する。これを Phase 3 の `VITE_API_URL` に使う。

#### 3. 初回データ投入

`render-start.sh` は管理者ユーザーの upsert（`bootstrap_admin`）のみ行う。デモの部門・従業員・作業パターンは別途 `seed.py` を一度だけ実行する（`admin@example.com` は既に存在するため上書きせずスキップされる）。

```bash
render ssh <service-id>
# コンテナ内で:
python -m app.scripts.seed
```

以降のデータ初期化はアプリの管理画面（ユーザー管理ページ）にある「デモデータを初期化」ボタン（`POST /api/v1/demo/reset`、`DEMO_MODE=true` かつ管理者のみ）から行える。

#### 4. Cloudflare Pages デプロイ

```bash
wrangler login
wrangler pages project create <name> --production-branch main

cd frontend
VITE_API_URL=https://<render-service>.onrender.com \
VITE_DEMO_EMAIL=admin@example.com \
VITE_DEMO_PASSWORD=<ADMIN_PASSWORD と同じ値> \
  npm run build
wrangler pages deploy dist --project-name <name> --branch main
```

`VITE_API_URL` / `VITE_DEMO_EMAIL` / `VITE_DEMO_PASSWORD` はいずれも Vite のビルド時に静的に埋め込まれる値なので、値を変えた場合は再ビルド＋再デプロイが必要（Cloudflare Pages ダッシュボードで Git 連携している場合はビルド環境変数として設定する）。`VITE_DEMO_EMAIL`/`VITE_DEMO_PASSWORD` は両方設定するとログイン画面にデモアカウント案内バナーが出る（任意、ポートフォリオ公開時のみ推奨）。

### 動作確認

1. `https://<project>.pages.dev/login` で `ADMIN_EMAIL` / `ADMIN_PASSWORD` を使ってログイン。
2. `/shift` で月を選び「稼働表自動作成」→ バックグラウンドで生成が進み、完了すると一覧に GENERATED（または INFEASIBLE 診断つきで PARTIAL）が表示される。
3. マスタ画面（従業員 / 作業パターン / 日テンプレート / 選択グループ）で CRUD が通ることを確認。
4. ユーザー管理ページの「デモデータを初期化」でリセットできることを確認。

### 休止対策

- Render 無料 Web Service は15分無操作でスリープする（初回アクセスに30〜60秒）。
- Supabase 無料プロジェクトは約7日間無操作で一時停止する。**訪問者側では復帰できず、プロジェクトオーナーが Supabase ダッシュボードから再開する必要がある**。長期間アクセスが無い場合は定期的にダッシュボードを確認するか、軽量な定期pingを設定すること。

### ロールバック

- Cloudflare Pages: ダッシュボードの Deployments 一覧から前バージョンへ Rollback ボタン 1 クリック。
- Render: Deploys タブから rollback、または `render deploys create <service-id>` で特定コミットを再デプロイ。

### マイグレーション履歴について

`app/migrations/versions/` は本フォークで新規に構築したデータベースを前提としている（旧 0001〜0010 を統合した `0001_initial_schema_squashed.py` が起点）。
新規環境では `alembic upgrade head` を実行するだけでよい。
