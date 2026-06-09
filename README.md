# ARag — Agentic RAG

社内ナレッジ（議事録・Wiki・Slack・DB など）を横断するエージェント型 RAG アシスタント。
MinerU 解析 → BGE-M3 埋め込み → Qdrant ハイブリッド検索 + rerank + 近傍拡張で、
引用付き日本語回答を生成します。

## 技術スタック

**Web (Next.js)**
- Next.js 16 (App Router) / React 19 / TypeScript (strict)
- Tailwind CSS v4 (CSS-first `@theme`、デザイントークン)
- Drizzle ORM + Postgres（スレッド/メッセージ/引用永続化）
- jose — JWT 認証（HS256, httpOnly cookie）
- AI SDK (`ai` + `@ai-sdk/anthropic`) — Haiku 書換 + Sonnet ストリーミング

**RAG (Python FastAPI)**
- FastAPI / uvicorn / pydantic-settings
- MinerU — PDF レイアウト解析
- FlagEmbedding (BGE-M3 dense+sparse) / bge-reranker-v2-m3
- Qdrant — ハイブリッドベクトル検索 (dense + sparse → RRF → rerank)
- SQLAlchemy + Alembic / arq — ジョブキュー
- tenacity — 接続リトライ

**インフラ**
- Docker Compose (CPU / GPU プロファイル)
- Postgres 16 / Qdrant v1.12 / Redis 7

## アーキテクチャ

```
Browser
  └─ Next.js web (src/)
       ├─ /api/auth/{login,logout,me}    JWT 発行・破棄
       ├─ /api/chat                      エージェント SSE
       ├─ /api/upload                    ファイル転送 → rag
       ├─ /api/uploads/[id]              進捗ポーリング
       ├─ /api/uploads/[id]/retry        取り込み再試行
       └─ Drizzle/Postgres               スレッド・メッセージ・引用

FastAPI rag (rag/app/)
  ├─ POST /documents                     ファイル受け取り + arq enqueue
  ├─ POST /jobs/{id}/retry               失敗ジョブの再 enqueue
  ├─ GET  /jobs/{id}                     進捗確認
  ├─ POST /retrieve                      hybrid search + rerank + 近傍拡張
  └─ GET  /health                        device / models_loaded

arq worker (rag/app/worker.py)
  MinerU parse → chunking → BGE-M3 embed → Qdrant upsert

Postgres          スレッド/メッセージ/引用 (web) + ドキュメント/チャンク/ジョブ (rag)
Qdrant            dense + sparse ベクトルインデックス
Redis             arq ジョブキュー
```

## 起動

### 前提

- Docker Desktop / Docker Engine + Compose v2
- Node.js 20+ / pnpm 9
- Python 3.11+ / uv（rag 開発時）

### 環境変数

```bash
cp .env.example .env.local
# .env.local を編集: ARAG_JWT_SECRET, ANTHROPIC_API_KEY を設定
```

### CPU（既定）

この手順で、ログイン/登録、ファイルアップロード、RAG 索引化まで動く状態になります。

```bash
# 1. インフラ + RAG API + RAG worker 起動
#    rag-worker はアップロード後の索引化に必須です。
docker compose --profile worker up -d

# 2. rag 側マイグレーション
#    documents / chunks / ingest_jobs を作成します。
docker compose exec -T rag uv run alembic upgrade head

# 3. web 依存インストール
pnpm install

# 4. web 側マイグレーション
#    users / threads / messages / citations を作成します。
pnpm drizzle-kit migrate

# 5. web 開発サーバ
pnpm dev   # http://localhost:3000
```

ホスト側 Postgres ポートは `5432` です。`.env.local` の `DATABASE_URL` は次の値にしてください。

```env
DATABASE_URL=postgres://arag:arag@localhost:5432/arag
RAG_SERVICE_URL=http://localhost:8000
RAG_INTERNAL_TOKEN=dev-internal-token
```

起動後の確認:

```bash
docker compose ps
docker compose exec -T postgres psql -U arag -d arag -c "\dt"
curl -s localhost:8000/health
```

#### 各手順の実行タイミング

上記 1〜5 は実行頻度が異なります（1 が起動してから 2・3・4・5）。

| 手順 | 内容 | いつ実行するか | 頻度 |
|---|---|---|---|
| 1 | `docker compose --profile worker up -d` | 初回、およびコンテナが落ちている時（PC 再起動後・`docker compose down` 後） | 作業開始時に「落ちていれば」 |
| 2 | `alembic upgrade head`（rag） | 初回、および rag 側のマイグレーションが増えた時（`git pull` で `rag/alembic/versions/` が更新された等） | スキーマ変更時のみ |
| 3 | `pnpm install` | 初回、および依存が変わった時 | 依存変更時のみ |
| 4 | `drizzle-kit migrate`（web） | 初回、および web 側のマイグレーションが増えた時（`drizzle/` が更新された等） | スキーマ変更時のみ |
| 5 | `pnpm dev` | 毎回（実際に開発する時に動かすフォアグラウンドのプロセス） | 毎回 |

- **初回セットアップ**: 1 → 2 → 3 → 4 → 5 を順番にすべて。
- **普段の作業開始**: コンテナ起動済みなら（`docker compose ps` で確認）5 だけ。落ちていれば 1 → 5。
  - `restart: always` を設定していないため、PC 再起動後は自動起動しません。`docker compose --profile worker up -d`（または `docker compose --profile worker start`）が必要です。
- 2・4 は普段は不要。`git pull` でマイグレーションが増えた時だけ実行してください（最新済みなら何も起きません）。

つまり日常的に毎回叩くのは実質 `docker compose --profile worker up -d`（落ちてれば）→ `pnpm dev` の 2 つだけです。

### GPU（NVIDIA + nvidia-container-toolkit が必要）

```bash
docker compose -f docker-compose.yml -f docker-compose.gpu.yml --profile worker up -d --build
```

`/health` で `"device": "cuda"` が返ることを確認:

```bash
curl -s localhost:8000/health
# {"status":"ok","device":"cuda","models_loaded":true}
```

### 本番（フルコンテナ + ハードニング）

web も含めて全てコンテナで動かす本番構成。`docker-compose.prod.yml` overlay が web サービス追加・`restart: unless-stopped`・infra ポートの loopback 封じ込め・`APP_ENV=production`（内部トークンの fail-fast 有効化）を担う。

秘密はルート `.env`（git 管理外、compose が自動で読む）に置く。`APP_ENV=production` で `RAG_INTERNAL_TOKEN` が未設定/dev 既定のままなら `up`/`config` 時点で停止する。

```bash
# ルート .env に APP_ENV=production / RAG_INTERNAL_TOKEN / ARAG_JWT_SECRET を設定済みとする
#   生成例: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
docker compose \
  -f docker-compose.yml -f docker-compose.gpu.yml -f docker-compose.prod.yml \
  --profile worker up -d --build

# マイグレーション（rag は in-container、web は loopback 経由で host から）
docker compose -f docker-compose.yml -f docker-compose.gpu.yml -f docker-compose.prod.yml \
  exec -T rag uv run alembic upgrade head
DATABASE_URL=postgres://arag:arag@localhost:5432/arag pnpm drizzle-kit migrate
```

web は `127.0.0.1` ではなく `3000` を全公開する。本番では前段に nginx 等のリバースプロキシを置くこと（Next.js self-hosting 推奨）。

## 環境変数一覧

### web (.env.local)

| 変数 | 説明 | 既定値 |
|---|---|---|
| `ARAG_JWT_SECRET` | JWT 署名鍵（本番では必須） | 開発用固定値 |
| `ANTHROPIC_API_KEY` | Claude API キー（回答生成に必須） | 未設定時は検索・引用は動作するが、回答生成はスキップし案内メッセージを返す |
| `DATABASE_URL` | web→Postgres 接続（node-postgres 形式）。host 側 Postgres は `5432` | `postgres://arag:arag@localhost:5432/arag` |
| `RAG_SERVICE_URL` | web→rag 内部 HTTP | `http://localhost:8000` |
| `RAG_INTERNAL_TOKEN` | web↔rag 内部認証トークン（**本番は必須で差し替え**。web・rag・worker で同一値） | `dev-internal-token` |

### rag (compose 環境変数 / .env)

| 変数 | 説明 | 既定値 |
|---|---|---|
| `DATABASE_URL` | rag→Postgres 接続（psycopg3 形式） | `postgresql+psycopg://arag:arag@localhost:5432/arag` |
| `QDRANT_URL` | Qdrant gRPC/HTTP | `http://localhost:6333` |
| `REDIS_URL` | arq キューブローカー | `redis://localhost:6379` |
| `APP_ENV` | 実行環境 `dev` または `production`。`production` 時に `RAG_INTERNAL_TOKEN` が dev 既定のままだと rag は起動を拒否する | `dev` |
| `DEVICE` | モデル実行デバイス `cpu` または `cuda` | `cpu` |
| `EMBEDDER` | 埋め込みモデル `bge-m3` または `stub` | `bge-m3` |
| `RERANKER` | リランカーモデル `bge` または `stub` | `bge` |
| `RAG_INTERNAL_TOKEN` | web↔rag 内部認証トークン（**本番は必須で差し替え**） | `dev-internal-token` |
| `PRELOAD_MODELS` | `1` の場合、起動時にモデルを事前ロード | 未設定 |

## スクリプト

```bash
pnpm dev          開発サーバ
pnpm build        本番ビルド
pnpm start        本番起動
pnpm lint         ESLint
pnpm test         vitest（単体テスト）
pnpm e2e          Playwright E2E（要フルスタック起動）
```

## トラブルシュート

### `relation "users" does not exist`

web 側の Drizzle マイグレーションが未適用です。Postgres が起動してから実行してください。

```bash
pnpm drizzle-kit migrate
```

`.env.local` の `DATABASE_URL` が `localhost:5432` を指している必要があります。
Windows で `sh is not recognized` や pnpm のリンク解決エラーが出る場合は、同じ環境（PowerShell なら PowerShell、WSL なら WSL）で `pnpm install` をやり直してから再実行してください。

### `relation "documents" does not exist`

rag 側の Alembic マイグレーションが未適用です。`documents` / `chunks` / `ingest_jobs` がないと、アップロード時に「索引化の開始に失敗しました」になります。

```bash
docker compose exec -T rag uv run alembic upgrade head
```

### アップロード後に処理が進まない

`rag-worker` が起動していない可能性があります。worker は Redis キューからジョブを取り出して、MinerU 解析、チャンク化、埋め込み、Qdrant 登録を行います。

```bash
docker compose --profile worker up -d rag-worker
docker compose logs -f rag-worker
```

### MinerU が遅い（CPU 環境）

MinerU は初回 PDF 解析時にモデルをダウンロードし、CPU では 1 ページあたり数秒から数十秒かかる場合があります。GPU 環境では大幅に高速化されます（目安: CPU 10 分 → GPU 1 分）。

### モデルの初回ダウンロード

BGE-M3 / bge-reranker-v2-m3 は初回起動時に HuggingFace からダウンロードされます（合計数 GB）。`PRELOAD_MODELS=1` の場合は `/health` が返るまでに時間がかかります（compose の `start_period: 120s` で対応）。

### GPU が認識されない

```bash
# nvidia-smi が通るか確認
nvidia-smi

# コンテナ内での確認
docker compose -f docker-compose.yml -f docker-compose.gpu.yml exec rag python -c "import torch; print(torch.cuda.is_available())"
```

`/health` の `device` フィールドが `cuda` になっていない場合は nvidia-container-toolkit のインストール状態を確認してください。

### Qdrant バージョン不一致の警告

```
UserWarning: Qdrant client version X.Y.Z is incompatible with server version ...
```

qdrant-client と Qdrant サーバのバージョン差異による警告です。動作には影響しません。`docker-compose.yml` の `image: qdrant/qdrant:vX.Y.Z` を更新することで解消できます。
