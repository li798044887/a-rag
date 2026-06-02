# アップロード文書のまとめて削除 設計

- 日付: 2026-06-02
- 対象: ARag 文書管理（`DocumentsModal`）の「まとめて削除（一括削除）」
- スコープ: 文書一覧での複数選択 ＋ サーバ側の一括削除 API

## 背景・課題

現状、文書の削除は1件ずつしかできない。`DocumentsModal`（`src/components/documents/documents-modal.tsx`）では、文書を選択してプレビューを開き、右上の「削除」から `useDocuments.remove(id)` →
`DELETE /api/documents/{id}` → rag の `DELETE /documents/{document_id}`（`rag/app/routers/documents.py:208`）を1件ずつ呼ぶ。

複数の不要文書（例: 試行アップロードしたエラー文書、古い資料）を片付けるには、選択 → プレビュー → 削除 → 確認 を文書ごとに繰り返す必要があり、手数が多い。

## ゴール

- 文書一覧で複数文書を選択し、まとめて削除できる。
- サーバ側は1リクエストで一括削除し、部分成功（一部が見つからない等）を許容して結果を返す。
- 既存の単一削除の挙動・不変条件と整合する（同じ削除処理を共有する）。

## 非ゴール（今回スコープ外）

- 検索/フィルタ条件に一致する「未表示分を含む全件」の選択（今回は表示中＝ロード済みの行のみ）。
- 削除の取り消し（undo）／ごみ箱。
- 待機中アップロードのキャンセル（別設計 `2026-06-02-arag-queued-upload-cancel-design.md` が担当）。

## 方式（確定した決定事項）

- **選択方式**: 選択モードのトグル。通常時は現状の見た目を保ち、「選択」ボタンで選択モードに入ったときだけ選択 UI（チェックボックス・選択ツールバー）を出す。
- **削除方式**: rag に一括削除 API を新設（`POST /documents/bulk-delete`）。フロントからの N 回ループではなく 1 リクエストで処理する。
- **全選択**: 表示中（ロード済みの `items`）のみを対象にする。ページング未表示分は含めない。
- **対象ステータス**: 全ステータスを許可（ready/error に限らず processing/queued 系も選択・削除可）。現状の単一削除（status 無チェックで何でも消せる）と挙動を一致させる。

## 詳細設計

### 1. バックエンド（`rag/`）

**削除処理の共通化**: 現在の `delete_document`（`documents.py:208-227`）の本体を、セッションを受け取り1文書を削除して生ファイルパスを返すヘルパーに切り出す。

```python
def _delete_one(session, doc) -> tuple[str | None, str | None]:
    # Qdrant ベクトル / chunks / ingest job / Document 行を削除し、
    # cleanup 対象の (raw_path, parsed_md_path) を返す。
    raw_path, parsed_md_path = doc.raw_path, doc.parsed_md_path
    QdrantStore().delete_by_document(doc.id)
    session.query(Chunk).filter(Chunk.document_id == doc.id).delete()
    session.query(IngestJob).filter(IngestJob.document_id == doc.id).delete()
    session.delete(doc)
    return raw_path, parsed_md_path
```

`delete_document`（単一）はこのヘルパーを使うよう書き換え、挙動は不変に保つ。

**新エンドポイント** `POST /documents/bulk-delete`（`dependencies=[Depends(require_internal_token)]`）

- リクエスト: `{ owner_user_id: str, document_ids: list[str] }`
- レスポンス（200）: `{ deleted: list[str], not_found: list[str] }`
- 処理:
  - 1セッションで、各 `document_id` について `session.get(Document, id)` し、`doc and doc.owner_user_id == owner_user_id` のときだけ `_delete_one` を呼び、`deleted` に追加・生ファイルパスを収集。
  - 不在・所有者不一致は `not_found` に入れる（**部分成功を許容**、例外にしない）。IDOR 防止のため所有者チェックは必須。
  - `record_workspace_activity(session, owner_user_id=...)` は削除が1件以上あったときに1回だけ。
  - `session.commit()` 後、収集した生ファイルを `cleanup_document_files(raw, parsed)` でまとめて削除。
- ステータスコード: 常に 200（部分成功を JSON で表現）。`document_ids` が空なら `deleted=[], not_found=[]` を返す no-op。
- 全ステータス許可のため status ガードは置かない。処理中文書を消した場合のワーカー競合は、現状の単一削除と同じ既知リスクとして許容する。

**スキーマ**（`rag/app/schemas.py` 等、既存の置き場所に合わせる）: `BulkDeleteRequest` / `BulkDeleteResponse` を追加。

### 2. Next.js 中継ルート

`src/app/api/documents/bulk-delete/route.ts`（新規、`src/app/api/documents/[id]/route.ts` の DELETE と対称）

- `runtime = "nodejs"`。
- セッション claims を取得し、未認証は 401。
- リクエスト body の `document_ids` を読み、`ragFetch("/documents/bulk-delete", { method: "POST", body: { owner_user_id: claims.sub, document_ids } })` を呼ぶ。
- rag の JSON レスポンスをそのまま中継。rag が ok でなければ 502。

### 3. フロント: `useDocuments` 拡張（`src/hooks/use-documents.ts`）

選択状態とデータ操作をデータ層に集約する。

- `selectionMode: boolean` / `enterSelection()` / `exitSelection()`（抜けるとき選択をクリア）
- `selectedIds: Set<string>` / `toggleSelect(id: string)` / `clearSelection()`
- `selectAllVisible()`（`items` の全 id を選択）/ 派生 `allVisibleSelected`（全選択チェックボックスの状態用）
- `removeMany(ids: string[])`:
  - **楽観的更新**: `items` から対象を除去、`total` を `max(0, total - 実除去数)`。
  - `POST /api/documents/bulk-delete`（body `{ document_ids: ids }`）。
  - 失敗（ネットワーク/非 ok）時は `items`・`total` を元に戻し、`「削除に失敗しました」` エラートースト。
  - 成功時は `not_found` も結果的に一覧から消えて良い対象なので削除扱いとし、`「N件の文書を削除しました」` 成功トースト。`exitSelection()` で締める。
- 既存の `remove(id)`（単一）はそのまま残す。

### 4. フロント: 選択 UI（`src/components/documents/documents-modal.tsx`）

- 一覧上部のフィルタ行付近に **「選択」テキストボタン**を追加。押すと `enterSelection()`。
- **選択モード中**:
  - フィルタチップ行（検索ボックス下の `すべて/索引済み/エラー/処理中`）を **選択ツールバー**に差し替える:
    - 左: 全選択チェックボックス（`allVisibleSelected` を反映、トグルで `selectAllVisible()` / `clearSelection()`）＋「N件選択中」表示。
    - 右: 「削除」（danger 配色、`selectedIds.size === 0` のとき無効）と「キャンセル」（`exitSelection()`）。
  - 一覧の各行（`docs.items.map` の `<button>`）左端に **チェックボックス**を表示する。
  - 行クリックの挙動を選択モード中は `toggleSelect(d.id)` に切り替える（通常時は従来どおり `selectDoc(d)` でプレビュー）。
  - 選択中の行は背景ハイライト（既存 `bg-surface-2` を流用）。
- 「削除」押下時は `useConfirm` で確認:
  - title: 「選択した N件の文書を削除しますか？」
  - description: 「選択した N件の文書と抽出データ・索引を完全に削除します。元に戻せません。」
  - confirmLabel: 「削除する」 / tone: danger
  - OK で `removeMany([...selectedIds])`、その後 `onChanged?.()`。
- モバイル: 既存の「左カラム単独表示 → 行タップでプレビューへ」のうち、選択モード中はプレビューへ遷移しない（`toggleSelect` のみ）ので破綻しない。

### 5. テスト

- **rag（pytest）**:
  - 複数（queued/ready 混在）の bulk-delete が、対象の Document・Chunk・IngestJob 行と生ファイルを削除し、`deleted` に全 id を返す。
  - 他人所有 id・存在しない id は `not_found` に入り、ステータスは 200。混在時は実在分だけ削除される。
  - `document_ids` 空配列は no-op で `deleted=[], not_found=[]`。
  - 共有 dev Postgres（5433）を使うため、owner/content は uuid でユニーク化する（プロジェクト規約 `project_rag_tests_shared_db`）。
- **フロント**: 型チェック・lint。可能なら `useDocuments` の `toggleSelect` / `selectAllVisible` / `removeMany`（楽観更新と失敗ロールバック）を vitest で軽く検証。

## 既知の競合・リスク

- 全ステータス許可のため、processing/queued 文書を一括削除するとワーカー着手と競合し得る。これは現状の単一削除と同一の既知リスクで、新たに増やすものではない（`max_jobs=1`・数分処理のため発生確率は低い）。
- 楽観的更新中にポーリング（未完了文書の状態更新 `useDocuments` の `setInterval`）が走り得るが、削除済み id は `items` から消えているため上書きは起きない。失敗ロールバックで `items` を戻した後は次のポーリングで整合する。

## 変更ファイル一覧

- `rag/app/routers/documents.py` — `_delete_one` 抽出 ＋ `POST /documents/bulk-delete` 新規
- `rag/app/schemas.py`（または既存スキーマ定義箇所）— `BulkDeleteRequest` / `BulkDeleteResponse`
- `src/app/api/documents/bulk-delete/route.ts` — 新規（中継ルート）
- `src/hooks/use-documents.ts` — 選択状態 ＋ `removeMany`
- `src/components/documents/documents-modal.tsx` — 選択モード UI・選択ツールバー・行チェックボックス
- rag テスト — bulk-delete のテスト追加
