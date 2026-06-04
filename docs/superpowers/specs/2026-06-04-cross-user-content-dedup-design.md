# コンテンツアドレス方式による横断共有（重複ファイル管理の再設計）

- 日付: 2026-06-04
- 対象: rag（Python/FastAPI）データモデル・取り込み・検索・削除、および web 側との境界
- 状態: 設計承認済み（実装計画待ち）

## 背景と課題

現状、ファイルは完全にユーザー単位（`owner_user_id`）で隔離されている。重複排除は
「同一ユーザーが同じファイルを二度上げる」ケースだけで、`documents` の部分ユニーク
インデックス `uq_documents_owner_hash_active`（`(owner_user_id, content_hash)`、非 error）
で弾いている（migration `b7c4d9e1f2a3`）。

別ユーザーが同一バイトのファイルを上げると、すべてが N 重に複製される:

| 重複対象 | 場所 | コスト |
|---|---|---|
| 原本ファイル | ディスク `{uuid}_{name}` | ストレージ |
| MinerU 解析 | `_mineru/` `_assets/` `_rendered.pdf` | CPU 数分（最大コスト） |
| チャンク行 | PG `chunks` | DB 行 |
| 埋め込み生成 | BGE-M3 | CPU/GPU（最大コスト） |
| ベクトル | Qdrant（payload に `owner_user_id`） | ストレージ |

検索は Qdrant の `owner_user_id` フィルタで隔離しているため、コンテンツ共有設計では
ここのアクセス制御方式が要になる。

## 決定事項（ブレインストーミングでの合意）

1. **共有モデル**: 全ユーザー横断で共有。同一バイトのファイルは横断で 1 回だけ
   解析・埋め込み・保存し、各ユーザーは参照だけ持つ。「あるファイルが既にシステム内に
   存在するか」をユーザーが暗黙に知り得る（アップロードが即完了する等）ことは許容する。
2. **既存データ**: 既存の全資料を削除し DB をクリアにしてよい。後方互換のための
   バックフィル移行は不要。最適な手法で再構築する。
3. **検索アクセス制御**: 方式 A（hash フィルタ）。Qdrant 点に `content_hash` を付与し
   `owner_user_id` は持たない。検索時に「そのユーザーが参照する `content_hash` 集合」を
   `documents` から解決し `MatchAny` で絞る。ベクトルは不変・追記のみで、共有/削除時の
   payload 書き換えが不要。

## アーキテクチャ概要

共有の核は「**コンテンツ実体（`content_hash` 単位・1 個）**」と「**ユーザーごとの参照
（library entry）**」の分離である。

- `contents` — 共有実体。原本・解析成果物・チャンク・ベクトルの所有者。`ref_count` で
  参照数を管理し、0 になった時に GC する。
- `documents` — ユーザーごとの参照（library entry）。`id` は据え置きで web/citations の
  識別子として機能し続ける。`filename` だけはユーザー固有。
- `chunks` / `ingest_jobs` — `content_hash` に紐づく共有データ。

web 側の `citations` は `document_id`/`chunk_id` をテキストでスナップショット保存して
おり rag への FK は無い。検索結果が従来どおりそのユーザーの `document_id` を返し続ける
限り、web/エージェント側はスキーマ・コードとも改修不要。

## 詳細設計

### 1. データモデル（rag 所有）

**新規 `contents`（共有実体・`content_hash` 単位で 1 個）**

| 列 | 型 | 説明 |
|---|---|---|
| `content_hash` | TEXT **PK** | SHA-256 hex。実体の同一性キー |
| `mime` | TEXT | 初回アップロード由来 |
| `size` | INT | 初回アップロード由来 |
| `page_count` | INT? | 解析後に確定 |
| `status` | TEXT | 解析状態（queued/parsing/chunking/embedding/indexing/ready/error）※実体側に 1 つ |
| `error` | TEXT? | 解析エラー |
| `raw_path` | TEXT | 原本パス（ハッシュ命名で 1 個） |
| `parsed_md_path` | TEXT? | 解析 MD パス |
| `ref_count` | INT default 0 | 参照しているユーザー数。GC 判定に使う |
| `created_at` | timestamp | |

**改修 `documents`（ユーザーごとの参照 = library entry）**

| 列 | 型 | 説明 |
|---|---|---|
| `id` | UUID PK | 据え置き（web/citations が使う識別子） |
| `owner_user_id` | TEXT index | |
| `content_hash` | TEXT FK→`contents.content_hash` | |
| `filename` | TEXT | ユーザー固有（同一バイトでも名前は別々） |
| `created_at` | timestamp | |
| UNIQUE `(owner_user_id, content_hash)` | | 同一ユーザーの二重参照を禁止 |

`mime/size/page_count/status` 列は `documents` から除去し、一覧 API は `contents` を
JOIN して返す。旧 `uq_documents_owner_hash_active`（部分ユニーク）は通常 UNIQUE 制約に
置き換える（参照は content_hash があれば常に有効なため部分条件は不要）。

**改修 `chunks`** — `document_id` → **`content_hash`**（FK→`contents`、index）。
実体ごとに 1 セット。

**改修 `ingest_jobs`** — `document_id` → **`content_hash`**（FK→`contents`、index）。
解析ジョブも実体ごとに 1 個。`owner_user_id` は撤去。

### 2. ストレージ（コンテンツアドレス化）

原本を `{upload_dir}/{content_hash}{ext}` に 1 個だけ保存する（`ext` は初回アップロード
時のファイル名拡張子）。`_mineru/` `_assets/` `_rendered.pdf` は既存ヘルパ
（`assets_dir_for` / `mineru_dir_for` / `rendered_pdf_for`、いずれも `raw_path` から
決定的に導出）を温存するため、`raw_path` が共有になれば派生物も自動的に共有される。

ダウンロード時の表示名（`Content-Disposition` の filename）は library entry の
`filename` を使い、配信実体は共有 `raw_path` から返す。`is_convertible` は `raw_path` の
拡張子で判定するため、初回拡張子に従う（同一バイトで拡張子が食い違う極端なケースは
初回優先で許容）。

### 3. アップロード（dedup ＋ 並行制御）

`POST /documents`（`file`, `owner_user_id`）の流れ:

1. アップロード本文を読み SHA-256 を算出（`content_hash`）。
2. `contents` を `content_hash` で `SELECT ... FOR UPDATE`:
   - **無し** → `contents`(status=queued) を作成、原本を `{hash}{ext}` に保存、
     `ref_count=1`、library entry 作成、`ingest_jobs`(queued) 作成、enqueue。
     新規実体の同時アップロード競合は `contents` の PK（`content_hash`）違反で 1 人が
     勝ち、敗者は IntegrityError を捕捉して既存参照パスへフォールバックする。
   - **有り** → 原本保存はスキップ、`ref_count++`、library entry 作成。
     `status=ready` なら即完了、処理中（queued/parsing/…）なら走行中ジョブを共有。
3. **同一ユーザーが既に当該 content を参照** → 409（現状維持。UNIQUE 違反も 409 に正規化）。

API 形状は不変。レスポンスは `{document_id, job_id}` で、`job_id` はその実体の現行/直近
`ingest_jobs.id`（新規なら新ジョブ、処理中なら走行中ジョブ、ready 済みなら直近の
完了ジョブ）。web は従来どおりジョブをポーリングする（ready 済みなら 1 回で完了判定）。

ref 増加と library entry 作成は `contents` 行の `FOR UPDATE` ロック下で 1 トランザクション
にまとめ、削除 GC との競合（後述）を直列化する。

### 4. ワーカー（実体ごとに 1 回）

`run_ingest` を `content_hash` 基準に変更する。引数は `(content_hash, job_id)` とし、
`contents` 行とそのジョブを取得して解析・チャンク化（`chunks.content_hash`）・埋め込み・
Qdrant upsert を実体ごとに 1 回だけ実行する。完了で `contents.status=ready`。
冪等化（再実行/retry 時の旧チャンク・旧ベクトル掃除）は `content_hash` 単位で行う。
`record_workspace_activity` は owner 単位の概念なので、当該 content を参照する
全 library entry の owner に対して記録する（or 後述の通り簡素化）。

> 注: `workspace_activity` は owner 単位の最終更新時刻。共有 content の ready 化は複数 owner
> に影響し得るが、実務上はアップロード操作を行った owner の活動として扱えば十分。
> 実装計画で「ready 時に当該 content を参照する全 owner に記録」か「アップロード時点で
> owner 記録」のどちらかに確定する（既定: 当該 content を参照する全 owner に記録）。

`WorkerSettings.functions` のシグネチャ変更に伴い、`requeue_interrupted_jobs` も
`content_hash` ベースで再キューする。

### 5. 検索（方式 A: hash フィルタ）

- Qdrant payload を `chunk_id, content_hash, heading_path, page_start, page_end,
  block_type, source_type, text` に変更（`owner_user_id`/`document_id` を撤去し
  `content_hash` を付与）。`ensure_collection` で `content_hash`（keyword）に payload
  index を作成し `MatchAny` を効率化する。
- `retrieve` / `retrieve_stream` の入口で、router が `owner_user_id` → 参照中
  `content_hash` 集合を `documents` から解決する。`document_ids`（エージェントによる
  範囲指定）が来た場合は、それらを所有検証しつつ `content_hash` へ写像する。
- Qdrant 検索は `MatchAny(content_hash, [...])` で絞る。`QdrantStore.dense_search` /
  `sparse_search` / `_scope_filter` を `owner_user_id` 引数から `content_hashes`
  （+ 任意の `content_hashes` 範囲指定）引数へ変更する。
- 結果のマッピング: ヒットは `content_hash` + `chunk_id` を持つ。これを「そのユーザーの
  `document_id`（library entry id）/ `filename`」へ写像し直して返す。`content_hash` →
  `(document_id, filename)` の owner 別マップを retrieve 開始時に 1 回構築する。
  これにより web から見える `document_id` は従来どおり library entry id になる。
- `_expand`・`fetch_document`・`preview` のチャンク取得を `document_id` 基準から
  `content_hash` 基準へ変更する（document_id → content_hash を所有検証付きで解決）。

### 6. ファイル配信エンドポイント

`raw` / `rendered` / `layout` / `span` / `assets` / `preview` / `chunks` の各
エンドポイントは、`document_id` → 所有 library entry 検証 → `contents` のパス/チャンクを
使用する形に変更する。アクセス制御の原則は「そのユーザーが当該 content の library entry
を持つか」。ダウンロード表示名は library entry の `filename`。

### 7. 削除と参照カウント GC（並行制御）

`DELETE /documents/{id}`・`POST /documents/bulk-delete`・`POST /jobs/{job_id}/cancel`
を統一的に「library entry を 1 つ落として `ref_count--`」とする。

- `ref_count > 0` → 実体は残す（他ユーザーが参照中）。library entry のみ削除。
- `ref_count == 0` → `contents` を `FOR UPDATE` でロックの上、`chunks`・Qdrant ベクトル
  （`delete_by_content`）・原本/派生ファイル（`cleanup_document_files` を raw_path 基準で
  流用）・`ingest_jobs`・`contents` 行を削除する。
- アップロードの ref 増加も同じ `FOR UPDATE` で直列化し、GC との競合（FK 違反、
  孤児ファイル）を防ぐ。GC が先にコミットして content が消えていれば、アップロードは
  「新規実体作成」パスへ落ちる。
- `cancel` は従来どおり「queued のみ許可」のガードを残す。ref→0 かつ content が queued の
  時だけ、状態条件付き DELETE で実ジョブを原子的に削除する。ready/processing は 409
  （delete を使う）。

`delete_by_document` は `delete_by_content`（payload `content_hash` で削除）へ置き換える。

### 8. クリーンリセット & web 影響 & テスト

- **リセット（既存データ破棄可）**: Alembic 新リビジョンで `chunks` / `ingest_jobs` /
  `documents` を再構築（または DELETE 後に列を再編）し、`contents` を新設する。
  既存の重複データを移行する必要はない。併せて Qdrant コレクションを drop（worker が
  次回 `ensure_collection` で payload index 付きで再作成）し、`upload_dir` をクリアする
  手順を CLAUDE.md/README ないし運用メモに記す。
- **web 側**: `citations` はスナップショット保存で FK 無し → スキーマ・コードとも改修
  なし。`src/lib/rag-client.ts` 経由の呼び出し契約（`/retrieve`・`/documents/:id/chunks`
  等）も入出力形状を維持するため不変。
- **テスト**: rag の `test_documents_*`・`test_worker_pipeline`・`test_retrieval_service`・
  `test_documents_cleanup` 等は `content_hash` 前提へ要改修。`test_chunker` は純粋関数
  なので影響なし。TDD で「重複アップロードで解析・埋め込みが 1 回だけ走る」「2 人目は
  即 ready で参照だけ増える」「1 人削除しても他ユーザーは検索可能」「最後の参照削除で
  実体・ベクトル・ファイルが GC される」を先にテスト化する。

## 影響範囲（ファイル）

- `rag/app/models.py` — `Content` 追加、`Document`/`Chunk`/`IngestJob` 改修
- `rag/alembic/versions/*` — 新リビジョン（破壊的再構築）
- `rag/app/routers/documents.py` — upload/delete/bulk-delete/cancel/retry/配信系
- `rag/app/documents_service.py` — list/stats/cleanup を content 基準へ
- `rag/app/worker.py` — `run_ingest` / `requeue_interrupted_jobs` を content 基準へ
- `rag/app/vectorstore/qdrant.py` — payload/フィルタ/削除を content_hash 基準へ、index 追加
- `rag/app/retrieval/service.py` — content_hash フィルタ + document_id 写像
- `rag/app/schemas.py` — 必要に応じてレスポンス型調整（外形は維持）
- `rag/tests/*` — content_hash 前提へ全面改修
- web 側 — 改修なし（契約維持を確認するに留める）

## 非対象（YAGNI）

- テナント/組織単位の限定共有（全ユーザー横断のみ）
- 既存重複データの移行・バックフィル（クリアして再構築）
- 暗黙の存在漏洩への対策（許容済み）
- 同一バイト・別拡張子の厳密な扱い（初回拡張子優先で許容）
