# エージェント実行ログの細粒度化（retrieve 内部段階のストリーミング）

## 背景と目的

現在のエージェント実行ログ（`src/lib/agent/run.ts`）は、AI SDK の `fullStream` から流れる `tool-call` / `tool-result` を 1:1 でステップに変換しているだけである。モデルに渡しているツールは `retrieve` と `fetch_document` の 2 つのみで、これに合成の `answer` ステップを足して終わる。そのため実際のログは「retrieve + answer」程度の粗い粒度になる。

一方、検索の実体（埋め込み・密ベクトル検索・BM25・リランク・近傍拡張）は `retrieve` ツール 1 回の内部、すなわち rag バックエンド `rag/app/retrieval/service.py` の中で起きており、外からは 1 ステップに潰れて見えない。

本設計の目的は、**retrieve の内部段階をバックエンドからストリーミングで配信し、エージェントログ上に細粒度のサブステップとしてライブ表示する**ことである。

## 決定事項（ブレインストーミングでの合意）

1. **表示構造**: 内部段階は `retrieve` の**子としてネスト**表示する（フラットな兄弟並びにはしない）。
2. **検索の分割**: 現状 Qdrant がサーバ側 RRF で融合している密ベクトル検索と BM25 検索を、**2 クエリに分割**して個別段階（`vector_search` / `bm25_search`）として出す。
3. **分割後の候補統合（性能制約あり）**: dense / sparse の検索結果を**ランク交互マージ（round-robin）+ 重複除去し、`candidate_k` 件で打ち切って** rerank に渡す。RRF 定数の推測は不要で、最終順位は reranker が支配するため品質劣化しにくい。**rerank 入力を従来同様 `candidate_k`(=40) 件に据え置く**ことで rerank コストの増加を防ぐ（性能大前提）。さらに **dense_search と bm25_search は並行実行**し、Qdrant 往復が 1→2 回になることによるレイテンシ増を `max(dense, sparse)` に抑える。
4. **rewrite_query 表示**: モデルが `retrieve` に渡したクエリの可視化として、`retrieve` の**直前にトップレベルの兄弟ステップ**として出す（バックエンドの実段階ではなく、`run.ts` 側で導出）。
5. **転送方式**: rag → Next.js 間は **NDJSON（1 行 1 イベントの chunked レスポンス）**。server-to-server のため SSE framing は不要。
6. **ライブ進行表示**: 各サブステップを `running → done` で逐次更新し、現在段階インジケータを出す（既存 UX 方針に一致）。

## アーキテクチャ / データフロー

### バックエンド（`rag/`）

#### `app/vectorstore/qdrant.py`
- 既存 `hybrid_search`（dense+sparse prefetch + サーバ側 RRF Fusion）を、以下 2 メソッドに分割する。
  - `dense_search(query_dense, owner_user_id, limit)`: DENSE ベクトルのみで `query_points`。
  - `sparse_search(query_sparse, owner_user_id, limit)`: SPARSE ベクトルのみで `query_points`。
- 各メソッドは現在と同じ payload 形（`chunk_id` / `document_id` / `text` / `heading_path` / `page_*` / `block_type` / `score` …）を返す。owner フィルタは従来どおり。
- `hybrid_search` は本機能では未使用になる。他からの参照がないことを確認のうえ削除する（残す場合も新パスからは呼ばない）。

#### `app/retrieval/service.py`
- `retrieve()` を**段階イベントを yield するジェネレータ** `retrieve_stream(...)` に再構成する。処理順と yield:
  1. `embed`: `embedder.embed([query])[0]`（1 回の呼び出しで dense + sparse の両方を得る）。
  2. `vector_search` と `bm25_search`: `store.dense_search(..., limit=candidate_k)` と `store.sparse_search(..., limit=candidate_k)` を **`ThreadPoolExecutor` で並行実行**（qdrant_client は同期 I/O のためスレッドで並列化）。両段階の `start` は実行前に、`done` は各 future 完了時に yield する。
  3. 統合: 2 つのランク付き結果を **round-robin（rank 0 の dense, rank 0 の sparse, rank 1 の dense, …）で交互に取り、`chunk_id` で重複除去し、先頭 `candidate_k` 件で打ち切る**。これにより rerank 入力件数を従来同様 `candidate_k` に据え置く。
  4. `rerank`: `reranker.score(query, [候補の text])` でスコアリングし、降順 top_k。
  5. `expand`: 既存 `_expand` による近傍チャンク連結。Postgres/Qdrant 不整合時の空拡張ガードは現行どおり維持。
- 各段階で `start` と `done`（所要 ms・件数）を yield し、最後に最終チャンク列を yield する。
- 既存の同期 API は **`retrieve_stream` を drain して最終チャンク列だけを返す薄いラッパ `retrieve()`** として温存し、現行の `/retrieve` エンドポイントと既存テストの挙動を変えない。

#### `app/routers/retrieve.py`
- 新エンドポイント `POST /retrieve/stream` を追加。
- リクエストは既存 `/retrieve` と同じ（`query` / `rewritten` / `owner_user_id` / `top_k`）。
- `StreamingResponse(generator, media_type="application/x-ndjson")` で `retrieve_stream` の各イベントを 1 行 1 JSON で配信し、最後に `result` イベントを流す。
- 既存 `POST /retrieve`（非ストリーミング）はそのまま維持。

#### NDJSON イベントスキーマ

```jsonc
{"stage":"embed","status":"start"}
{"stage":"embed","status":"done","ms":120}
{"stage":"vector_search","status":"start"}
{"stage":"vector_search","status":"done","ms":220,"count":40}
{"stage":"bm25_search","status":"start"}
{"stage":"bm25_search","status":"done","ms":180,"count":40}
{"stage":"rerank","status":"start"}
{"stage":"rerank","status":"done","ms":90,"count":6}
{"stage":"expand","status":"start"}
{"stage":"expand","status":"done","ms":30}
{"stage":"result","chunks":[ /* RetrievedChunk[] と同じ形 */ ]}
```

- `embed` の `start`/`done` は任意（埋め込みは初回モデルロードで非常に遅くなりうるため、ライブ表示の価値が高い）。本設計では出す。
- ある段階が失敗した場合は `{"stage":"<name>","status":"error","message":"..."}` を流す。

### Next.js オーケストレータ（TS）

#### `StepBus`（新規, `src/lib/agent/step-bus.ts` 想定）
- ツールと `runAgent` をつなぐ **in-memory async キュー**。
  - `push(event: AgentEvent)`: イベント投入。
  - `[Symbol.asyncIterator]()`: 投入順に drain。
  - `close()`: 完了通知。
- バックプレッシャは不要（イベントは軽量・低頻度）。単純な「pending 値配列 + 待ち resolver」で実装する。

#### `src/lib/agent/run.ts`（再構成）
- 現在 `for await (part of result.fullStream)` の本体で行っている処理（answer 累積、registry、usage、`emitAnswerStep`、最終 `done`）を**ポンプ関数**へ移し、すべての `yield X` を `bus.push(X)` に置換する。ポンプ終了時に `bus.close()`。
- `runAgent` 本体は `for await (ev of bus) yield ev;` で bus を drain して再 yield するだけにする。
- ツール実行は SDK が fullStream 消費の最中に `execute` を await するため、`tool-call(retrieve)` → （execute 内で push される）サブステップ群 → `tool-result(retrieve)` の順序が自然に保たれる。
- **rewrite_query**: ポンプが `retrieve` の `tool-call` パートを受けたら、対応する `retrieve` 親ステップを push する**直前**に、トップレベル兄弟 `rewrite_query` を 1 件 push する。
  - `input = { original: <そのターンの user query>, rewritten: <part.input.query> }`
  - `durationMs = 0`（モデルの tool-call 生成に内包され、独立計測対象ではないため）
  - `summary = 「<original>」→「<rewritten>」`
  - retrieve が複数回呼ばれる場合は、各 retrieve の直前にそれぞれ出る。

#### `src/lib/agent/retrieve-client.ts`
- 既存 `retrieveChunks`（単発 `fetch` + `res.json()`）に加え、`retrieveChunksStream` を追加。
  - `/retrieve/stream` を POST し、`res.body` の `ReadableStream` を行単位で読む。
  - 各 NDJSON イベントを `onStage(event)` コールバックへ渡す。
  - `result` イベントの `chunks` を最終結果として返す（既存 `RetrievedChunk[]` 形にマップ）。
- 既存 `retrieveChunks` は非ストリーミング用に残す（フォールバックや他用途）。

#### `src/lib/agent/tools.ts`
- `retrieve` ツールの `execute` を `retrieveChunksStream` 利用に変更。
  - `onStage` で各段階を受けるたびに、`parentId = toolCallId` のサブステップを bus に push する。
    - `start` → サブステップ `running`、`done` → サブステップ `done`（`durationMs = ms`、`summary` に件数等）。
    - サブステップ id = `` `${toolCallId}:${stage}` ``。
  - 最終 `chunks` を従来どおり registry に登録し、整形テキストを return（`meta` の親 summary もそのまま）。
- `buildTools` の引数に `bus: StepBus` を追加。

#### `src/lib/types.ts`
- `ToolName` に `embed` / `expand` を追加（`vector_search` / `bm25_search` / `rerank` / `rewrite_query` は既存定義を流用）。
- `ToolCall` に `parentId?: string` を追加。

#### `src/hooks/use-agent.ts`（Reducer）
- `reduceTurn` は **変更不要**。サブステップも id マージのフラット配列にそのまま蓄積される（`parentId` 付き）。

### UI

#### `src/components/chat/tool-steps.tsx`
- フラットな `ToolCall[]` を「親（`parentId` 無し）→ 子（`parentId` 一致）」にグルーピングして描画する。
- 親 `retrieve` の行の下に、子段階を**常時インデント表示**する（展開操作不要）。子は一律**コンパクト非展開行**: status アイコン / `name` / `summary` / 所要 ms（入力・出力の展開ブロックは持たない）。
- card / timeline バリアントは親子グルーピングでネスト描画する。log バリアントは現行どおりフラットに全ステップを行として出す（サブステップも順序どおり行として現れるため追加対応不要。子は `name` を字下げ表記）。
- 新しい `ToolName`（`embed` / `expand` / `vector_search` / `bm25_search` 等）のアイコンを `TOOL_ICONS` に追加する（既存の `vector_search` / `bm25_search` / `rerank` アイコンは流用）。

#### `src/components/chat/agent-activity.tsx`
- ヘッダの「N ステップ」「合計時間」は**トップレベルのステップのみ**で集計する（子の ms は親 `retrieve` の duration に内包されるため、子を合算すると二重計上になる）。
- 実行中サマリ（現在段階インジケータ）は、**最も深い running ステップ**の `summary` を表示する（例: 子 `vector_search` が running なら「密ベクトル検索中…」）。トップレベルだけ見て running を探す現行ロジックを、子を含めて running leaf を探すよう拡張する。

## エラー処理

- **段階失敗**: バックエンドが `{"stage":..,"status":"error"}` を流す。ツールは該当サブステップを `error` にする。
- **stream 途中切断**: `retrieveChunksStream` が `result` を受け取れずに終わった場合、`retrieve` 親ステップを `error` とし、ツールはエラー文字列を return してエージェントループは継続（既存の `tool-error` と同様、モデルに回復余地を残す）。
- **abort / cancel**: 既存 `useAgent.cancel` の「running を pending に倒す」挙動を子ステップにも適用する（`steps.map` は元々フラット配列なので子も対象になる）。

## テスト

### バックエンド
- `retrieve_stream` が期待する段階列（embed → vector_search → bm25_search → rerank → expand → result）と件数・ms を yield すること。
- `dense_search` / `sparse_search` が分割クエリとして機能し、round-robin 交互マージ + 重複除去 + `candidate_k` 打ち切りが `chunk_id` 単位で正しく行われること。
- dense_search / bm25_search が並行実行されること（両 future が投入されてから join される）。
- 既存 `retrieve()`（drain ラッパ）が従来と同じ最終チャンク列を返し、現行 `/retrieve` テストが緑のままであること。

### TS
- `StepBus` のマージ順序（push 順に drain される / close で終端）。
- `retrieveChunksStream` の NDJSON パース（行分割・部分フレーム・最終 result 抽出）。
- `runAgent` が `rewrite_query`（トップレベル）→ `retrieve`（親, running）→ 各サブステップ（running→done）→ `retrieve`（done）→ `answer` の順でイベントを emit すること（NDJSON モック）。

### UI
- `reduceTurn` が `parentId` 付きステップをフラット蓄積すること。
- `tool-steps` が親子グルーピングでネスト描画すること、`agent-activity` の集計がトップレベルのみで二重計上しないこと、running leaf の summary がヘッダに出ること。

## スコープ外

- `fetch_document` の内部分解（単一 DB クエリのため段階化しない。現行どおり単一ステップ）。
- `summarize` への改名（現行 `answer` を維持）。
- RRF の自前再現（round-robin 交互マージ + 上限打ち切り + rerank 方式を採用）。
