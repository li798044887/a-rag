# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## リポジトリ規約（補足・重要）

- **コミットメッセージとコード内コメントは日本語**で書く。UI 文言の既定言語は日本語（ja）。
- 既存の日本語コメントは翻訳しない。i18n 作業でもコメントは触らず、ユーザー可視文字列のみ置換する。
- **改変版 Next.js 16** を使用。API・規約・ファイル構成が学習データと異なる可能性があるため、コードを書く前に `node_modules/next/dist/docs/` の該当ガイドを読む。
- **改行コードは LF。** Windows（`git config core.autocrlf=true`）でも壊れないよう、CRLF 化すると壊れるファイル（`Dockerfile` / `*.sh`）は `.gitattributes` で `eol=lf` 固定済み。Dockerfile の multiline `RUN if [...]; then \` は CRLF だと GPU ビルドが parse error で落ちるため、編集時に LF を保つこと。

## アーキテクチャ（全体像）

2 つのサービス + インフラで構成される。

- **web（`src/`）** — Next.js 16 App Router / React 19 / TypeScript / Tailwind v4。ユーザー認証・チャット UI・エージェント統括・永続化（users/threads/messages/citations）を担う。
- **rag（`rag/`）** — Python / FastAPI。検索・埋め込み（BGE-M3）・リランク（bge reranker）・パース（MinerU/テキスト）・チャンク化のみを担う。**LLM による回答生成は行わない**。
- **インフラ（`docker-compose.yml`）** — Postgres / Qdrant / Redis、および rag API・rag-worker（arq ジョブワーカー）。

### エージェント統括は TS 側にある（重要）

回答生成のループは Python ではなく **`src/lib/agent/run.ts`** にある。AI SDK の `streamText` に `retrieve` / `fetch_document` ツールを渡し `stopWhen` でステップループし、`fullStream` のパーツと retrieve のサブステージを `StepBus` で統合して `AgentEvent` として stream する。引用番号は `CitationRegistry` で一元管理。ツールは `src/lib/rag-client.ts`（`/retrieve`・`/retrieve/stream`・`/documents/:id/chunks`）経由で **Python rag を内部 HTTP 呼び出し**する（`RAG_SERVICE_URL` + `RAG_INTERNAL_TOKEN`、ヘッダは `X-Internal-Token`）。

- システムプロンプト等は `src/lib/agent/prompts.ts` の `getAgentPrompts(locale)` に言語別で集約。`buildSystemPrompt(cfg, locale)`（`src/lib/agent/config.ts`）が**設定駆動 × 言語別**に組み立てる。中国語プロンプトは機械翻訳ではなく RAG 専門家視点で最適化済み。
- chat ルート `src/app/api/chat/route.ts` が `getLocale()` と `clampAgentCfg()` を解決して `runAgent` に渡す。

### 1 つの Postgres に 2 つの所有領域

- **web 所有**: `users` / `threads` / `messages` / `citations` — Drizzle ORM（`src/lib/db/`）。マイグレーションは `drizzle/`（drizzle-kit）。接続は node-postgres 形式。
- **rag 所有**: `contents` / `documents` / `chunks` / `ingest_jobs` — Alembic（`rag/alembic/`）。接続は psycopg3 形式（`rag/app/models.py`）。
- 互いの領域をまたいで管理しないこと。スキーマ変更はそれぞれのマイグレーション系で行う。

### コンテンツアドレス方式（contents ↔ documents 分離）

原本の実体は **`contents`**（`content_hash` 主キー、原本パス・MIME・`ref_count`・解析ステータス）として一意化し、ユーザーの所有エントリ **`documents`**（`owner_user_id` + `content_hash` + ファイル名）と分離する。同一実体は複数ユーザー・複数エントリで**共有**され、解析（パース→チャンク→埋め込み）は実体ごとに 1 回だけ走る（content-hash dedup）。`chunks` は `content_hash` に紐づき、削除は `ref_count` で GC する。アップロード口は rag の `POST /documents`（`rag/app/routers/documents.py`）。

### 取り込み（ingestion）フロー

アップロード（web `/api/upload` → rag `POST /documents`）→ 新規実体なら `ingest_jobs` を Redis キューへ → **rag-worker**（`rag/app/worker.py` の `run_ingest`）が MinerU/テキストでパース → チャンク化 → BGE-M3 で埋め込み → Qdrant 登録。worker が起動していないと索引化は進まない。

- **画像チャンクは表示専用**で、埋め込み・Qdrant 索引からは除外される（`block_type=="image"`）。
- hybrid(VLM) バックエンドが図から抽出したテキスト（`image_caption` + 構造化 `content`、例 mermaid フローチャート）は、`rag/app/parsing/mineru.py` が画像直後の**独立 `text` ブロック**として展開し索引対象にする。図テキストの無い装飾画像は追加ブロックを生成しない。

### 認証 / i18n

- 認証: JWT（`jose`）を Cookie に保持。`src/lib/auth.ts` の `getSessionClaims()` が署名・失効を検証。ミドルウェア `src/proxy.ts` が `/api/chat`・`/api/upload` を保護。
- i18n: `src/i18n/`。既定 zh + ja。辞書は `locales/{zh,ja}/<namespace>.ts` に機能別分割、**zh が唯一の出所**で ja は型注釈 + ランタイム parity テストでキー対等を強制。言語はサーバ側 `getLocale()`（`users.locale`（DB 永続）→ Cookie → 既定）で解決し、切替時はページをリロードして SSR 文言と prompt を一致させる。言語設定は `/api/account/locale` で `users.locale` に永続化（Cookie は SSR 用キャッシュ）。

### フロントエンド

エントリは `src/app/page.tsx` → `Workspace`（クライアント）。Tailwind v4 のトークンは `src/app/globals.css` の `@theme inline` で定義。CJK の太さムラ対策として `--font-cjk`（PingFang SC 等、簡体を網羅）を `--font-sans`/`--font-mono` に挿入している。コンポーネントは Storybook（`*.stories.tsx`、MSW でモック）でカタログ化。

## コマンド

### 初回起動（dev / CPU・フルスタック必須）

ログイン・アップロード・索引化まで動かすには rag スタックが要る。

```bash
cp .env.example .env.local   # ARAG_JWT_SECRET, ANTHROPIC_API_KEY を設定
docker compose --profile worker up -d                  # インフラ + rag API + rag-worker（CPU/pipeline）
docker compose exec -T rag uv run alembic upgrade head # rag 側マイグレーション
pnpm install
pnpm drizzle-kit migrate                               # web 側マイグレーション
pnpm dev                                               # http://localhost:3000
```

`docker-compose.override.yml`（`docker compose` が自動マージ）によりホスト側 Postgres は **5433**。`.env.local` の `DATABASE_URL` は `postgres://arag:arag@localhost:5433/arag` にする。

### GPU 起動（prod / CUDA・hybrid VLM）

nvidia-container-toolkit（または WSL2 GPU）前提。`docker-compose.gpu.yml` overlay で `DEVICE=cuda` / `MINERU_BACKEND=hybrid-auto-engine` / GPU 割当 / `VARIANT=gpu`（vllm 同梱）に切替える。

```bash
docker compose \
  -f docker-compose.yml -f docker-compose.override.yml -f docker-compose.gpu.yml \
  --profile worker up -d --build
```

- **`-f` を明示する時は `docker-compose.override.yml` も必ず含める。** `-f` を並べると override の自動マージが無効になり、Postgres のホストポートが 5433→5432 に戻って web の login が失敗する（`DATABASE_URL` が 5433 を指すため）。
- **GPU 割当**は `deploy.resources.reservations.devices` で記述している。トップレベル `gpus: all` は Docker Compose **v2.30+** が必要で、それ未満（例 v2.28）では構成検証に失敗するため使わない。
- **モデル供給**: `MINERU_MODEL_SOURCE` で切替（既定 `huggingface`）。VLM 重み（`opendatalab/MinerU2.5-Pro-2604-1.2B`, 約 2.15GB）は初回オンライン取得 → 以降 `HF_HUB_OFFLINE=1` でキャッシュ運用。**huggingface.co の LFS 配信が不安定/到達不可な環境**では `MINERU_MODEL_SOURCE=modelscope` を付けて起動し、ModelScope（opendatalab の native ホスト）から取得する（キャッシュ存在時はオフラインでも再利用可）。
  ```bash
  MINERU_MODEL_SOURCE=modelscope docker compose \
    -f docker-compose.yml -f docker-compose.override.yml -f docker-compose.gpu.yml \
    --profile worker up -d
  ```
- `/health` が `{"device":"cuda","models_loaded":true}` を返せば準備完了。

### パースバックエンド（CPU / GPU）

MinerU の解析方式は環境変数 `MINERU_BACKEND`（`rag/app/config.py`、許容: `pipeline` / `hybrid-auto-engine` / `vlm-auto-engine`）で切替える。EasyOCR 経路は廃止済み。

- **dev（Mac/Docker・CPU）**: 既定 `pipeline`。図中テキストは取り込まない（図は画像のまま）。vllm 不要。
- **prod（CUDA/GPU）**: `hybrid-auto-engine`。VLM(MinerU2.5) が `--image-analysis`（hybrid 既定有効）で図表を解釈し、図中テキストを `image_caption` + `content` に出す。これを index 対象の text ブロックへ展開する（上記「取り込みフロー」参照）。

### 開発・検証（web）

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

### テスト（rag / Python）

rag イメージは `uv sync --no-dev` でビルドされ **pytest を含まない**。テストは tests/app をマウントし dev グループを同期して実行する（`pytest` バイナリは PATH に無いので `python -m pytest` を使う）。DB 統合テストは Postgres/Qdrant/Redis 起動が前提で、compose ネットワーク経由で接続する。

```bash
# GPU 機の例（CPU dev なら gpu overlay を外す）
docker compose -f docker-compose.yml -f docker-compose.override.yml -f docker-compose.gpu.yml \
  run --rm -v "$PWD/rag/app:/app/app" -v "$PWD/rag/tests:/app/tests" \
  rag sh -c 'uv sync --frozen --group dev >/tmp/s.log 2>&1; uv run --no-sync python -m pytest tests/ -q'
```

### eval（検索品質回帰）

```bash
# repo 管理の golden（図/表を含むデモ・回帰用）。ingest は worker と同じ run_ingest を同期実行する。
docker compose exec -T rag uv run python -m eval ingest --suite agentic_rag_demo
docker compose exec -T rag uv run python -m eval run --suite agentic_rag_demo \
  --gate --out /data/eval-reports/agentic_rag_demo/eval-report.json
```

メトリクスは文書レベル recall@k / fact_coverage（LLM 不要）。詳細は `rag/eval/README.md`。

### DB マイグレーション

```bash
# web（Drizzle）: スキーマ src/lib/db/schema.ts を変更後
pnpm drizzle-kit generate                                  # 差分から SQL を生成（オフライン可）
DATABASE_URL=postgres://arag:arag@localhost:5433/arag pnpm drizzle-kit migrate   # 適用
# ※ drizzle.config.ts の既定は 5432。ホストから流す時は 5433 の DATABASE_URL を明示する。

# rag（Alembic）
docker compose exec -T rag uv run alembic upgrade head
```

### 索引の全リセット（既存データ破棄）

スキーマ再構築や再索引化のため、原本・チャンク・ベクトルをまとめて破棄する。

```bash
docker compose exec -T rag uv run alembic upgrade head    # contents/documents/chunks/ingest_jobs を再構築
# Qdrant コレクション削除（worker が次回 ensure_collection で payload index 付き再作成）
docker compose exec -T rag python -c "from app.vectorstore.qdrant import QdrantStore; QdrantStore().drop()"
# 原本・派生物のアップロード領域をクリア
docker compose exec -T rag sh -c 'rm -rf /data/uploads/*'
```

### テストの前提

- web 単体テストのうち DB 統合系（`src/lib/users.test.ts` / `threads.test.ts` / `src/app/api/auth/auth.test.ts` 等）は **Postgres 稼働 + マイグレーション適用済み**が前提。スキーマ変更後は migrate しないと `column ... does not exist` で落ちる。
- rag の DB 統合系（`rag/tests/test_worker_pipeline.py` 等）は Postgres/Qdrant/Redis 稼働が前提。
- E2E: `tests-e2e/rag-flow.spec.ts` はフルスタック（postgres/qdrant/redis/rag）が必要。`tests-e2e/i18n.spec.ts` は dev サーバのみで動く（Cookie 駆動ロケールを検証）。

### Qdrant コレクションのバージョニング

コレクション名は埋め込みモデルごとに `arag_chunks__<embedder>` で分かれる。埋め込みモデル更新時は新コレクションへ再埋め込みし、`eval run --gate` 通過後にサーブ切替・旧コレクション drop（ブルーグリーン）。
