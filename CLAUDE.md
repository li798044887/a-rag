# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## リポジトリ規約（補足・重要）

- **コミットメッセージとコード内コメントは日本語**で書く。UI 文言の既定言語は日本語（ja）。
- 既存の日本語コメントは翻訳しない。i18n 作業でもコメントは触らず、ユーザー可視文字列のみ置換する。
- **改変版 Next.js 16** を使用。API・規約・ファイル構成が学習データと異なる可能性があるため、コードを書く前に `node_modules/next/dist/docs/` の該当ガイドを読む。

## アーキテクチャ（全体像）

2 つのサービス + インフラで構成される。

- **web（`src/`）** — Next.js 16 App Router / React 19 / TypeScript / Tailwind v4。ユーザー認証・チャット UI・エージェント統括・永続化（users/threads/messages/citations）を担う。
- **rag（`rag/`）** — Python / FastAPI。検索・埋め込み（BGE-M3）・リランク（bge）・パース（MinerU/テキスト）・チャンク化のみを担う。**LLM による回答生成は行わない**。
- **インフラ（`docker-compose.yml`）** — Postgres / Qdrant / Redis、および rag API・rag-worker（arq ジョブワーカー）。

### エージェント統括は TS 側にある（重要）

回答生成のループは Python ではなく **`src/lib/agent/run.ts`** にある。AI SDK の `streamText` に `retrieve` / `fetch_document` ツールを渡し `stopWhen` でステップループし、`fullStream` のパーツと retrieve のサブステージを `StepBus` で統合して `AgentEvent` として stream する。引用番号は `CitationRegistry` で一元管理。ツールは `src/lib/rag-client.ts`（`/retrieve`・`/retrieve/stream`・`/documents/:id/chunks`）経由で **Python rag を内部 HTTP 呼び出し**する（`RAG_SERVICE_URL` + `RAG_INTERNAL_TOKEN`）。

- システムプロンプト等は `src/lib/agent/prompts.ts` の `getAgentPrompts(locale)` に言語別で集約。`buildSystemPrompt(cfg, locale)`（`src/lib/agent/config.ts`）が**設定駆動 × 言語別**に組み立てる。中国語プロンプトは機械翻訳ではなく RAG 専門家視点で最適化済み。
- chat ルート `src/app/api/chat/route.ts` が `getLocale()` と `clampAgentCfg()` を解決して `runAgent` に渡す。

### 1 つの Postgres に 2 つの所有領域

- **web 所有**: `users` / `threads` / `messages` / `citations` — Drizzle ORM（`src/lib/db/`）。マイグレーションは `drizzle/`（drizzle-kit）。接続は node-postgres 形式。
- **rag 所有**: `documents` / `chunks` / `ingest_jobs` — Alembic（`rag/alembic/`）。接続は psycopg3 形式。
- 互いの領域をまたいで管理しないこと。スキーマ変更はそれぞれのマイグレーション系で行う。

### 取り込み（ingestion）フロー

アップロード（web `/api/upload` → rag）→ `ingest_jobs` を Redis キューへ → **rag-worker** が MinerU/テキストでパース → チャンク化 → BGE-M3 で埋め込み → Qdrant 登録。worker が起動していないと索引化は進まない。

### 認証 / i18n

- 認証: JWT（`jose`）を Cookie に保持。`src/lib/auth.ts` の `getSessionClaims()` が署名・失効を検証。ミドルウェア `src/proxy.ts` が `/api/chat`・`/api/upload` を保護。
- i18n: `src/i18n/`。既定 zh + ja。辞書は `locales/{zh,ja}/<namespace>.ts` に機能別分割、**zh が唯一の出所**で ja は型注釈 + ランタイム parity テストでキー対等を強制。言語はサーバ側 `getLocale()`（`users.locale`（DB 永続）→ Cookie → 既定）で解決し、切替時はページをリロードして SSR 文言と prompt を一致させる。言語設定は `/api/account/locale` で `users.locale` に永続化（Cookie は SSR 用キャッシュ）。

### フロントエンド

エントリは `src/app/page.tsx` → `Workspace`（クライアント）。Tailwind v4 のトークンは `src/app/globals.css` の `@theme inline` で定義。CJK の太さムラ対策として `--font-cjk`（PingFang SC 等、簡体を網羅）を `--font-sans`/`--font-mono` に挿入している。コンポーネントは Storybook（`*.stories.tsx`、MSW でモック）でカタログ化。

## コマンド

### 初回起動（フルスタック必須）

ログイン・アップロード・索引化まで動かすには rag スタックが要る。

```bash
cp .env.example .env.local   # ARAG_JWT_SECRET, ANTHROPIC_API_KEY を設定
docker compose --profile worker up -d                 # インフラ + rag API + rag-worker
docker compose exec -T rag uv run alembic upgrade head # rag 側マイグレーション
pnpm install
pnpm drizzle-kit migrate                              # web 側マイグレーション
pnpm dev                                              # http://localhost:3000
```

`docker-compose.override.yml` によりホスト側 Postgres は **5433**。`.env.local` の `DATABASE_URL` は `postgres://arag:arag@localhost:5433/arag` にする。

### 開発・検証

```bash
pnpm build        # 本番ビルド（E2E 前の必須ゲート）
pnpm lint         # ESLint
pnpm test         # vitest 単体テスト（プロジェクト unit）
pnpm test <path>  # 単一ファイルのみ実行（例: pnpm test src/i18n/dictionary.test.ts）
pnpm test:storybook   # Storybook テスト（先に `pnpm exec playwright install` が必要）
pnpm e2e          # Playwright E2E
pnpm exec tsc --noEmit   # 型チェック
```

- **`pnpm test run` としないこと**。`test` スクリプトは既に `run` を含むため、`run` は「実行モード」ではなく**名前フィルタ**として解釈され `run*.test.ts` だけが走る。全件は `pnpm test`、単一は `pnpm test <path>`。

### DB マイグレーション

```bash
# web（Drizzle）: スキーマ src/lib/db/schema.ts を変更後
pnpm drizzle-kit generate                                  # 差分から SQL を生成（オフライン可）
DATABASE_URL=postgres://arag:arag@localhost:5433/arag pnpm drizzle-kit migrate   # 適用
# ※ drizzle.config.ts の既定は 5432。ホストから流す時は 5433 の DATABASE_URL を明示する。

# rag（Alembic）
docker compose exec -T rag uv run alembic upgrade head
```

### 横断共有への移行リセット（既存データ破棄）

コンテンツアドレス方式（`contents`/`documents` 分離）へ移行する際は、既存の重複データを
移行せず破棄する。マイグレーション適用に加えて Qdrant と原本ストレージもクリアする。

```bash
docker compose exec -T rag uv run alembic upgrade head   # 旧 documents/chunks/ingest_jobs を破棄し再構築
# Qdrant コレクション削除（worker が次回 ensure_collection で payload index 付き再作成）
docker compose exec -T rag python -c "from app.vectorstore.qdrant import QdrantStore; QdrantStore().drop()"
# 原本・派生物のアップロード領域をクリア
docker compose exec -T rag sh -c 'rm -rf /data/uploads/*'
```

### テストの前提

- 単体テストのうち DB 統合系（`src/lib/users.test.ts` / `threads.test.ts` / `src/app/api/auth/auth.test.ts` 等）は **Postgres 稼働 + マイグレーション適用済み**が前提。スキーマ変更後は migrate しないと `column ... does not exist` で落ちる。
- E2E: `tests-e2e/rag-flow.spec.ts` はフルスタック（postgres/qdrant/redis/rag）が必要。`tests-e2e/i18n.spec.ts` は dev サーバのみで動く（Cookie 駆動ロケールを検証）。
