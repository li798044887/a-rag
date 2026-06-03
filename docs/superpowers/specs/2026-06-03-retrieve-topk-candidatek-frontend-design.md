# top_k / candidate_k のフロント可編集化 設計

- 日付: 2026-06-03
- 対象: ベクトル検索・BM25 検索の件数パラメータをユーザー設定として開放する

## 背景・目的

検索パイプラインには 2 つの件数パラメータがある。

- **`candidate_k`（既定 10）** — ベクトル（dense）検索と BM25（sparse）検索それぞれで集める候補プールの件数。リランク対象になる。ユーザーの言う「10 条」はこれ。
- **`top_k`（既定 6）** — リランク後に回答へ渡る最終件数。

Python rag 側（`rag/app/schemas.py` の `RetrieveRequest`）は既に `top_k: int = Field(default=6, ge=1, le=50)` と `candidate_k: int = Field(default=10, ge=1, le=500)` をリクエストパラメータとして受け取り、範囲検証している。一方 TS 側（`src/lib/agent/tools.ts`）は `RETRIEVE_TOP_K = 6` / `RETRIEVE_CANDIDATE_K = 10` を定数で固定している。

つまり rag API は可変対応済みで、TS 側が固定しているだけ。本変更は、既存の `AgentCfg`（エージェント挙動設定）の仕組みに 2 パラメータを相乗りさせ、設定パネルから編集可能にする。

## データフロー

既存の `maxSteps` / `parallelTools` とまったく同じ経路に乗せる。

```
settings-modal（UI 入力）
  → use-agent-cfg（localStorage 永続 + clampAgentCfg）
  → chat route が clampAgentCfg で正規化
  → runAgent(agentCfg)
  → buildTools({ topK, candidateK })
  → retrieveChunksStream（topK / candidateK を送信）
  → Python rag（top_k / candidate_k は受領・検証済み）
```

## 変更点

### 1. 型（`src/lib/types.ts`）

`AgentCfg` インターフェースに 2 フィールドを追加（日本語コメント付き）。

```ts
/** リランク後に回答へ渡す最終チャンク数 */
topK: number;
/** ベクトル/BM25 検索それぞれの候補プール件数（リランク対象） */
candidateK: number;
```

### 2. 設定の既定値・境界・正規化（`src/lib/agent/config.ts`）

- `AGENT_CFG_DEFAULTS` に `topK: 6` / `candidateK: 10` を追加。
- 範囲定数を追加: `TOP_K_MIN = 1` / `TOP_K_MAX = 20`、`CANDIDATE_K_MIN = 1` / `CANDIDATE_K_MAX = 50`。
- `clampAgentCfg` で両者を `clampInt` し、最後に **`candidateK = Math.max(candidateK, topK)`** を適用して `candidate_k ≥ top_k` 制約をフロント側で担保する。

### 3. ツール（`src/lib/agent/tools.ts`）

- 定数 `RETRIEVE_TOP_K` / `RETRIEVE_CANDIDATE_K` を削除。
- `BuildToolsInput` に `topK?: number` / `candidateK?: number` を追加（未指定時は `AGENT_CFG_DEFAULTS` の値にフォールバック）。
- `retrieve` の `retrieveChunksStream` 呼び出しで、定数の代わりにこの値を渡す。

### 4. 統括（`src/lib/agent/run.ts`）

`buildTools` 呼び出し（現 61 行目）に `topK: cfg.topK, candidateK: cfg.candidateK` を追加する。

### 5. UI（`src/components/modals/settings-modal.tsx`）

agent セクション（`section === "agent"`）に、既存の `maxSteps` / `parallelTools` と同じ `Field` + `<input type="number">` パターンで 2 項目を追加する。

- top_k 入力: `min={TOP_K_MIN}` `max={TOP_K_MAX}`
- candidate_k 入力: `min={CANDIDATE_K_MIN}` `max={CANDIDATE_K_MAX}`

`setAgentCfg("topK", Number(...))` / `setAgentCfg("candidateK", Number(...))` で更新（clamp は `clampAgentCfg` 側が担う）。

### 6. i18n（`locales/zh/modals.ts` を出所、ja は parity）

zh が唯一の出所。以下 4 キーを zh に追加し、ja にも対応キーを追加する。

- `agentTopKLabel` / `agentTopKHint`
- `agentCandidateKLabel` / `agentCandidateKHint`

ヒントは「最終件数」「候補プール件数（多いほど精度↑だが遅くなる）」の趣旨を、zh は RAG 専門家視点、ja は自然な日本語で記述する。既存コメントは触らない。

## テスト

- **`src/lib/agent/config.test.ts`**（無ければ新規）: `clampAgentCfg` の境界テスト。`topK` / `candidateK` の上下限クランプ、不正値（NaN・非数）のフォールバック、`candidateK < topK` のときに `candidateK` が `topK` まで引き上げられることを検証。
- **`src/lib/agent/tools.test.ts`**: 既存の「candidateK: 10」アサート（現 50 行目付近）を、`buildTools` に渡した `topK` / `candidateK` が `retrieveChunksStream` へ透過することの検証に更新。
- **i18n parity テスト**: ja に同名キーを追加することで自動的に通る。

## 設計上の判断（確定事項）

- **公開範囲**: top_k と candidate_k の両方を開放する。
- **candidate_k 上限**: 50。latency 配慮（Python の `le=500` 範囲内に収める）。
- **`candidate_k ≥ top_k` 制約**: フロント `clampAgentCfg` でのみ担保する。rag 側スキーマは現状維持（多層防御は今回スコープ外）。

## スコープ外

- rag 側（`rag/app/schemas.py`）への `candidate_k ≥ top_k` バリデーション追加。
- ベクトルと BM25 で candidate_k を別々に設定する機能（現状は共通）。
- candidate_k 上限を 50 超に拡張する UI。
