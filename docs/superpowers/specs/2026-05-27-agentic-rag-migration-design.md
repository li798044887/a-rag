# Agentic RAG への移行 — 設計

- 日付: 2026-05-27
- 対象: 同一スレッド内で検索結果の後に対話を継続できない問題の解消
- 方針: 固定6段パイプラインを、AI SDK v6 のマルチステップ・ツールループによる **agentic RAG** へ置き換える

## 背景と問題

現状の `runAgent`（`src/lib/agent/run.ts`）は **シングルターン RAG**。1リクエストごとに `query` 1本だけを受け取り、`rewrite_query → retrieve → summarize` を固定実行する。会話履歴はどこにも注入されない。さらに:

- `ConvState`（`src/hooks/use-agent.ts`）は 1スレッド＝1問1答しか保持せず、同一 threadId への2回目で上書きされる。
- `getThreadDetail`（`src/lib/threads.ts`）は最新メッセージ1件のみ読む（`limit(1)`）。

結果として、フォローアップ（「その申請期限は？」等）は指示対象が失われ検索が破綻し、直前の回答に対する操作（「表にして」「もっと詳しく」）も成立しない。`messages` テーブルには行が溜まるのに読み出しとUIが最後の1問しか見ない。

## ゴール / 非ゴール

ゴール:
- 同一スレッド内で会話を継続できる（マルチターン・メモリ）。
- モデルが「検索するか / クエリ / 文書を深掘りするか / 反復回数」を自律判断する（agentic、多段検索・ドリルダウン）。
- 既存の引用UI（`CitedText`・右パネル一次資料）を維持する。

非ゴール（YAGNI）:
- web_search / sql_query / python_sandbox など外部ツールの実装（別スペック）。
- 会話履歴の要約メモリ、過去ターンのツール結果の再投入。
- 引用以外の右パネル機能拡張。

## 採用アプローチ

**AI SDK v6 ネイティブのマルチステップ・ツール呼び出し**（`streamText({ messages, tools, stopWhen: isStepCount(N) })`）。`result.fullStream` のパーツを既存の SSE `AgentEvent` へマッピングするだけで、自前ループを最小化する。

却下案:
- 自前オーケストレーションループ: SDK が提供する多段ループの再実装になり保守コスト増。A案で詰まった場合の逃げ道。
- プランナ＋実行＋合成の2フェーズ: 実質「賢い固定パイプライン」で、動的な深掘り・再検索という要望に逆行。

## アーキテクチャ

```
chat route ─→ runAgent(query, threadId, history, modelId)
                 └─ streamText({
                      model, system,
                      messages: [...history(窓掛け), { role: 'user', content: query }],
                      tools: { retrieve, fetch_document },
                      stopWhen: isStepCount(6),
                    })
                 └─ for await (part of result.fullStream)
                      'tool-call'   → SSE step(running)   // name=tool, input=args
                      'tool-result' → SSE step(done)      // output=要約
                      'text-delta'  → SSE answer-delta
                 └─ finish → SSE done(citationMap, sources, sourceIds, tokens, durationMs, threadId)
```

- `rewrite_query` ステップは廃止。クエリ凝縮はモデルが履歴を見て内部的に行う。
- `stopWhen: isStepCount(6)` で反復上限を設ける（暴走防止）。

## コンポーネント別の変更

### 1. エージェント実行（`src/lib/agent/run.ts`）

- 固定パイプラインを撤去し、`streamText` のツールループへ。
- ツール定義（`tool()` + zod `inputSchema`）:
  - `retrieve({ query: string })` — 既存 `retrieveChunks` を呼ぶ。結果 chunk を `CitationRegistry` に登録し、`[n] {title} — {heading}\n{text}` 形式のテキストを返す。
  - `fetch_document({ document_id: string, around_chunk_id?: string })` — rag の新エンドポイントを呼び、指定文書のチャンク（全段 or 近傍窓）を取得。同様にレジストリへ登録し番号付きテキストを返す。
- `system` プロンプト: 「社内ナレッジアシスタント。一次資料のみに基づき日本語で回答。事実には必ずツール結果に付いた [n] を引用。Markdown の見出し(**太字**)と箇条書き(-)で構造化。」
- `result.fullStream` を読み、tool-call/tool-result/text-delta を `AgentEvent` へマッピングして yield。
- 完了時、`CitationRegistry` から `sources` / `citationMap` / `sourceIds` を構築して `done` を yield。

### 2. 引用レジストリ（ターンスコープ）

- 1ターンごとに `CitationRegistry` を生成。`register(chunk) -> n`（既出 chunk は同じ n を返す）。
- 保持: `n → { documentId, chunkId, documentTitle, headingPath, snippet }`。
- 多段・複数ツールの結果を 1 つの番号空間に統合し、`[1][2][3]…` が一意な出典に解決される。
- 完了時に `sources`（document 単位に束ねる）・`citationMap`（n → {sourceId, sectionId}）へ変換。既存の `sourcesFromChunks` 相当ロジックを流用。

### 3. rag バックエンド：`fetch_document` エンドポイント

- 新規: `POST /documents/{document_id}/chunks`（`require_internal_token`）。
- パラメータ: `owner_user_id`（必須・所有者チェックで IDOR 防止）、`around_chunk_id`（任意。指定時はそのチャンクの ordinal を引いて前後窓、未指定なら ordinal 昇順で全段）。
- 上限段数で truncate（巨大文書対策、既定 40 段）。
- `app/schemas.py` に `FetchDocumentRequest` / `FetchDocumentResponse`、`app/routers/documents.py` にハンドラ追加。
- web 側 `src/lib/agent/retrieve-client.ts` に `fetchDocument()` を追加。

### 4. マルチターン・メモリ（`src/lib/threads.ts`）

- `getThreadDetail`（最新1件）を `getThreadMessages`（全件・`createdAt` 昇順）へ拡張。`/api/threads/[id]` は全ターンを返す。
- run 時、過去ターンを `ModelMessage[]`（user=query / assistant=answerText）へ変換し `messages` 先頭に置く。
- **直近 8 ターン（=16 メッセージ）で窓掛け**。要約は行わない。retrieval は毎ターン新規。

### 5. 永続化（スキーマ変更なし）

- `messages` テーブルは既に「1行=1ターン」でマルチターン対応可能。**スキーマ変更不要**。
- `steps` jsonb に可変ツールトレース（`ToolCall[]`）を保存。`citations` は `messageId` 紐付けで既存通り。
- 各ターン完了時に新規行 insert（既存 `saveCompletedMessage` を流用）。

### 6. SSE プロトコル / クライアント状態（`src/hooks/use-agent.ts`, `src/lib/types.ts`）

- `AgentEvent` の `step` / `answer-start` / `answer-delta` / `done` / `error` をそのまま流用。
- 永続化はストリーム完了後に route 側で行うため `done` 時点で DB の message id は未確定。UI はローカルに新ターンを追記し、スレッド一覧/詳細の再取得で整合させる（`done` に messageId は持たせない）。
- 同名ツール複数回は `id`（toolCallId）でユニーク化。
- `ToolName` に `retrieve` / `answer` を追加（`fetch_document` は既存）。
- `ConvState` を「単一Q&A」から **ターン配列 `turns: Turn[]`** へ変更。
  - `Turn = { query, steps, answer, streaming, citationMap, sources, sourceIds, status, tokens, durationMs, attachments }`。
- `run` は新ターンを末尾に追加して書き込む。`loadCompleted` は全ターンを復元。
- バックグラウンド継続（他スレッド表示中も中断しない）の既存挙動は維持。

### 7. UI（`src/components/chat/*`, `src/components/workspace/workspace.tsx`）

- トランスクリプト化: 単一 conv 前提を `turns` のループ描画へ。各ターン = `UserMessage` ＋ `AssistantMessage(活動ブロック + 回答 + footer)`。Composer は常時表示し、既存スレッドなら末尾に追記。
- 新コンポーネント `AgentActivity`: 既存 `ToolSteps` を折りたたみで包む。
  - 実行中: 展開 ＋ 現在アクションのスピナー。
  - 完了時: 「エージェント実行 Nステップ · Xs」の1行に畳む（`WrapHead` を畳みヘッダに流用）。
  - `toolView`（card/timeline/log）設定は内側にそのまま反映。
- `TOOL_ICONS` に `retrieve` アイコン追加。
- 右パネルは「クリックされた引用が属するターンの sources」を表示。

## エラー処理

- ツール失敗（rag 接続不可など）: `execute` がエラー要旨を返してモデルへ伝達し、該当 step を error 表示。
- `stopWhen` 上限到達: 最後のテキストを回答に採用。無ければフォールバック文言（「回答の生成に失敗しました…」）。
- モデルキー未設定: 既存 `resolveModels` の `ok:false` 文言を維持（agentic ではツールが呼べないため、検索のみ動作の従来挙動は提供しない）。
- 永続化失敗: 既存どおり `done` 送出後はログのみ（クライアントへ error を送らない）。

## テスト

- `src/lib/agent/run.test.ts`: ツールループのモック（retrieve→answer、多段 retrieve→fetch_document→answer、引用レジストリの番号一意性）。
- 引用レジストリのユニットテスト（既出 chunk の番号再利用、document 単位の束ね）。
- rag `tests/test_fetch_document_api.py`: 正常取得、所有者不一致で 404、上限 truncate。
- `tests-e2e/rag-flow.spec.ts`: 同一スレッド内のフォローアップ継続シナリオ（1ターン目検索 → 2ターン目で指示語フォローアップが解決される）を追加。

## 段階的実装の指針（plan で詳細化）

1. rag `fetch_document` エンドポイント ＋ web `fetchDocument()` クライアント。
2. 引用レジストリ ＋ ツール定義（`retrieve` / `fetch_document`）。
3. `runAgent` をツールループへ置き換え、`fullStream` → `AgentEvent` マッピング。
4. `threads.ts` の全ターン読み出し ＋ 履歴窓掛け。
5. `ConvState` のターン配列化（`use-agent.ts`, `types.ts`）。
6. UI トランスクリプト化 ＋ `AgentActivity` 折りたたみ。
7. テスト更新・追加。
