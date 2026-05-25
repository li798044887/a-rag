# ARag バックエンド実装プラン（索引）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 既存 Next.js フロントのモック層を、MinerU 解析 → semantic-loss 抑制チャンク → BGE-M3 埋め込み → Qdrant ハイブリッド検索 + rerank の実バックエンドに置き換える。

**Architecture:** 案B。Python(FastAPI) サービス `rag` が取り込みと検索を一括所有し、Next.js `web` はエージェントオーケストレーション・生成(Anthropic)・UI・認証・履歴永続化を担う。両者は内部 HTTP で接続。Postgres は単一インスタンスをテーブル所有分離で共有、Qdrant がベクトル(dense+sparse)、Redis が arq ジョブキュー。

**Tech Stack:** Next.js 16 / React 19 / Tailwind v4 / Drizzle ORM / jose / AI SDK (Anthropic) ／ FastAPI / uv / MinerU / FlagEmbedding(BGE-M3, bge-reranker-v2-m3) / qdrant-client / SQLAlchemy + Alembic / arq ／ Postgres / Qdrant / Redis / Docker Compose

設計書: [`docs/superpowers/specs/2026-05-25-arag-backend-design.md`](../../specs/2026-05-25-arag-backend-design.md)

---

## フェーズ構成と依存関係

各フェーズは単体で「動作・テスト可能」な成果物を生む。上から順に実装する。

| # | プラン | 内容 | 依存 |
|---|---|---|---|
| 1 | [01-infrastructure.md](./01-infrastructure.md) | compose（postgres/qdrant/redis）、rag サービス雛形 + `/health`、web の Drizzle 接続 | なし |
| 2 | [02-auth.md](./02-auth.md) | `users` テーブル、register/login の DB 照合、argon2、`me`/`logout` 流用 | 1 |
| 3 | [03-ingestion.md](./03-ingestion.md) | rag: documents/chunks/ingest_jobs、MinerU parse、レイアウト認識チャンカ、BGE-M3 embed、Qdrant upsert、arq ジョブ + 進捗。web: upload 転送 + 進捗ポーリング | 1, 2 |
| 4 | [04-retrieval.md](./04-retrieval.md) | rag: `/retrieve`（dense+sparse → RRF → bge-reranker → 近傍拡張）。web: `retriever.ts` を HTTP クライアントへ差し替え | 3 |
| 5 | [05-generation-persistence.md](./05-generation-persistence.md) | web: threads/messages/citations、`run.ts` を実 `/retrieve` + Haiku 書換 + Sonnet 生成へ、履歴復元 | 2, 4 |
| 6 | [06-hardening.md](./06-hardening.md) | エラー処理・フォールバック・リトライ・GPU プロファイル・E2E・README 更新 | 1–5 |

---

## リポジトリレイアウト（決定事項）

既存 Next.js アプリは**リポジトリ直下のまま**（移動による無関係な変更を避ける）。Python サービスを `rag/` サブディレクトリに新設する。

```
a-rag/
  src/                      # 既存 web（Next.js）— 維持・拡張
  rag/                      # 新規 Python サービス（FastAPI）
    pyproject.toml          # uv 管理
    app/
      main.py               # FastAPI アプリ（api エントリポイント）
      config.py             # pydantic-settings 設定
      db.py                 # SQLAlchemy エンジン/セッション
      models.py             # documents / chunks / ingest_jobs
      schemas.py            # pydantic I/O スキーマ
      queue.py              # arq 設定
      worker.py             # arq タスク（ingest パイプライン）
      parsing/mineru.py     # MinerU ラッパ
      chunking/chunker.py   # レイアウト認識チャンカ
      embedding/{base,bge_m3,factory}.py
      vectorstore/qdrant.py
      reranker/bge.py
      retrieval/service.py  # hybrid + RRF + rerank + 近傍拡張
      routers/{documents,jobs,retrieve}.py
    alembic/                # rag 所有テーブルのマイグレーション
    tests/                  # pytest
    Dockerfile
  src/lib/db/               # 新規 web DB 層（Drizzle）
    index.ts                # 接続
    schema.ts               # users / threads / messages / citations
  src/lib/rag-client.ts     # 新規: web→rag HTTP クライアント
  drizzle.config.ts         # 新規
  docker-compose.yml        # 新規（既定=CPU プロファイル）
  docker-compose.gpu.yml    # 新規（GPU オーバーレイ）
```

---

## 共通規約（全フェーズ共通・各タスクで前提とする）

### コミットメッセージ
`AGENTS.md` 準拠: **Conventional Commits + 日本語説明**。例 `feat: rag サービスに /health を追加`。

### テスト実行コマンド
- rag（Python）: `cd rag && uv run pytest <path> -v`
- web（TS）: `pnpm test`（フェーズ1で vitest を導入）。Lint は `pnpm lint`。

### web のテスト基盤（フェーズ1で一度だけ導入）
`vitest` を採用（Next.js 16 / Vite 系と相性良、API ルートの単体テストに使用）。導入手順はフェーズ1 Task 4 を参照。

### 環境変数（`.env.example` に集約。フェーズ1で雛形、各フェーズで追記）
web:
- `DATABASE_URL` — 例 `postgres://arag:arag@localhost:5432/arag`
- `RAG_SERVICE_URL` — 例 `http://localhost:8000`
- `RAG_INTERNAL_TOKEN` — web↔rag 内部認証
- 既存: `ARAG_JWT_SECRET`, `ANTHROPIC_API_KEY`

rag:
- `DATABASE_URL`, `QDRANT_URL`（例 `http://localhost:6333`）, `REDIS_URL`（例 `redis://localhost:6379`）
- `DEVICE=cpu|cuda`（既定 cpu）
- `EMBEDDER=bge-m3|api`（既定 bge-m3）
- `RAG_INTERNAL_TOKEN`

### 信頼境界
web↔rag は同一 compose ネットワーク内。rag は `RAG_INTERNAL_TOKEN` ヘッダのみ検証し、`owner_user_id` は web が JWT から解決して渡す（rag は信頼する）。

### Next.js 16 の注意
`AGENTS.md`「This is NOT the Next.js you know」。ルートハンドラ・`cookies()`・dynamic params 等の API は実装直前に `node_modules/next/dist/docs/` を確認すること（既存コードのパターンに倣う）。

### TDD
全タスクは「失敗するテストを先に書く → 失敗を確認 → 最小実装 → 合格を確認 → コミット」の順で進める。
