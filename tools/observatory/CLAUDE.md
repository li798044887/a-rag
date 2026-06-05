# CLAUDE.md — observatory（LLM/プロンプト観測ダッシュボード）

このファイルは、`tools/observatory/` 配下で作業する Claude Code 向けの指針。
リポジトリ全体の規約はルートの `CLAUDE.md` / `AGENTS.md` に従う（**応答・コメント・コミットは日本語**）。

## これは何か

アプリ本体とは**別枠**の dev 専用ツール。本番と同じ `runAgent`（`src/lib/agent/run.ts`）を
別ポート（既定 `:3030`）で実行し、エージェントの**全 LLM 呼び出しの生プロンプト・生出力**を
観測する。検索（retrieve）は固定でき、5つのプロンプトをその場で上書きして即再実行できる。

設計と実装計画:
- `docs/superpowers/specs/2026-06-05-llm-prompt-observatory-design.md`
- `docs/superpowers/plans/2026-06-05-llm-prompt-observatory.md`

## 最重要原則：アプリ本体から隔離する

- ツールコードは `src/` の外（このディレクトリ）に置く。`src` のどこからも import しない。
- アプリの `pnpm build` / `pnpm lint` / `pnpm test` / ルート `tsc` の対象に入れない。
  - ルート `tsconfig.json` は `exclude: ["node_modules","tools"]`、`eslint.config.mjs` は `tools/**` を ignore。
  - 型チェックは独自に: `pnpm exec tsc -p tools/observatory/tsconfig.json --noEmit`
  - テストは独自に: `pnpm observe:test`（`tools/observatory/vitest.config.ts`、root を固定）
- `src/` 側に足す痕跡は**無害な dev シーム2個だけ**。新しいシームを足すときも同じ原則を守る:
  - `src/lib/agent/run.ts` … `RunInput.observe?`（未指定で挙動不変）
  - `src/lib/rag-client.ts` … `setRagTransport()`（`NODE_ENV==="production"` で拒否）

## 起動・コマンド

```bash
pnpm observe        # :3030 でダッシュボード起動（node tools/observatory/server.mts）
pnpm observe:test   # observe / replay のユニットテスト
```

前提: フルスタック（rag/postgres/qdrant/redis）が起動し、`.env.local` に API キー・`RAG_SERVICE_URL`・
`OBSERVE_OWNER_ID`（索引済み文書を持つ owner）が設定済みであること。`.env.local` はサーバ**起動時**に読む。

## ファイル構成と責務

| ファイル | 責務 |
|---|---|
| `server.mts` | Vite middlewareMode で UI(HMR) 配信 ＋ `/api/defaults`・`/api/run`(SSE)・`/api/snapshots`。`ssrLoadModule` で `@/lib/...` をエイリアス解決込みに読む |
| `observe.ts` | `createObserver()`: `wrapLanguageModel` ミドルウェア。役割判定・プロンプト上書き・入出力/思考過程キャプチャ |
| `replay.ts` | `createReplayTransport()`: `ragFetch` を差し替え `method:path:body` キーで snapshot 保存/再生 |
| `ui/App.tsx`, `ui/main.tsx`, `index.html` | React ダッシュボード（操作パネル＋検索ステップ＋LLMトレース＋Markdown回答） |
| `tsconfig.json`, `vitest.config.ts`, `package.json` | ツール独自設定。`package.json` は `{"type":"module"}` |
| `snapshots/` | retrieve のスナップショット（gitignore。実データ由来なのでコミットしない） |

## 観測対象の LLM（5役）

`runAgent` 内の全 LLM 呼び出し。`models.chat` と `models.rewrite` の2モデルを `run.ts` のシームで包む。
`rewrite` モデルは下記4役で共有されるため、**送信直前の system 文字列**を既定辞書と突合して役割を判定する。

| 役割 | 呼び出し元 | system | 出力 |
|---|---|---|---|
| chat | `run.ts` `streamText` | `buildSystemPrompt(cfg, locale)` | stream |
| grade | `tools.ts` `generateText` | `prompts.grade.system` | structured |
| queryRewrite | `tools.ts`（CRAG retry時） | `prompts.queryRewrite.system` | text |
| verify | `verify.ts` `generateText` | `prompts.verify.system` | structured |
| revise | `verify.ts` `generateText` | `prompts.revise.system` | text |

retrieve（embed/vector/bm25/rerank/expand/grade ステージ）は **LLM ではなく Python rag** の処理なので
`traces`（LLM 層）には出ない。これらは `AgentEvent` の step として `events` に入り、UI の
「エージェント / 検索ステップ」に描画する。

## 仕組みのキモ（変更時に壊しやすい点）

- **役割判定**: `observe.ts` の `detect()` が system 文字列を `roleSystems`（run 開始時に当該 locale/cfg で
  生成した実文字列）と完全一致で照合。プロンプトの文言を変えると辞書も合わせる必要がある。一致しなければ
  `rewrite:unknown` として**記録は必ず残す**（観測が壊れても run は無傷、という設計を維持すること）。
- **stream のパススルー**: chat は `TransformStream` でタップし、本来の消費者（run.ts）へは素通ししつつ
  全 `text-delta` / `reasoning-delta` を連結記録する。二重読みしないこと。
- **AI SDK の型は進化が速い**。`finishReason` は `{unified, raw}`、`usage.inputTokens` は `{total,...}` の
  オブジェクト。テストの mock fixture は実行時値だけ合わせて `as never` でキャストしている。
- **リプレイ**: `replay` で未保存キーは自動 live フォールバックして保存（初回実・以降リプレイ）。
  キーは body 込み（owner/query/top_k 等）なので owner を変えれば別キー＝別 live になる。

## よくある落とし穴

- **検索が 0 件**: ほぼ owner スコープ。`OBSERVE_OWNER_ID`（または UI の owner 欄）が索引済み文書を持つ
  owner id でないとヒットしない。直接確認は `POST {RAG_SERVICE_URL}/retrieve`（`x-internal-token` 付き）。
- **思考過程が空**: gpt-4o など非推論モデルは reasoning を出さない。DeepSeek V4 Pro（reasoner）等で出る。
- **既定モデル**: UI 既定は `claude-sonnet-4-5`。`deepseek-flash` は `DEEPSEEK_API_KEY` 未設定だと
  「モデル利用不可」フォールバックになる。
- **node 実行**: `server.mts` は Node 24 の型ストリップで直接実行。相対 import は `.ts` 拡張子必須
  （`allowImportingTsExtensions` を tsconfig で有効化済み）。UI の import は Vite 解決なので拡張子不要。
- **レイアウト**: グリッドは `body` ではなく `#root` に当てる（React は `#root` 内に描画するため）。

## 変更後の確認

```bash
pnpm observe:test                                          # ツールのユニット
pnpm exec tsc -p tools/observatory/tsconfig.json --noEmit  # ツールの型
pnpm test src/lib/agent/run.test.ts src/lib/rag-client.test.ts  # シームの回帰
```
