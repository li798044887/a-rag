# ARag バックエンド実装 設計書

- **日付**: 2026-05-25
- **対象**: 既存 Next.js フロント（`a-rag`）のモック層を、実バックエンドに置き換える
- **核となる方針**: ファイルを **MinerU** で構造化解析し、semantic loss を抑えたレイアウト認識チャンク化を経て埋め込み（embedding）し、ハイブリッド検索 + rerank による agentic-RAG を成立させる

## 1. 目的とスコープ

### 1.1 狙い・実行環境
ローカル学習/ポートフォリオ用途と、GPU 付き自己ホストの **両対応**。同一の docker compose 定義で、CPU プロファイル（遅いが動く）と GPU プロファイル（フル性能）を切り替える。

### 1.2 今回「本物」にする範囲
- コア RAG パイプライン: アップロード → MinerU → チャンク → embed → Qdrant → 検索 → 生成
- 非同期インジェストジョブ + 進捗表示
- チャット履歴の永続化
- 実ユーザーアカウント（デモ認証を置換）

### 1.3 スコープ外（モックのまま）
- 外部コネクタ（Slack / Wiki / DB）— UI 上の表示のみ維持
- S3 等のクラウドストレージ（生ファイルは名前付きボリューム。将来差し替え可能に設計）

### 1.4 確定済みの技術選定
| 項目 | 選定 | 備考 |
|---|---|---|
| 境界設計 | **案B**: Python が検索を一括所有、Next.js はエージェント+生成+UI | 既存 Retriever 抽象に乗る |
| 解析 | **MinerU**（opendatalab/mineru） | PDF/Office/画像の構造化解析 |
| 埋め込み | **BGE-M3**（自己ホスト既定、env で API 切替可能な抽象） | dense + learned sparse |
| 検索基盤 | **Qdrant**（dense+sparse ハイブリッド） | + Postgres（メタデータ） |
| rerank | **bge-reranker-v2-m3**（自己ホスト） | 融合は RRF |
| 生成 LLM | **Anthropic**（Sonnet で生成 / Haiku でクエリ書換） | 既存 AI SDK 経由 |

> **実装上の注意**: 本リポジトリの `AGENTS.md` 記載のとおり「This is NOT the Next.js you know」。ルートハンドラ等の具体 API は実装時に `node_modules/next/dist/docs/` を確認してから記述する。本設計はフレームワーク非依存の意図で記述している。

## 2. システム構成

```
┌────────────────────────────────────────────────────────────────┐
│ docker compose（ローカルもGPUホストも同一定義、profile で切替）      │
│                                                                  │
│  ┌──────────────┐      HTTP(/retrieve,        ┌───────────────┐  │
│  │  web (Next.js)│ ───  /documents, /jobs) ──▶ │ rag (FastAPI) │  │
│  │  React/SSE    │ ◀── ranked chunks / status  │  Python       │  │
│  │  AI SDK→Claude│                             │               │  │
│  └──────┬───────┘                              └───┬───────┬───┘  │
│         │ Drizzle                          qdrant- │       │ arq  │
│         ▼                                  client  ▼       ▼      │
│  ┌──────────────┐  (同一インスタンス・   ┌─────────┐ ┌─────────┐  │
│  │  Postgres     │   スキーマ/所有分離)   │ Qdrant  │ │ Redis   │  │
│  │ web: users/   │      rag: documents/  │ dense+  │ │ queue   │  │
│  │ threads/msgs/ │      chunks/ingest    │ sparse  │ │         │  │
│  │ citations     │      _jobs            └─────────┘ └─────────┘  │
│  └──────────────┘                                                │
│                                          ┌─────────────────────┐ │
│  rag は2エントリポイント（同一イメージ）:  │ /data/uploads (vol) │ │
│   - api  : /retrieve /embed /rerank      │  生ファイル + parsed  │ │
│   - worker(arq): MinerU→chunk→embed→upsert└─────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
```

### 2.1 web（既存 Next.js を拡張）
- Next.js 16 / React 19 / Tailwind v4（現状維持）
- **Drizzle ORM + `pg`**（web 所有テーブル）
- 認証: jose JWT（HS256, httpOnly cookie, `proxy.ts`）を継続。**実ユーザー認証**を追加（`@node-rs/argon2` でパスワードハッシュ）
- `lib/agent/run.ts` は司令塔として維持。`lib/agent/retriever.ts` の中身を rag への HTTP 呼び出しに差し替え（**インターフェースは温存**）
- AI SDK で query rewrite（Haiku）+ 回答生成（Sonnet）

### 2.2 rag（新規 Python サービス）
- **FastAPI + uvicorn**、依存管理は **uv**
- **MinerU**（構造化解析）, **FlagEmbedding**（BGE-M3 / bge-reranker-v2-m3）, **qdrant-client**, **SQLAlchemy + Alembic**（rag 所有テーブル）, **arq**（Redis ジョブ）
- 同一イメージで 2 エントリポイント:
  - `api`: `/retrieve` `/embed` `/rerank` `/documents` `/jobs` `/health`（embed/rerank の軽量モデルのみロード）
  - `worker`(arq): MinerU + 埋め込み（重量モデルロード）
- **プロファイル切替**: `DEVICE=cpu|cuda` を環境変数化。compose の `gpu` profile で NVIDIA ランタイム予約 + 大バッチ、無印は CPU + 小バッチ。モデルは起動時ロード（コールドスタート回避）

### 2.3 インフラ
- Postgres / Qdrant / Redis を compose で同梱
- 生ファイル + parsed Markdown は名前付きボリューム `/data/uploads`

## 3. データモデル

### 3.1 Qdrant コレクション `arag_chunks`（named vectors）
- `dense`: 1024 次元 / Cosine（BGE-M3 dense）
- `lexical`: sparse vector（BGE-M3 learned sparse → 日本語トークナイズ問題を回避）
- payload: `chunk_id, document_id, owner_user_id, heading_path, page_start, page_end, block_type, source_type, text`
- 検索: Query API の `prefetch`(dense) + `prefetch`(lexical) → `fusion: rrf` → 上位 N → BGE rerank。`owner_user_id` / scope を payload フィルタ

### 3.2 Postgres（単一インスタンス・所有分離）

web 所有:
| テーブル | 主なカラム |
|---|---|
| `users` | id, email(uniq), password_hash, name, org, initials, created_at |
| `threads` | id, user_id, title, pinned, created_at, updated_at |
| `messages` | id, thread_id, role, content/answer_text, tokens, duration_ms, steps(jsonb), created_at |
| `citations` | id, message_id, ordinal, document_id, chunk_id, section_id, snippet（スナップショット） |

rag 所有:
| テーブル | 主なカラム |
|---|---|
| `documents` | id, owner_user_id, filename, mime, size, page_count, status, raw_path, parsed_md_path, created_at |
| `chunks` | id, document_id, ordinal, heading_path, page_start, page_end, block_type, token_len, text |
| `ingest_jobs` | id, document_id, owner_user_id, status, progress(0-1), stage_detail, error, created_at, updated_at |

`ingest_jobs.status`: `queued | parsing | chunking | embedding | indexing | ready | error`

### 3.3 所有境界の原則
- 各テーブルは単一サービスのみが書き込む。web は `documents/chunks/ingest_jobs` を直接読まず rag の API 経由。
- `citations` は回答時に取得済みチャンクのスナップショット（snippet/section）を保存 → 表示時にサービス跨ぎ JOIN 不要。
- cross-schema 参照は UUID のみ（FK 強制なし）。

## 4. インジェストパイプライン（非同期）

### 4.1 フロー（worker / arq タスク）
```
1. upload受領    web /api/upload (認証) → bytes を rag POST /documents へ転送
                 rag: 生ファイルを /data/uploads に保存 → documents行(status=queued)
                      ＋ ingest_jobs行 作成 → arq.enqueue → {document_id, job_id} 返却
2. parse         MinerU 実行（PDF/Office/画像）。出力: 構造化Markdown ＋
   (job:parsing) content_list.json（block単位: title/text/table(html)/equation(latex)
                 /image, 各 bbox・page・level 付き）
3. chunk         レイアウト認識チャンク化（4.2） → chunks行
   (chunking)
4. embed         BGE-M3 で dense＋sparse をバッチ生成（worker、GPU/CPU）
   (embedding)
5. index         Qdrant に named-vector で upsert（payloadにheading_path等）
   (indexing)     → documents.status=ready / job.progress=1.0 / page_count反映
   各段で ingest_jobs.progress と stage_detail を更新（UIが進捗バー表示）
```

### 4.2 semantic loss を抑えるチャンク戦略
1. **見出し階層の保持**: MinerU の title level から見出しツリーを復元。各チャンクに `heading_path`（例 `設計指針 > 認証 > トークン失効`）を本文先頭に前置（contextual header）して埋め込み。
2. **原子ブロックは分割しない**: 表(HTML)・数式(LaTeX)・コードは 1 チャンクとして丸ごと保持。表は直前の見出し + キャプションを必ず同梱。
3. **段落境界尊重の動的サイズ**: テキストは文/段落境界で結合し目標 ~512〜800 token、上限まで。中途半端な文分割をしない。
4. **オーバーラップ**: 隣接チャンク間で 1〜2 文の重なり（連続性維持）。
5. **近傍メタ**: 各チャンクに `ordinal`・`page_start/end` を持たせ、クエリ時の近傍拡張（fetch_document）に使用。
6. **画像**: キャプション / alt をテキスト化して索引（本文 OCR は MinerU 側で実施済み）。

### 4.3 非同期ジョブと進捗
- 段階を `progress`(0→1) と `stage`(parsing/chunking/embedding/indexing) で表現。
- web は `GET /api/uploads/:id`（rag `GET /jobs/:id` を認証プロキシ）を **処理中のみ ~1 秒間隔ポーリング**。`ready/error` で停止。UI の `StagedFile.status/progress/pages/chunks` にマップ。
- 失敗は `status=error` + `error` 文言を UI トーストに反映。再試行は同 document に対する re-enqueue。

## 5. クエリ / 検索フロー

`run.ts`（web）が司令塔。各 `AgentEvent.step` を実処理に対応させる。

| UIステップ | 実処理 | 担当 |
|---|---|---|
| `rewrite_query` | Anthropic Haiku でクエリ書き換え + サブクエリ/HyDE 的拡張 | web (AI SDK) |
| `vector_search` | rag `/retrieve` 内: BGE-M3 dense → Qdrant prefetch | rag |
| `bm25_search` | 同: BGE-M3 sparse → Qdrant prefetch | rag |
| `rerank` | RRF 融合 → 上位 N → bge-reranker-v2-m3 で再順位付け | rag |
| `fetch_document` | 上位チャンクを近傍(ordinal±1)拡張 + heading_path 付与 | rag |
| `summarize` | Anthropic Sonnet でストリーミング生成（出典 [n] 付き） | web (AI SDK) |

### 5.1 1ホップ契約
web → `POST /retrieve { query, rewritten, scope, owner_user_id, topK }` → rag が dense/sparse 検索・RRF・rerank・近傍拡張までを実行し、ランク済みチャンク配列（text, heading_path, document title/path, page, score, chunk_id/document_id）を返す。web は各ステップの `input/output/summary` を rag のレスポンスのメタ（候補数・スコア等）で埋めて SSE 配信 → 既存のツールカード UI がそのまま実データを表示。

### 5.2 生成と引用
- web が返却チャンクから `[1][2]…` 付き context を構築 → Sonnet が日本語回答をストリーム（既存 `answer-delta`）。
- `citationMap[n] = {documentId, chunkId, sectionId}` を構築し `done` イベントで配信。右パネル(`Source`)＆引用ハイライトに既存構造でマップ（`/retrieve` 応答を `Source`/`SourceSection` 形へ整形）。
- 回答確定後、web は `messages` + `citations`（snippet スナップショット）を Postgres に永続化（履歴復元用）。

### 5.3 スコープ / 権限
`/retrieve` は `owner_user_id` を必須化し Qdrant payload フィルタで自分の文書に限定（将来 workspace 共有も同フィルタで拡張）。

## 6. Next.js 側の統合

### 6.1 認証の実体化
- `users` テーブル + argon2 ハッシュ。`POST /api/auth/register` 追加、`login` を DB 照合に変更。`me`/`logout` は現状の JWT 機構を流用。
- `AppUser`（name/org/initials/email）は `users` 行から導出。

### 6.2 履歴の永続化
- スレッド一覧 = `threads`（user_id 単位、updated_at 降順、pinned 優先）。`GET/POST/PATCH/DELETE /api/threads`。
- メッセージ = `messages`（query/answer/tokens/duration/steps(jsonb)）+ `citations`。スレッドを開くと既存の `ThreadSummary`/`CompletedThread`/ツールステップ/引用を復元。
- `/api/chat` は実行完了時に該当 thread へ message + citations を保存（thread 未指定なら新規作成しタイトルを query から生成）。

### 6.3 API 契約（web ↔ rag、内部 `RAG_SERVICE_URL`）
| web ルート | rag 呼び出し | 用途 |
|---|---|---|
| `POST /api/upload` | `POST /documents`(multipart) | 取り込み開始、`{document_id, job_id}` |
| `GET /api/uploads/:id` | `GET /jobs/:id` | 進捗ポーリング |
| `POST /api/chat`(SSE) | `POST /retrieve` | 検索→生成→永続化 |
| （`retriever.ts`） | — | HTTP クライアント実装に差し替え（インターフェース温存） |

web→rag は共有シークレット（`RAG_INTERNAL_TOKEN` ヘッダ）で内部認証。`owner_user_id` は web が JWT から解決して付与（rag は信頼境界内）。

## 7. エラー処理・プロファイル

- **取り込み失敗**: MinerU 例外/未対応/破損は `ingest_jobs.status=error` + `error`。UI トースト + 再試行。部分失敗（一部ページ OCR 不可）は warning として継続。
- **検索/生成のフォールバック**: rag 不達なら web は `error` イベント + 既存のキュレート回答に縮退（開発継続性）。Anthropic 不達は現行どおりサンプル回答へフォールバック。
- **タイムアウト/上限**: アップロードサイズ上限、`/retrieve` タイムアウト、Qdrant/Postgres 接続リトライ（指数バックオフ）。
- **CPU/GPU プロファイル**: `DEVICE=cpu|cuda`。CPU 時は MinerU 軽量設定 + 小バッチ（遅いが動く＝ローカル要件）。GPU 時は compose `gpu` profile で NVIDIA ランタイム予約 + 大バッチ。ヘルスチェック `GET /health`（モデルロード状態を返す）。

## 8. テスト戦略

- **rag（pytest）**: チャンカの単体（見出し階層復元・表/数式の原子性・オーバーラップ）をゴールデンな MinerU 出力 JSON に対して検証。`/retrieve` 統合は Qdrant をテストコンテナで起動し既知コーパスで順位を assert。embed/rerank はモデルをスタブ可能に（インターフェース注入）。
- **web**: `retriever.ts` の HTTP クライアントを rag モックに対してテスト。認証（register/login/JWT）と threads/messages 永続化の API テスト。`run.ts` の AgentEvent 生成をモック `/retrieve` で検証。
- **E2E（任意）**: Playwright でアップロード→進捗→質問→引用表示の一連を最小コーパスで通す。
- **TDD**: 各ユニットを失敗テスト先行で実装する。

## 9. 環境変数（追加分）

web:
- `DATABASE_URL` — Postgres 接続
- `RAG_SERVICE_URL` — rag サービスの内部 URL
- `RAG_INTERNAL_TOKEN` — web↔rag 内部認証トークン
- （既存）`ARAG_JWT_SECRET`, `ANTHROPIC_API_KEY`

rag:
- `DATABASE_URL`, `QDRANT_URL`, `REDIS_URL`
- `DEVICE=cpu|cuda`
- `EMBEDDER=bge-m3|api`（切替可能な抽象、既定 bge-m3）
- `RAG_INTERNAL_TOKEN`

## 10. 段階実装の想定（plan で詳細化）

1. インフラ足場: docker compose（postgres/qdrant/redis）+ rag サービス雛形 + web の DB 接続（Drizzle）
2. 認証実体化（users + register/login）
3. インジェスト: `/documents` + MinerU parse + チャンカ + embed + Qdrant upsert + ジョブ/進捗
4. 検索: `/retrieve`（hybrid + rerank + 近傍拡張）+ `retriever.ts` 差し替え
5. 生成・永続化: `run.ts` を実 `/retrieve` に接続、messages/citations 保存、履歴復元
6. 仕上げ: エラー処理・フォールバック・E2E・GPU プロファイル検証
