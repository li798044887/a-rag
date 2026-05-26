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

```bash
# 1. インフラ起動
docker compose up -d

# 2. rag マイグレーション
docker compose exec rag uv run alembic upgrade head

# 3. web 依存インストール + マイグレーション
pnpm install
pnpm drizzle-kit migrate

# 4. web 開発サーバ
pnpm dev   # http://localhost:3000
```

rag-worker をローカルで起動する場合（docker compose profile を使う場合は不要）:

```bash
docker compose --profile worker up -d
```

### GPU（NVIDIA + nvidia-container-toolkit が必要）

```bash
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d
```

`/health` で `"device": "cuda"` が返ることを確認:

```bash
curl -s localhost:8000/health
# {"status":"ok","device":"cuda","models_loaded":true}
```

## 環境変数一覧

### web (.env.local)

| 変数 | 説明 | 既定値 |
|---|---|---|
| `ARAG_JWT_SECRET` | JWT 署名鍵（本番では必須） | 開発用固定値 |
| `ANTHROPIC_API_KEY` | Claude API キー（回答生成に必須） | 未設定時は検索・引用は動作するが、回答生成はスキップし案内メッセージを返す |
| `DATABASE_URL` | web→Postgres 接続（node-postgres 形式） | `postgres://arag:arag@localhost:5432/arag` |
| `RAG_SERVICE_URL` | web→rag 内部 HTTP | `http://localhost:8000` |
| `RAG_INTERNAL_TOKEN` | web↔rag 内部認証トークン | `dev-internal-token` |

### rag (compose 環境変数 / .env)

| 変数 | 説明 | 既定値 |
|---|---|---|
| `DATABASE_URL` | rag→Postgres 接続（psycopg3 形式） | `postgresql+psycopg://arag:arag@localhost:5432/arag` |
| `QDRANT_URL` | Qdrant gRPC/HTTP | `http://localhost:6333` |
| `REDIS_URL` | arq キューブローカー | `redis://localhost:6379` |
| `DEVICE` | モデル実行デバイス `cpu` または `cuda` | `cpu` |
| `EMBEDDER` | 埋め込みモデル `bge-m3` または `stub` | `bge-m3` |
| `RERANKER` | リランカーモデル `bge` または `stub` | `bge` |
| `RAG_INTERNAL_TOKEN` | web↔rag 内部認証トークン | `dev-internal-token` |
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
