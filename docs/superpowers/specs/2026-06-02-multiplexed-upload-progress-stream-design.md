# 多重化アップロード進捗ストリーム設計

## 背景・課題

大量ファイルのアップロード中、後続操作（チャット送信、ドキュメント一覧、ワークスペース統計）が
すべて `(pending)` で挂起する。

原因は HTTP/1.1 の「1オリジンあたり同時6接続」上限。現状 `use-uploads.ts` は
**1ファイルにつき1本の長命 SSE 接続**（`/api/uploads/:id/stream`）を張り、索引化完了まで
（各 1.5〜3分）開きっぱなしにする。7件以上アップロードすると6本の SSE が全接続スロットを
占有し、`stats` / `documents` / `chat` / 後続の `stream` まで接続待ちになる。

バグではなく「1ファイル=1ストリーム」設計の必然的なボトルネック。

## ゴール

ブラウザが消費する進捗ストリーム接続を **N本 → 常時1本** に集約し、接続枠の枯渇をなくす。
chat/stats など後続リクエストが即座に通るようにする。

## 非ゴール

- rag サービスの改修（無改修方針を維持）。
- アップロード並列度の制限やスループット調整。
- HTTP/2 化などインフラ変更。

## 方針

**A1（rag 無改修・Next.js 側ファンアウト） + B1（デバウンス再接続）** を採用。

- rag は単一ジョブ取得 `/jobs/{job_id}` のみを持ち、一括取得 API は無い。
  既存 stream ルートの「rag は無改修。薄いプロキシ」方針を踏襲する。
- Next.js 側の1本の SSE ルートが、監視対象 jobId 群を rag `/jobs/:id` にファンアウトして
  並列ポーリングし、1接続でブラウザへ多重 push する。

## サーバ設計

### 新エンドポイント `POST /api/uploads/stream`

- 静的セグメント `/api/uploads/stream`。既存の動的 `/api/uploads/[id]/stream`（階層が1つ深い）
  とはパスが衝突しない。Next.js は静的セグメントを優先するため `[id]` 側にも吸われない。
- **メソッドは POST**（現クライアントは `EventSource` ではなく `fetch + ReadableStream` のため
  ボディを渡せる）。
- リクエストボディ: `{ jobIds: string[] }` — `queued` / `processing` のファイルの jobId 集合。
- レスポンス: `text/event-stream; charset=utf-8`（`Cache-Control: no-cache, no-transform`,
  `Connection: keep-alive`, `X-Accel-Buffering: no`）。
- 各フレームに **`jobId` を含める**：
  ```
  data: {"jobId":"...","status":"...","progress":..,"stage_detail":"..","chunks":..,"page_count":..,"error":..}
  ```

### サーバの動作

1. `getSessionClaims()` で認証。未認証は 401。owner=`claims.sub` を rag へ渡し IDOR を防ぐ。
2. ボディの `jobIds` を集合として保持。空なら即 `close()`。
3. `POLL_MS = 600ms` ごとに、集合内の各 jobId を
   `ragFetch('/jobs/:id?owner_user_id=...')` で**並列**ポーリング。
4. 各スナップショットを `jobId` 付きで push。`ready` / `error` に達したジョブは
   ポーリング集合から除外。rag が 404 等を返したジョブはそのジョブのみ
   `status: "error"` フレームを送って集合から除外。
5. 終了条件: 集合が空 / 全ジョブ完了 / `req.signal` abort（モーダルを閉じる・ナビゲート） /
   `MAX_MS = 10分` 到達 → `controller.close()`。

### 旧ルートの削除

- `/api/uploads/[id]/stream/route.ts` はクライアントから参照されなくなるため削除。
  実装時に他からの参照が無いことを grep で確認する。

## クライアント設計（`src/hooks/use-uploads.ts`）

### 接続の単一化

- `streams: Record<id, AbortController>`（ファイル別）を廃止し、
  **`progressStream: AbortController | null`** に置き換える。
- `startStreaming(id, jobId, name)` を撤去し、**`syncProgressStream()`** を新設。

### `syncProgressStream()`

1. `filesRef.current` から `queued` / `processing` のファイルの `jobId` を集めてソートし、
   `reconnectKey`（join 文字列）を作る。
2. 現在開いている接続のキーと同じなら何もしない（不要な再接続を防止）。
3. 変わっていれば旧 `progressStream` を abort。集合が空なら接続を張らず終了。
   空でなければ `POST /api/uploads/stream` を開き、`res.body.getReader()` で読み取りループ開始。
4. 受信フレームは `jobId` で `files` を引き当てて更新（`f.jobId === frame.jobId`）。
   別途のマッピング状態は持たない。

### 呼び出しタイミング（デバウンス ~300ms）

- `enqueue` の upload POST 解決後（`queued` 付与時）。
- `retry`（`processing` へ戻した後）。
- `removeFile`（abort / cancel / remove で集合が変化した後）。

バーストで増える jobId を1回の接続にまとめる。

### トースト（ready/error 通知）

- フレームで `ready` / `error` に**遷移した時のみ**発火（直前 status が未完了の場合）。
  完了ジョブは次回の集合から外れるため二重発火しない。

### 再接続・エラー処理

- ストリームが**予期せず切断**（abort 以外の例外/EOF）した場合、未完了ジョブが残っていれば
  短いバックオフ（~1s）で `syncProgressStream()` を再試行。
  **全ファイルを一括 error にはしない**（旧実装の弱点を改善）。
- 個別ジョブのフレームが `error` を返した場合のみ、そのファイルを error 表示。

### 各操作との整合

- `retry`: ファイルを `processing` に戻す → 集合に再加入 → デバウンス再接続で再購読。
- `removeFile`: 集合から外れる → 再接続（残ジョブが無ければ接続終了）。
- `clear`: `progressStream?.abort()` + アップロード中 POST を全 abort + タイマー掃除。
- 接続前に完了したジョブ: サーバが初回ポーリングで `ready` を検知し1フレーム送って除外。

## テスト（TDD）

- **純関数を抽出してユニットテスト**（`use-uploads.test.ts` に追加）:
  - `activeJobIds(files)`: `queued` / `processing` の jobId のみ抽出。
  - `reconnectKey(jobIds)`: ソート・集合化して安定キーを返す（順序非依存・重複排除）。
- 既存の `uploadActionFor` テストは維持。
- サーバルートのフレーム整形（jobId 付与・完了ジョブの集合除外）は、`ragFetch` をモックした
  薄い単体テストを検討（実装時に vitest 構成と相談。困難なら純関数 `buildFrame(jobId, snapshot)`
  と `isTerminal(status)` を抽出してそこをテスト）。
- 変更後 `pnpm test`（unit プロジェクト）でグリーンを確認。

## リスク・留意点

- jobIds をクエリではなくボディで渡すため URL 長制限は無い。30件でも問題なし。
- 並列ファンアウトは rag への同時リクエストが jobId 数に比例する点に注意。
  ただし接続枠問題（ブラウザ側）の解消が主目的で、rag 側は内部ネットワークのため許容。
- デバウンス中にユーザーがモーダルを閉じた場合、保留中のタイマーが空集合で発火しても
  `syncProgressStream()` が no-op で終わる（既存接続を abort して終了）。
