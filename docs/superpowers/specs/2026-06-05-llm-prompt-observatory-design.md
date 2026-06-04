# LLM/プロンプト観測ダッシュボード（Observatory）設計

- 日付: 2026-06-05
- 状態: 設計合意済み（実装計画は別途 writing-plans で作成）

## 目的

エージェントのパイプライン（全 LLM 呼び出しとプロンプト導線）を**完全に観測**し、かつ
**プロンプトを書き換えて即再実行**できる開発専用ツールを用意する。主目的は次の2つ:

1. プロンプト反復（プロンプトエンジニアリング）— system/各プロンプトを書き換えて即再実行し、出力差分を見る。
2. 実行のデバッグ — 1回の実行で chat/grade/rewrite/verify/revise の**生プロンプトと生出力**をタイムラインで確認する。

「トレース蓄積」や「自動評価/回帰」は本ツールの目的外（YAGNI）。

## 形態（合意事項）

- **別ポートの独立 Web ダッシュボード**（既定 `:3030`）。`pnpm observe` で起動。
- 検索（retrieve）は **初回 live・以降リプレイ**（検索を固定してプロンプト差分だけを見られる）。
- プロンプトは **5種すべて編集可・エフェメラル上書き**（ファイルは書き戻さない）。
- **アプリ本体とは別枠**として明確に区分する（後述「隔離の方針」）。

## 観測対象（確定）

| 役割 | 呼び出し元 | system プロンプト | 出力形式 | 使用モデル |
|---|---|---|---|---|
| chat（回答生成） | `run.ts` `streamText` | `buildSystemPrompt(cfg, locale)` | ストリーム | `models.chat` |
| grade（関連度判定） | `tools.ts` `generateText` | `prompts.grade.system` | structured | `models.rewrite` |
| rewrite（再検索クエリ） | `tools.ts`（CRAG retry 時のみ） | `prompts.queryRewrite.system` | text | `models.rewrite` |
| verify（根拠検証） | `verify.ts` `generateText` | `prompts.verify.system` | structured | `models.rewrite` |
| revise（訂正再生成） | `verify.ts` `generateText` | `prompts.revise.system` | text | `models.rewrite` |

- `rewrite` モデルは grade/rewrite/verify/revise の **4 役で共有**される単一オブジェクト。
  役割判別は「送信直前の system 文字列」と run 開始時に構築した既定文字列辞書との照合で行う。
- 「rewrite（クエリ書き換え）」は独立 LLM 呼び出しではなく chat モデルの retrieve ツール入力。
  ただし CRAG 再検索時は `prompts.queryRewrite.system` を使う独立 `generateText` が走る（上表の rewrite 役）。
- 各役割について「実際に送った messages/system/tools/responseFormat」「生の出力（structured は raw JSON、
  stream は全 delta 連結）」「usage・finishReason・所要時間」をキャプチャする。

## アーキテクチャ

`runAgent` は DB 非依存（run.ts は db を import しない）なので、ダッシュボードは
**本番と同じ `runAgent` をそのまま実行**する。本番との差分は次の3点のみ:

1. 全 LLM 入出力が見える（AI SDK ミドルウェアでキャプチャ）。
2. 検索を固定できる（`ragFetch` の transport 差し替えによる snapshot/replay）。
3. プロンプトを上書きできる（ミドルウェアの `transformParams` で system 差し替え）。

### ディレクトリ構成

```
tools/observatory/            # ← src/ の外。アプリのビルド対象に入らない
  server.ts                   # Vite middlewareMode + SSE。:3030 を listen
  index.html                  # ダッシュボード SPA エントリ
  ui/                         # React。プロンプト編集欄＋トレースツリー
  observe.ts                  # createObserver(): モデル wrap ミドルウェア + トレース sink
  replay.ts                   # ragFetch スナップショット保存/再生
  tsconfig.json               # ツール独自の TS 設定（root を extends、include は tools/ のみ）
  snapshots/                  # <method>:<path>:<bodyhash>.json（.gitignore）
src/lib/agent/run.ts          # 任意シーム observe? を1個追加（既定 undefined＝不活性）
src/lib/rag-client.ts         # 任意 transport フックを1個追加（既定 = 素の fetch）
```

### 本番シーム（唯一の本番改変・既定で挙動不変）

**run.ts**

```ts
export interface RunInput {
  // ...既存...
  observe?: {
    wrap: (model: LanguageModel, hint: "chat" | "rewrite") => LanguageModel;
  };
}
```

`pump` 内で `resolution.models.chat` を `observe.wrap(m, "chat")`、`resolution.models.rewrite` を
`observe.wrap(m, "rewrite")` で包んでから使う。`observe` 未指定なら素通し（分岐1つ・挙動不変）。
`tools.ts` / `verify.ts` / `grade.ts` / `config.ts` / `prompts.ts` は**無改変**。

**rag-client.ts**

```ts
let transport: typeof fetch | null = null;          // dev 限定で差し替え
export function setRagTransport(t: typeof fetch | null) {
  // 本番では絶対に差し替えさせない（アプリ実行を汚さない安全弁）。
  if (process.env.NODE_ENV === "production" && t) {
    throw new Error("setRagTransport is dev-only");
  }
  transport = t;
}
// ragFetch 内で (transport ?? fetch)(...) を使う
```

`ragFetch` は rag への単一 HTTP 境界なので、ここを差し替えるだけで
`/retrieve`・`/retrieve/stream`・`/documents/:id/chunks` すべてを snapshot/replay できる。
`setRagTransport` は観測サーバが run の前後で設定/解除する（run は逐次実行なので競合なし）。

侵襲のまとめ: 本番は「型に optional フィールド1つ＋分岐1つ」「rag-client に null 既定のフック1つ＋本番ガード」だけ。

## キャプチャ（observe.ts）

`createObserver()` が 1 run 分のトレース収集器を返す。

```ts
type Role = "chat" | "grade" | "rewrite" | "verify" | "revise";
interface LlmTrace {
  seq: number; role: Role | "rewrite:unknown"; modelName: string;
  startedAt: number; durationMs: number;
  request: { system: string; messages: ModelMessage[]; tools?: string[];
             responseFormat?: unknown; overridden: boolean };
  response: { text: string; toolCalls?: { name: string; input: unknown }[];
              raw?: unknown; finishReason?: string; usage?: LanguageModelUsage };
  error?: string;
}
```

- `wrap(model, hint)` は `wrapLanguageModel({ model, middleware })` を返す。
- `transformParams({ params })`:
  1. `params.prompt` から system を取り出す。
  2. `hint==="chat"` → role=chat。`hint==="rewrite"` → 既定文字列辞書（run 開始時に当該 locale/cfg で
     実際に生成した grade/queryRewrite/verify/revise の system）と完全一致で role を確定。
     一致しなければ `rewrite:unknown` として記録（観測が壊れても run は無傷）。
  3. `overrides[role]` があれば system を差し替え `overridden=true`。
  4. seq を採番し開始時刻を記録。
- `wrapGenerate` / `wrapStream`:
  - 下流を呼び、structured は raw、text は `result.text`、stream は全 `text-delta` を連結＋ tool-call を収集。
    usage・finishReason・durationMs も格納。
  - stream は二重読みを避けるため `fullStream` をタップする transform を噛ませ、本来の消費者（run.ts）へは
    そのまま流す（パススルー記録）。
  - 例外時は `error` に格納しつつ再 throw（本番同様のフォールバックを通す）。
- すべての `LlmTrace` を `observer.traces` に push し、`onTrace` で SSE へ即時送出。

役割判定の安全策: 既定 system は config 駆動で揺れうるので、辞書は run 開始時の locale/cfg で構築した
実文字列を用いる（chat の `buildSystemPrompt` 結果も保持）。一致しなくても記録は必ず残す。

## リプレイ（replay.ts）

- キー: `sha256(method + path + canonicalJSON(body))`。retrieve は body に query/owner/top_k 等が入るため
  同条件は同キー。
- `live`: 実 fetch を呼びつつ応答ボディを読み切ってスナップショットへ保存し、同内容の Response を run へ返す。
  stream（`/retrieve/stream`）も全バイトをバッファしてから複製して返す（消費とのレース回避）。
- `replay`: 同キーの保存があればそれを Response として返す。なければ自動で live にフォールバックして保存
  （= 初回実・以降リプレイ）。
- スコープ: 観測 run は固定の擬似 `ownerUserId`（env `OBSERVE_OWNER_ID`）を使う。snapshot はこの owner の
  実データに紐づくため、owner を固定すればリプレイで再現する。

## サーバ API（server.ts、:3030）

Vite を `middlewareMode` で起動し、UI を HMR 配信しつつ API を生やす。`ssrLoadModule` で
`src/lib/agent/run.ts` 等をエイリアス解決込みで読む（新依存なし）。`.env.local` を読み込んで
API キー / `RAG_SERVICE_URL` を有効化。

| エンドポイント | 役割 |
|---|---|
| `GET /api/defaults?locale=&model=&cfg=` | その条件での既定プロンプト5種と `AgentCfg` 既定を返す（編集欄プリフィル用） |
| `POST /api/run`（SSE） | `{query, model, locale, cfg, overrides, retrieveMode}` を受け、`createObserver()`＋`setRagTransport()` をセットして `runAgent` を実行。`AgentEvent`（既存ステップ/回答）と `LlmTrace`（生プロンプト/生出力）の**両方**を SSE 逐次送出。finally で transport 解除 |
| `GET /api/snapshots` / `DELETE /api/snapshots` | リプレイ用スナップショットの一覧/クリア |

## UI（ui/、React）

```
┌─────────────────────────┬──────────────────────────────────┐
│ 質問 [____________] ▶Run │  実行トレース（SSE 逐次）          │
│ model ▾  locale ▾        │  ▸ 1 chat      [overridden] 1.2s  │
│ retrieve: ○live ●replay  │    ├ system / messages / tools    │
│ cfg: topK[] verify[✓]…   │    └ 出力(stream 全文) + usage     │
│                          │  ▸ 2 grade     820ms              │
│ ── プロンプト上書き ──    │    ├ system / 入力JSON            │
│ [chat   ▾] <textarea>    │    └ 生JSON出力                   │
│ [grade  ▾] <textarea>    │  ▸ 3 verify …                    │
│ [rewrite▾] …             │  ▸ 4 revise …                    │
│ [verify ▾] …             │  ─ 最終回答（検証後 / verify差分） │
│ [revise ▾] …             │  ─ 引用パネル                     │
│ [既定に戻す] [JSON保存]   │  [トレース全体を .json で保存]     │
└─────────────────────────┴──────────────────────────────────┘
```

- 各プロンプト欄は折りたたみ、空なら上書きせず既定使用。`overridden` バッジで差し替わった呼び出しを明示。
- structured 出力は整形 JSON、stream は全文（delta 連結）。
- トレース1件 / 全体を JSON で保存できる。

## アプリ本体からの隔離の方針

- ツールコードは **`src/` の外**（`tools/observatory/`）に置き、Next のビルド/バンドル対象に入れない
  （`src` 内のどこからも import しない）。
- ツールは独自 `tools/observatory/tsconfig.json` を持ち、root の `tsc --noEmit` / `pnpm lint` / `pnpm test`
  の対象から外す（root tsconfig / eslint / vitest の include を `tools/` に広げない）。ツール側の型/lint は
  必要なら独立して回す。
- `src/` に残る痕跡は dev 専用シーム2個のみ。`observe?` は未指定で完全不活性、`setRagTransport` は
  `NODE_ENV==="production"` で拒否。
- `snapshots/` は `.gitignore` に追加（実データのスナップショットを誤コミットしない）。
- `package.json` に `"observe": "node ... tools/observatory/server.ts"`（または vite 経由）を追加。
  これはアプリの dev/build スクリプトとは独立。

## テスト

- `observe.ts`: 役割判定（4 system の一致/不一致フォールバック）、stream パススルーが消費を壊さないこと、
  override 適用、をユニットテスト（vitest、ツール独自スコープ）。
- `replay.ts`: live→保存→replay でバイト一致、stream バッファ複製、未保存キーの live フォールバック。
- run.ts シーム: `observe` 未指定で既存テストが全て不変（回帰なし）。`observe` 指定時に全役割の trace が
  出ることを、モデルをスタブして検証。
- 手動 E2E: フルスタック起動 → `pnpm observe` → 実検索1回 → replay 固定 → chat system だけ書き換えて差分を目視。

## 非目標（YAGNI）

- トレースの永続蓄積・横断検索。
- 質問データセットによる自動評価・回帰スコアリング。
- プロンプト編集のファイル書き戻し（保存ボタン）。当面はエフェメラル上書きのみ。
- 本番（アプリ）への観測機能の常時組み込み。
