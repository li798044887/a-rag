# アップロード文書の管理機能 設計書

作成日: 2026-05-31

## 目的

アップロード済みの全文書を一覧・プレビュー・再索引・ダウンロード・削除できる管理 UI を追加する。現状の `useUploads` / `AttachmentTray` はコンポーザ内の一時ステージングのみで、過去にアップした文書を後から管理する手段が無い。

## スコープ

- 対象: ある所有者（`owner_user_id`）の**全アップロード文書**（PDF に限らず Word/Excel/画像なども含む。`documents` テーブル全件）。
- 操作: 一覧（検索・ページング）/ プレビュー（原本PDF・解析テキスト・抽出画像）/ 再索引（retry）/ 原本ダウンロード / 削除。
- 非対象（YAGNI）: 文書のリネーム、抽出画像の個別削除、タグ/フォルダ分類、複数選択一括操作。

## 全体方針

- バックエンド（rag サービス, FastAPI）に一覧・削除・プレビューの3エンドポイントを新設。
- Next.js 側は認証して `owner_user_id` を注入する薄いプロキシ。
- UI はサイドバー「コレクション > データソース」から開く**大型マスター詳細モーダル**（約 90vw × 88vh、左にリスト約300px、右にプレビュー）。
- 画像URL絶対化・原本/アセット配信・retry など既存資産を最大限流用する。

---

## 1. バックエンド（rag サービス）

### 1.1 `GET /documents` — 文書一覧（キーセット・ページング）

- 認証: `require_internal_token`
- クエリ:
  - `owner_user_id`（必須）
  - `limit`（既定 30、上限 100）
  - `cursor`（任意。`<created_at_iso>|<id>` を base64url 化した不透明トークン）
  - `q`（任意。ファイル名の部分一致 `ILIKE %q%`）
  - `status`（任意。`queued|processing|ready|error` 等でフィルタ）
- 並び順: `created_at DESC, id DESC`（OFFSET 劣化を避けるキーセット）
- 返却 `DocumentListResponse`:
  - `items[]`: `id, filename, mime, size, page_count, status, created_at, chunk_count, latest_job_id, error`
    - `chunk_count`: `chunks` の集約カウント
    - `latest_job_id` / `error`: 最新 `ingest_jobs` 行から（一覧から直接 retry できるよう job_id を含める）
  - `next_cursor`: 次ページがあれば不透明トークン、無ければ `null`
  - `total`: **同一 `q`/`status` フィルタでの厳密な総件数**（別 `COUNT` クエリ）
- 実装メモ: `items` の集約（chunk_count / latest_job）は N+1 を避けるためサブクエリ or `LEFT JOIN + GROUP BY` で一括取得。

### 1.2 `DELETE /documents/{document_id}` — ハード削除

- 認証 + 所有者検証（`doc.owner_user_id == owner_user_id`、不一致は 404 で IDOR 防御）。
- 削除順:
  1. Qdrant ベクトル: 既存 `QdrantStore.delete_by_document(document_id)`
  2. `chunks` 行削除
  3. `ingest_jobs` 行削除
  4. `documents` 行削除
  5. ファイル実体クリーンアップ（後述 `cleanup_document_files`、best-effort）
- DB 操作は 1 トランザクション。ファイル削除はトランザクション外の best-effort（`missing_ok` / `ignore_errors`）。
- 返却: `204 No Content`。

### 1.3 `GET /documents/{document_id}/preview` — 全チャンク取得（A案）

- 認証 + 所有者検証。
- 既存 `fetch_document_chunks` の窓掛け・`MAX_CHUNKS` 上限を**かけず**、`ordinal` 昇順で全チャンクを返す（引用文脈用エンドポイントとは責務を分離し、双方を壊さない）。
- 返却は既存 `FetchDocumentResponse` 形式を流用（`document_id, document_title, chunks[]`）。
- 画像は本エンドポイントでは特別扱いしない。画像チャンクは `block_type=image` で本文に `![](images/...)` を含むため、フロントで抽出して表示する。

### 1.4 ファイルレイアウトとクリーンアップ

1 文書につき以下の実体が存在する:

| 実体 | パス | 用途 |
|---|---|---|
| 原本 | `raw_path` = `<upload_dir>/<uuid>_<name>` | ダウンロード・PDFプレビュー |
| アセット | `<stem>_assets/`（`assets_dir_for`） | 表示用に複製した抽出画像 |
| MinerU 生出力 | `<stem>_mineru/`（worker の `out_dir`） | MinerU 解析の中間出力。**現状クリーンされず残置** |
| 解析MD | `parsed_md_path`（現状未設定・将来用） | 念のため対象に含める |

`documents_service` に追加:

- `mineru_dir_for(raw_path) -> str`: `<stem>_mineru` を決定的に導出（`assets_dir_for` と対）。
- `cleanup_document_files(doc) -> None`: 原本 / `_assets` / `_mineru` / `parsed_md_path` を best-effort で削除。削除（1.2）と worker の再索引時の冪等掃除の双方から呼べる共通ヘルパ。

---

## 2. Next.js API プロキシ

すべて `getSessionClaims()` で認証し、未認証は 401。`owner_user_id` にはサーバ側で `claims.sub` を注入（クライアントからは渡させない）。

- `GET /api/documents` — `q` / `status` / `limit` / `cursor` を透過し、`owner_user_id` を注入して `GET /documents` を呼ぶ。
- `DELETE /api/documents/[id]` — `DELETE /documents/{id}?owner_user_id=...` を呼ぶ。
- `GET /api/documents/[id]/preview` — `GET /documents/{id}/preview` を呼び、結果のチャンク本文を `resolveImageUrls(text, id)` で絶対化して返す（既存ロジック再利用）。
- 既存流用:
  - 原本表示: `GET /api/documents/[id]/raw`
  - 画像配信: `GET /api/documents/[id]/assets/[...path]`
  - 再索引: `POST /api/uploads/[jobId]/retry`（一覧の `latest_job_id` を渡す）
- ダウンロード: `GET /api/documents/[id]/raw?download=1` で `content-disposition: attachment` に切替。rag 側 `get_document_raw` も `download: bool = False` を受理し `content_disposition_type` を `attachment` に変える。

---

## 3. フロントエンド

### 3.1 `src/hooks/use-documents.ts`

責務を一点に絞ったデータ層フック:

- `list`: `items` / `total` / `nextCursor` / `loading` 状態。
- `setQuery(q)` / `setStatusFilter(s)`: フィルタ変更で先頭から再取得（cursor リセット）。
- `loadMore()`: `nextCursor` で追記取得しマージ。
- `remove(id)`: 楽観的にリストから除去 → `DELETE` 失敗時はロールバック + トースト。
- `retry(jobId, id)`: 既存 retry を呼び、対象行を `processing` に。
- ポーリング: **現在モーダルに表示中かつ未完了（queued/processing 系）の文書のみ**を対象に状態更新（一覧全件を毎秒叩かない）。

### 3.2 `src/components/documents/documents-modal.tsx`

大型マスター詳細モーダル（約 90vw × 88vh、上限幅あり、モバイルは全幅）。

- **左ペイン（約300px）**:
  - 検索ボックス（ファイル名、デバウンス）
  - ステータスフィルタ（chips）
  - 文書リスト（行: 形式アイコン / ファイル名 / メタ「形式 · サイズ · ページ · Nチャンク」/ ステータスバッジ / ⋯メニュー）
  - 末尾に「さらに読み込む」（`nextCursor` がある時）。先頭に総件数 `total` 表示。
- **右ペイン（残り全幅、行選択時）**: タブ
  - `原本PDF`: `/api/documents/[id]/raw` を `<iframe>`/`<object>` で inline 表示（広い面積で閲覧）。
  - `解析テキスト`: `/api/documents/[id]/preview` の全チャンクを heading_path/ページ付きで表示。
  - `画像`: 解析テキストのチャンク本文から抽出した画像URL群をグリッド表示（**個別削除は不可**、閲覧のみ）。
  - 未選択時はプレースホルダ。
- **行・詳細の操作**: プレビュー（選択）/ 再索引（`error`・`ready` のみ活性）/ 原本ダウンロード / 削除（既存 `use-confirm` の確認モーダル経由）。

### 3.3 サイドバー配線

- `src/components/sidebar/sidebar.tsx` の「データソース」`CollectionItem` をクリックでモーダルを開く（workspace.tsx に `documentsOpen` state を追加し、`HelpModal` 等と同様に配線）。
- ハードコードのカウント `"8"` を `use-documents` の `total`（実数）に置換。

---

## 4. 大量時の対策

- **キーセット・ページング**: `created_at DESC, id DESC` の不透明 cursor。件数が増えても OFFSET 劣化なし。
- **`total` 厳密件数**: 同一フィルタの別 `COUNT` クエリでサイドバーバッジと一覧見出しに表示。
- **サーバ側ファイル名検索 `q`**: クライアント全件取得を回避。
- **ステータスフィルタ**: error の絞り込み等。
- **ポーリング対象の限定**: 表示中かつ未完了の文書のみ。

---

## 5. テスト

### rag（pytest）
- 一覧: ページング境界（`limit`/`cursor` 連続取得で重複・欠落なし）、`q` 部分一致、`status` フィルタ、`total` がフィルタ反映、所有者分離（他人の文書が出ない）。
- 削除: ベクトル（`delete_by_document` 呼出）・`chunks`・`ingest_jobs`・`documents` 行・原本/`_assets`/`_mineru`/`parsed_md` ファイルがすべて消える。所有者不一致は 404。存在しない ID は 404。
- プレビュー: 窓掛け・上限なしで全チャンクが ordinal 昇順で返る。所有者検証。
- `cleanup_document_files` / `mineru_dir_for` のユニットテスト（存在しないパスでも例外を投げない）。
- raw ダウンロード: `download=1` で `content-disposition: attachment`。

### Next（vitest）
- 各プロキシの 401（未認証）と `owner_user_id` 注入。
- preview プロキシが `resolveImageUrls` を適用すること。
- download ヘッダ切替。

### フロント（vitest）
- `use-documents`: 楽観削除＋ロールバック、`loadMore` マージ、フィルタ変更での cursor リセット、ポーリング対象が未完了のみ。

---

## 影響範囲・非互換

- 既存の引用フロー（`fetch_document_chunks`）・retry・raw/assets 配信には変更を加えない（preview は別エンドポイント、raw は後方互換な任意 `download` パラメータのみ）。
- DB スキーマ変更なし（リネーム非対応のため新カラム不要）。
- worker の再索引クリーンアップを `cleanup_document_files` 経由に寄せる場合も、挙動は現状（`_assets` 再作成）と等価かそれ以上（`_mineru` も掃除）。
