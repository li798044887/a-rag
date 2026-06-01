# チャット添付ファイルのスコープ付き Q&A 設計

- 日付: 2026-06-01
- ブランチ: feat/office-pdf-preview
- 対象: コンポーザー（送信制御）+ エージェント実行経路（添付スコープ検索）

## 背景 / 問題

会話ドックでファイルをアップロードした際、2つの不具合がある。

1. **アップロード中に質問を送信できてしまう**
   - `composer.tsx` の `canSubmit = !!(value.trim() || attachments.length)` はテキストがあれば送信可。添付が `uploading`/`processing` 中でも送信できる。
   - 送信時 `workspace.tsx#startRun` は `status === "ready"` の添付だけを使うため、まだ処理中の添付は**黙って捨てられる**。ユーザーは「添付について聞いた」つもりでも添付なしで実行される。

2. **添付ファイルについて質問できない**
   - クライアントは `attachments`（ファイル名）をリクエストボディに送っているが、`route.ts` は `attachments` を destructure せず**完全に無視**している。`runAgent` の `RunInput.attachments` も型にあるだけで未使用。
   - エージェントは「ユーザーが今このファイルを添付した」事実を知らず、KB 全体に対する一般検索を行うだけ。「これ何が書いてある？」のような短い質問だと対象文書を特定できず聞き返す。
   - アップロード応答で `documentId` が返るが、`use-uploads.ts` は `jobId` のみ保持し `documentId` を捨てている。現状、添付をドキュメント単位でスコープする手段がない。

## ゴール

- 添付が処理中の間は送信をブロックし、ready になってから送信できるようにする（添付が黙って捨てられない）。
- 添付ありのターンでは、検索を**その添付文書群に排他的にスコープ**し、添付内容について確実に回答できるようにする。

## 非ゴール

- 添付の永続化（DB 保存）やリロード後の添付スコープ復元はしない。添付情報はセッション内（in-memory）のみ。
- 添付を優先しつつ KB 全体も検索する「ハイブリッド」方式は採らない（排他スコープに決定）。
- 添付本文を retrieve を介さず直接プロンプトに詰める方式は採らない（スコープ検索方式に決定）。

## 決定事項

- **送信制御**: 添付が1件でも `uploading`/`processing` 中は送信を無効化（推奨案）。
- **添付 Q&A 方式**: 添付の `documentId` を末端まで貫通させ、retrieve を添付文書群にスコープ（推奨案）。
- **スコープ範囲**: 添付ありのターンは**添付文書のみに排他スコープ**（推奨案）。添付なしのターンは従来どおり KB 全体検索。

## 設計

### A. 問題1 — アップロード中の送信ブロック（`composer.tsx` のみ）

サーバー変更なし。`composer.tsx` の送信可否ロジックを変更する。

```
const pending  = attachments.some(a => a.status === "uploading" || a.status === "processing");
const hasReady = attachments.some(a => a.status === "ready");
const canSubmit = !running && !pending && (value.trim() !== "" || hasReady);
```

- `pending` 中は送信ボタン（submit）と Enter 送信を無効化する。
- テキスト入力（textarea）は `running` 中のみ無効のまま。アップロード中はテキストを書ける（送信だけ不可）。
- `pending` 中はボタン `title` とフッターのヒントに「アップロード完了までお待ちください」を表示し、無効理由を明示する。
- `onKeyDown` の Enter 分岐と `onSubmit` ガードは `canSubmit` を参照するため、ロジック変更だけで Enter 送信も自動的にブロックされる。

備考: テキストなし・添付なしの初期状態は従来どおり送信不可（`hasReady` も `value.trim()` も偽）。

### B. 問題2 — 添付文書へのスコープ検索（フロント末端 → rag まで documentId を貫通）

#### Next.js 側

1. **型** `src/lib/types.ts`
   - `StagedFile` に `documentId?: string` を追加。
   - `Turn` に `attachmentDocIds?: string[]` を追加（再生成で再利用するため）。

2. **アップロード保持** `src/hooks/use-uploads.ts`
   - `const { jobId } = await res.json()` を `const { documentId, jobId } = ...` に変更し、`processing` へ移行する `setFiles` 更新で `documentId` をセットする。

3. **実行起点** `src/components/workspace/workspace.tsx#startRun`
   - `ready` 添付から `documentId` を集める: `const attachDocIds = ready.map(f => f.documentId).filter((x): x is string => !!x);`
   - 再生成時は `regenTurn?.attachmentDocIds ?? []` を再利用。
   - `agent.run(finalQuery, attachNames, attachDocIds, continueId, model.id, {...})` に新引数として渡す。

4. **エージェントフック** `src/hooks/use-agent.ts`
   - `run` シグネチャに `attachmentDocIds: string[]` を追加。
   - `emptyTurn` / `appendRunTurn` に `attachmentDocIds` を通し、Turn に保持。
   - リクエストボディに `attachmentDocIds` を追加: `JSON.stringify({ query, attachments, attachmentDocIds, threadId, ... })`。

5. **API ルート** `src/app/api/chat/route.ts`
   - ボディから `attachments`(names) と `attachmentDocIds` を destructure（現状どちらも無視している）。
   - `runAgent({ ..., attachments, attachmentDocIds })` に渡す。

6. **オーケストレータ** `src/lib/agent/run.ts`
   - `RunInput` に `attachmentDocIds?: string[]`（既存の未使用 `attachments?: string[]` も実際に使う or 整理）。
   - `pump` で `attachments`(names) と `attachmentDocIds` を受け取り:
     - (a) `attachmentDocIds` が非空のとき、user メッセージ本文の前に文脈を1文注入する（SYSTEM は不変）。具体的には `messages` の user content を `[添付ファイル: ${attachments.join("、")}]\n${query}` 形式にする。これにより「これ何？」のような曖昧な質問でも、モデルが添付名を踏まえた retrieve クエリを組める。`attachmentDocIds` が空なら従来どおり `query` のみ。
     - (b) `buildTools({ ..., attachmentDocIds })` に渡す。
   - 注: `attachments`(names) は `route.ts` から `runAgent` へ渡す（現在 route は names も無視しているため、docIds と併せて受け渡しを追加する）。

7. **ツール** `src/lib/agent/tools.ts#buildTools`
   - `BuildToolsInput` に `attachmentDocIds?: string[]`。
   - `retrieve.execute` で `retrieveChunksStream({ ..., documentIds: attachmentDocIds })` に渡す（空配列/未指定なら従来どおり全体検索）。

8. **retrieve クライアント** `src/lib/agent/retrieve-client.ts`
   - `retrieveChunksStream` / `retrieveChunks` の入力に `documentIds?: string[]` を追加。
   - リクエストボディに `document_ids: input.documentIds ?? null` を追加。

#### rag 側（要 `docker compose up -d --build rag`）

9. **スキーマ** `rag/app/schemas.py`
   - `RetrieveRequest` に `document_ids: list[str] | None = None` を追加。

10. **ベクトルストア** `rag/app/vectorstore/qdrant.py`
    - `dense_search` / `sparse_search` に `document_ids: list[str] | None = None` 引数を追加。
    - フィルタ生成を拡張: owner 条件に加え、`document_ids` 指定時は `document_id` の `MatchAny(any=document_ids)` を `must` に AND する。

    ```python
    def _scope_filter(self, owner_user_id, document_ids=None):
        must = [models.FieldCondition(key="owner_user_id",
                                      match=models.MatchValue(value=owner_user_id))]
        if document_ids:
            must.append(models.FieldCondition(key="document_id",
                                              match=models.MatchAny(any=list(document_ids))))
        return models.Filter(must=must)
    ```

11. **検索サービス** `rag/app/retrieval/service.py`
    - `retrieve` / `retrieve_stream` に `document_ids: list[str] | None = None` を追加し、`store.dense_search` / `store.sparse_search` へ渡す。

12. **ルーター** `rag/app/routers/retrieve.py`
    - `_run_retrieve` / `_stream_ndjson` で `document_ids=req.document_ids` を渡す。

## データフロー（添付ありのターン）

```
アップロード完了 → StagedFile.documentId 保持
  └ startRun: ready 添付の documentId[] を収集
      └ agent.run(query, names, docIds)
          └ POST /api/chat { attachmentDocIds }
              └ runAgent({ attachmentDocIds })
                  └ buildTools({ attachmentDocIds })
                      └ retrieve ツール → retrieveChunksStream({ documentIds })
                          └ POST /retrieve/stream { document_ids }
                              └ qdrant dense/sparse_search に MatchAny(document_id) AND
                                  → 添付文書のチャンクのみ返る → 回答
```

## エラー処理 / エッジケース

- **documentId 欠落**: ready なのに `documentId` が無い添付は docIds から除外（filter）。全添付に欠落した場合は `attachmentDocIds=[]` となり全体検索にフォールバック（破綻しない）。
- **再生成**: in-memory Turn の `attachmentDocIds` を再利用。リロード後のスレッドは添付情報自体が無い（名前も非永続）ため、添付なしターンとして全体検索する（整合）。
- **添付なしターン**: `attachmentDocIds` 未指定 → rag は `document_ids=None` → 従来の owner-only フィルタ。後方互換。
- **排他スコープでヒット0**: 添付文書が空/未索引等で0件なら、既存の「該当資料なし」応答にフォールバック。

## テスト

- **rag (pytest)**: `qdrant` の `_scope_filter` が document_ids 有無で正しい Filter を生成すること。`retrieval/service` が `document_ids` を search へ伝播すること（既存 `test_retrieval_service.py` / `test_qdrant_store.py` に追加）。`RetrieveRequest` の後方互換（未指定で None）。
- **Next.js (vitest)**: `composer` の `canSubmit` が pending 添付で false になること（ready/error/skipped では送信可）。`retrieve-client` が `document_ids` をボディに載せること。`use-uploads` が応答の `documentId` を保持すること。
- **手動**: ファイルをアップロード → 処理中は送信無効を確認 → ready 後に「これ何？」で添付内容に基づく回答が返ることを確認。

## 影響範囲 / リスク

- rag はベイク済み Docker イメージのため、変更後に `docker compose up -d --build rag` が必須（プロジェクト規約）。
- 排他スコープのため、添付ありのターンで添付外の KB 情報は参照されない（仕様どおり・意図的トレードオフ）。
