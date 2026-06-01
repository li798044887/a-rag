# 待機中アップロードの取り消し機能 設計

- 日付: 2026-06-02
- 対象: ARag 文書アップロードの「取り消し（キャンセル）」
- スコープ: 待機中（`queued`）ジョブのサーバ側キャンセル ＋ アップロード送信中（`uploading`）の中断

## 背景・課題

現状、アップロードキューの ✕ ボタンが呼ぶ `removeFile`（`src/hooks/use-uploads.ts`）は、ローカル状態からの除去・進捗タイマー停止・SSE 購読中断のみを行い、**サーバには一切通知しない**。

その結果:

- バックエンドにキャンセル API が存在しない（`rag/app/routers/documents.py` は `DELETE`（ready 後の完全削除）と `retry` のみ）。
- ✕ はどの段階でも「見た目だけ」の操作で、消したファイルも裏で索引化まで完走し、文書ライブラリに現れる（誤解を招く挙動＝実質バグ）。
- フロントは POST 応答後すぐ `processing` 表示に切り替え、`queued`（待機中）状態を可視化していない。

一方バックエンドは `POST /documents`（`documents.py:90-123`）で Document・IngestJob を `status="queued"` として作成し、Redis(arq) に投入する。Worker は `max_jobs=1`（1件ずつ・1件数分）で処理するため、**実際に複数ファイルが `queued` で滞留する場面が多い**。`queued` 段階は中間生成物（パース済みMD・チャンク・ベクトル）が一切無く、最もクリーンに取り消せるポイントである。

## ゴール

- `queued` ジョブをサーバ側で安全に取り消せる（行・生ファイルを削除し、Worker が拾っても no-op）。
- `uploading`（POST 送信中）を中断でき、消したのに索引化される現状バグを塞ぐ。
- `queued` 状態を UI に可視化し、✕ を状態で出し分ける。

## 非ゴール（今回スコープ外）

- 処理中（`parsing`/`chunking`/`embedding`/`indexing`）ジョブの中断。
- `ready`/`error` 文書の削除（既存の文書管理モーダルの `DELETE /documents/{id}` が担う）。

## 方式

採用: **専用キャンセル API ＋ 原子的削除**（`retry` と対称）。

- `POST /jobs/{job_id}/cancel` を新設し、`status='queued'` の行だけを条件付き DELETE（原子的）。queued でなければ 409。
- Worker は doc/job 不在時に例外でなく正常スキップへ変更し、キャンセルと着手の競合を握り潰す。

不採用:

- 既存 `DELETE /documents/{id}` の流用 — status チェックが無く、処理中でも消せてしまいサーバ側の不変条件を守れない。
- `cancelled` ステータス導入 — 「取り消し＝消える」体験と合わず、各所の status 分岐が増える。

## 詳細設計

### 1. 状態の可視化（フロント）

- `src/lib/types.ts`: `UploadStatus` に `"queued"` を追加。
- `src/hooks/use-uploads.ts`:
  - `toUploadStatus`: `"queued"` → `"queued"`（現状は processing に丸めている）。
  - POST 応答後にセットする状態を `"processing"` → `"queued"` に変更。SSE が Worker 着手で `parsing`→`processing` へ進める。
  - `uploading` 中のフェイク進捗アニメは従来どおり。`queued` は進捗を持たず「待機中…」表示にする。

### 2. キャンセルの導線（UI）

`src/components/uploads/uploads.tsx` の ✕ を状態で出し分ける。

| 状態 | ✕ の挙動 |
|------|----------|
| `queued`（待機中） | 取り消し: キャンセル API を呼ぶ。成功→キューから除去。409→トースト「処理中のため取り消せません」＋ processing に状態更新（残す） |
| `uploading` | 進行中の upload POST を abort ＋ ローカル除去 |
| `processing` | ✕ を非表示/無効（取り消し不可） |
| `ready`/`error`/`skipped` | 従来どおりローカル除去（バックエンド非アクティブ、対象外） |

- ステッパー（`IngestStepper`）手前の `queued` 用に「待機中…」表示を1つ追加。

### 3. アップロード送信中の abort（フロント）

- `src/hooks/use-uploads.ts` の `fetch("/api/upload")` に `AbortController` を付与し、id ごとに保持。
- ✕（`uploading` 時）で abort → POST 中断。アップロード本体（バイト送信）が長い大きいファイルで有効。
  - サーバの `create_document` は本文を全読込してから（`await file.read()` 後）行を作成するため、本文送信中の abort では基本 Document は作られない。
  - 残存する競合: サーバが本文読込完了直後に abort が届くごく短い窓では Document が `queued` で作られうる（既知の小さな残リスク。発生時は文書ライブラリ側から削除可能）。

### 4. バックエンド（`rag/`）

- `rag/app/routers/documents.py`: 新エンドポイント `POST /jobs/{job_id}/cancel`
  - `dependencies=[Depends(require_internal_token)]`、引数 `owner_user_id: str | None`（retry と同形で IDOR 防止）。
  - 原子的キャンセル: `session.query(IngestJob).filter(IngestJob.id == job_id, IngestJob.status == "queued").delete()` を実行。
    - 所有者チェックも WHERE に含める（`owner_user_id` 指定時）。削除0件なら、対象が無いか queued でないため、ジョブ存在を確認して 404 か 409 を返し分ける。
  - 成功時は対応する `Document` 行と生ファイル（`cleanup_document_files(raw_path, None)`）を削除。`queued` のため chunks/Qdrant は対象外。
  - ステータスコード: 成功 204 / 所有者不一致・不在 404 / queued でない 409。
- `rag/app/worker.py` のガード変更（`run_ingest` の `worker.py:52-53`）:
  - 現状 `if not doc or not job: raise RuntimeError(...)` を `return`（正常終了・ログのみ）に変更。
  - キャンセルが Worker 着手と競合し行が消えていても、エラーにせず no-op で終える。
- arq abort は使わない。行削除＋Worker スキップで十分（拾っても即 no-op、`max_jobs=1` のため瞬時）。

### 5. Next.js API ルート

- `src/app/api/uploads/[id]/cancel/route.ts` を新設（`src/app/api/uploads/[id]/retry/route.ts` と対称）。
  - セッション claims を取得し、未認証は 401。
  - `ragFetch` で `POST /jobs/{id}/cancel?owner_user_id=<claims.sub>` を呼ぶ。
  - 204/404/409 をそのまま中継、その他は 502。

### 6. エラー処理・既知の競合

- cancel と Worker 着手の TOCTOU: cancel 側は条件付き DELETE で原子的。万一 Worker がちょうど着手中だと、Worker の commit が削除済み行に当たり `StaleDataError` 等で停止しうるが、UI からは既に消えており実害なし（`max_jobs=1` ＆ 数分処理のため発生確率は低い）。完全な排他が必要なら `SELECT ... FOR UPDATE` を追加する余地がある。
- 409 はフロントでトースト＋状態再同期（processing に更新して残す）。
- `uploading` abort の残リスクは §3 のとおり既知の小さな窓として許容。

## テスト

- rag（pytest）:
  - queued ジョブの cancel が 204 ＋ IngestJob/Document 行と生ファイルが削除される。
  - processing/ready ジョブの cancel が 409。
  - 所有者不一致が 404。
  - Worker ガード: doc/job 不在で `run_ingest` が例外を投げず no-op で終わる。
- フロント: 型チェック・lint。

## 変更ファイル一覧

- `src/lib/types.ts` — `UploadStatus` に `queued` 追加
- `src/hooks/use-uploads.ts` — `queued` マッピング、POST 後の状態、upload abort、cancel 呼び出し
- `src/components/uploads/uploads.tsx` — ✕ の状態別出し分け、待機中表示
- `src/app/api/uploads/[id]/cancel/route.ts` — 新規（中継ルート）
- `rag/app/routers/documents.py` — `POST /jobs/{job_id}/cancel` 新規
- `rag/app/worker.py` — `run_ingest` の不在ガードを raise→return
- rag テスト — cancel/ガードのテスト追加
