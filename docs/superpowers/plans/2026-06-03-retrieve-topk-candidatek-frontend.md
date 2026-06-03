# top_k / candidate_k フロント可編集化 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ベクトル/BM25 検索の候補件数 `candidateK`（既定 10）とリランク後の最終件数 `topK`（既定 6）を、既存のエージェント設定パネルからユーザーが編集できるようにする。

**Architecture:** 既存の `AgentCfg`（localStorage 永続 → chat route → runAgent → buildTools）の経路に 2 フィールドを相乗りさせる。Python rag 側は `top_k` / `candidate_k` を既に受領・検証済みのため変更不要。`candidate_k ≥ top_k` 制約はフロントの `clampAgentCfg` で担保する。

**Tech Stack:** TypeScript / React 19 / Next.js 16 / Vitest / Tailwind v4 / i18n（zh 出所 + ja parity）

**規約:** コミットメッセージとコード内コメントは日本語。Conventional Commits。zh が i18n の唯一の出所。

---

### Task 1: 型に topK / candidateK を追加

**Files:**
- Modify: `src/lib/types.ts`（`AgentCfg` インターフェース、現 225 行付近）

- [ ] **Step 1: `AgentCfg` にフィールドを追加**

`src/lib/types.ts` の `AgentCfg` 内、`admitUnknown` の直後（`}` の手前）に追加する。

```ts
  /** 回答中の各事実に引用を付けることを強制 */
  requireCitations: boolean;
  /** 未知の場合に「わからない」と返す */
  admitUnknown: boolean;
  /** リランク後に回答へ渡す最終チャンク数 */
  topK: number;
  /** ベクトル/BM25 検索それぞれの候補プール件数（リランク対象） */
  candidateK: number;
}
```

- [ ] **Step 2: 型チェックで他の参照箇所が壊れていないか確認**

Run: `pnpm exec tsc --noEmit`
Expected: `AGENT_CFG_DEFAULTS` が `topK` / `candidateK` を欠くため `src/lib/agent/config.ts` でエラーが出る（Task 2 で解消）。それ以外の新規エラーが無いことを確認する。

- [ ] **Step 3: コミット**

```bash
git add src/lib/types.ts
git commit -m "feat: AgentCfg に topK / candidateK を追加"
```

---

### Task 2: config に既定値・境界・clamp（candidateK ≥ topK 制約）を実装

**Files:**
- Modify: `src/lib/agent/config.ts`
- Test: `src/lib/agent/config.test.ts`

- [ ] **Step 1: 失敗するテストを追記**

`src/lib/agent/config.test.ts` の `clampAgentCfg clamps numbers into range and rounds` テストの直後に、以下 2 テストを追加する。

```ts
test("clampAgentCfg clamps topK / candidateK into range", () => {
  expect(clampAgentCfg({ topK: 0 }).topK).toBe(1);
  expect(clampAgentCfg({ topK: 100 }).topK).toBe(20);
  expect(clampAgentCfg({ candidateK: 0 }).candidateK).toBe(1);
  expect(clampAgentCfg({ candidateK: 999 }).candidateK).toBe(50);
  expect(clampAgentCfg({ topK: "abc" }).topK).toBe(AGENT_CFG_DEFAULTS.topK);
});

test("clampAgentCfg は candidateK を topK 以上へ引き上げる", () => {
  // candidateK(3) < topK(8) のとき candidateK は topK まで引き上げられる
  expect(clampAgentCfg({ topK: 8, candidateK: 3 }).candidateK).toBe(8);
  // candidateK が十分大きければそのまま
  expect(clampAgentCfg({ topK: 6, candidateK: 20 }).candidateK).toBe(20);
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `pnpm test src/lib/agent/config.test.ts`
Expected: FAIL（`topK` / `candidateK` が `undefined`、新テストが落ちる）

- [ ] **Step 3: config.ts に既定値・境界・clamp を実装**

`src/lib/agent/config.ts` の `AGENT_CFG_DEFAULTS` を更新する。

```ts
export const AGENT_CFG_DEFAULTS: AgentCfg = {
  maxSteps: 12,
  parallelTools: 3,
  requireCitations: true,
  admitUnknown: true,
  topK: 6,
  candidateK: 10,
};
```

`PARALLEL_MAX` 定数の直後に範囲定数を追加する。

```ts
export const PARALLEL_MIN = 1;
export const PARALLEL_MAX = 8;
export const TOP_K_MIN = 1;
export const TOP_K_MAX = 20;
export const CANDIDATE_K_MIN = 1;
export const CANDIDATE_K_MAX = 50;
```

`clampAgentCfg` の return オブジェクトに 2 フィールドを追加し、return 前に制約を適用する。

```ts
export function clampAgentCfg(raw: unknown): AgentCfg {
  const o =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const topK = clampInt(o.topK, TOP_K_MIN, TOP_K_MAX, AGENT_CFG_DEFAULTS.topK);
  // candidate_k は最終件数 top_k 以上でなければ意味をなさないため引き上げる。
  const candidateK = Math.max(
    clampInt(o.candidateK, CANDIDATE_K_MIN, CANDIDATE_K_MAX, AGENT_CFG_DEFAULTS.candidateK),
    topK,
  );
  return {
    maxSteps: clampInt(o.maxSteps, MAX_STEPS_MIN, MAX_STEPS_MAX, AGENT_CFG_DEFAULTS.maxSteps),
    parallelTools: clampInt(o.parallelTools, PARALLEL_MIN, PARALLEL_MAX, AGENT_CFG_DEFAULTS.parallelTools),
    requireCitations: asBool(o.requireCitations, AGENT_CFG_DEFAULTS.requireCitations),
    admitUnknown: asBool(o.admitUnknown, AGENT_CFG_DEFAULTS.admitUnknown),
    topK,
    candidateK,
  };
}
```

注意: `candidateK` の clamp 上限は 50 だが、`topK` の上限は 20 なので `Math.max` 後も 50 を超えない。

- [ ] **Step 4: テストを実行して成功を確認**

Run: `pnpm test src/lib/agent/config.test.ts`
Expected: PASS（全テスト）。既存の `returns defaults for null` テストも `AGENT_CFG_DEFAULTS` に追加済みの `topK:6 / candidateK:10` を含んで通る。

- [ ] **Step 5: コミット**

```bash
git add src/lib/agent/config.ts src/lib/agent/config.test.ts
git commit -m "feat: clampAgentCfg に topK/candidateK の境界と candidateK>=topK 制約を追加"
```

---

### Task 3: buildTools が topK / candidateK を受け取り検索へ渡す

**Files:**
- Modify: `src/lib/agent/tools.ts`
- Test: `src/lib/agent/tools.test.ts`

- [ ] **Step 1: 既存テストを「透過」検証へ更新**

`src/lib/agent/tools.test.ts` の `retrieve tool uses a bounded rerank candidate count` テスト（現 42 行付近）を、以下に置き換える。

```ts
test("retrieve tool は渡した topK / candidateK を検索へ透過する", async () => {
  const reg = new CitationRegistry();
  const meta = new Map();
  const tools = buildTools({
    registry: reg, ownerUserId: "u1", meta, bus: new StepBus(),
    prompts: getAgentPrompts("ja"), topK: 8, candidateK: 30,
  });

  await tools.retrieve.execute!({ query: "認証" }, { toolCallId: "call-candidates", messages: [] } as never);

  expect(vi.mocked(retrieveChunksStream)).toHaveBeenLastCalledWith(
    expect.objectContaining({ topK: 8, candidateK: 30 }));
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `pnpm test src/lib/agent/tools.test.ts`
Expected: FAIL（`buildTools` が `topK` / `candidateK` を無視し、定数 `topK:6 / candidateK:10` を送るため）

- [ ] **Step 3: tools.ts を実装**

`src/lib/agent/tools.ts` の定数 2 行（現 31-32 行）を削除する。

```ts
const RETRIEVE_TOP_K = 6;
const RETRIEVE_CANDIDATE_K = 10;
```

`BuildToolsInput` の `concurrency?` の直後にフィールドを追加する。

```ts
  /** ツール execute の同時実行上限。未指定なら既定の並列数。 */
  concurrency?: number;
  /** リランク後の最終件数。未指定なら既定値。 */
  topK?: number;
  /** ベクトル/BM25 検索の候補プール件数。未指定なら既定値。 */
  candidateK?: number;
}
```

`buildTools` の引数分割代入に `topK` / `candidateK` を追加し、関数冒頭でフォールバックを解決する。

```ts
export function buildTools({ registry, ownerUserId, meta, bus, attachmentDocIds, prompts, concurrency, topK, candidateK }: BuildToolsInput): ToolSet {
  const sema = new Semaphore(concurrency ?? AGENT_CFG_DEFAULTS.parallelTools);
  const resolvedTopK = topK ?? AGENT_CFG_DEFAULTS.topK;
  const resolvedCandidateK = candidateK ?? AGENT_CFG_DEFAULTS.candidateK;
```

`retrieveChunksStream` 呼び出しの `topK` / `candidateK` を差し替える。

```ts
        const chunks = await retrieveChunksStream({
          query, ownerUserId, topK: resolvedTopK, candidateK: resolvedCandidateK,
          documentIds: attachmentDocIds && attachmentDocIds.length ? attachmentDocIds : undefined,
          onStage: (ev) => bus.push(stageToEvent(ev, toolCallId, query, prompts)),
        });
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `pnpm test src/lib/agent/tools.test.ts`
Expected: PASS（全テスト）

- [ ] **Step 5: コミット**

```bash
git add src/lib/agent/tools.ts src/lib/agent/tools.test.ts
git commit -m "feat: buildTools が topK/candidateK を受け取り検索へ渡す"
```

---

### Task 4: runAgent が cfg.topK / cfg.candidateK を buildTools へ渡す

**Files:**
- Modify: `src/lib/agent/run.ts`（現 61 行付近の `buildTools` 呼び出し）

- [ ] **Step 1: buildTools 呼び出しに 2 引数を追加**

`src/lib/agent/run.ts` の `buildTools` 呼び出しを更新する。

```ts
    const tools = buildTools({ registry, ownerUserId, meta, bus, attachmentDocIds, prompts, concurrency: cfg.parallelTools, topK: cfg.topK, candidateK: cfg.candidateK });
```

- [ ] **Step 2: 型チェック**

Run: `pnpm exec tsc --noEmit`
Expected: エラーなし

- [ ] **Step 3: コミット**

```bash
git add src/lib/agent/run.ts
git commit -m "feat: runAgent が cfg.topK/candidateK を buildTools へ渡す"
```

---

### Task 5: i18n キーを追加（zh 出所 + ja parity）

**Files:**
- Modify: `src/i18n/locales/zh/modals.ts`（現 31 行、`agentAdmitUnknownLabel` 付近）
- Modify: `src/i18n/locales/ja/modals.ts`（現 29 行、`agentAdmitUnknownLabel` 付近）

- [ ] **Step 1: zh にキーを追加**

`src/i18n/locales/zh/modals.ts` の `agentAdmitUnknownLabel` 行の直後に追加する。

```ts
  agentTopKLabel: "返回片段数",
  agentTopKHint: "重排序后传入回答的最终片段数（top_k）",
  agentCandidateKLabel: "候选池大小",
  agentCandidateKHint: "向量/关键词检索各自的候选数量（candidate_k），越大召回越全但越慢",
```

- [ ] **Step 2: ja にキーを追加**

`src/i18n/locales/ja/modals.ts` の `agentAdmitUnknownLabel` 行の直後に追加する。

```ts
  agentTopKLabel: "返却チャンク数",
  agentTopKHint: "リランク後に回答へ渡す最終チャンク数（top_k）",
  agentCandidateKLabel: "候補プール件数",
  agentCandidateKHint: "ベクトル/キーワード検索それぞれの候補件数（candidate_k）。多いほど再現率は上がるが遅くなる",
```

- [ ] **Step 3: i18n parity テストを実行**

Run: `pnpm test src/i18n/dictionary.test.ts`
Expected: PASS（zh と ja のキーが対等）

- [ ] **Step 4: コミット**

```bash
git add src/i18n/locales/zh/modals.ts src/i18n/locales/ja/modals.ts
git commit -m "feat: top_k/candidate_k 設定の i18n 文言を追加"
```

---

### Task 6: 設定モーダルの agent セクションに入力を追加

**Files:**
- Modify: `src/components/modals/settings-modal.tsx`（`section === "agent"` ブロック、現 385-420 行）

- [ ] **Step 1: 範囲定数を import**

`src/components/modals/settings-modal.tsx` の既存 import 群に追加する（`@/lib/agent/config` からの既存 import が無ければ新規行を追加）。

```ts
import { TOP_K_MIN, TOP_K_MAX, CANDIDATE_K_MIN, CANDIDATE_K_MAX } from "@/lib/agent/config";
```

- [ ] **Step 2: agent セクションに 2 つの Field を追加**

`section === "agent"` ブロック内、`agentParallelToolsLabel` の `Field` の直後（`requireCitations` の `Field` の前）に追加する。

```tsx
                <Field label={t.modals.agentTopKLabel} hint={t.modals.agentTopKHint}>
                  <input
                    type="number"
                    min={TOP_K_MIN}
                    max={TOP_K_MAX}
                    value={agentCfg.topK}
                    onChange={(e) => setAgentCfg("topK", Number(e.target.value))}
                    className={fieldInput}
                  />
                </Field>
                <Field label={t.modals.agentCandidateKLabel} hint={t.modals.agentCandidateKHint}>
                  <input
                    type="number"
                    min={CANDIDATE_K_MIN}
                    max={CANDIDATE_K_MAX}
                    value={agentCfg.candidateK}
                    onChange={(e) => setAgentCfg("candidateK", Number(e.target.value))}
                    className={fieldInput}
                  />
                </Field>
```

注意: clamp（`candidateK ≥ topK` 含む）は `setAgentCfg` → `clampAgentCfg`（use-agent-cfg.ts）が担うため、ここでは生値を渡すだけでよい。

- [ ] **Step 3: 型チェック + lint**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: エラーなし

- [ ] **Step 4: コミット**

```bash
git add src/components/modals/settings-modal.tsx
git commit -m "feat: 設定パネルに top_k/candidate_k の入力を追加"
```

---

### Task 7: 全体検証

- [ ] **Step 1: 単体テスト全件**

Run: `pnpm test`
Expected: PASS（config / tools / dictionary 含む全件）

- [ ] **Step 2: 型チェック + lint + ビルド**

Run: `pnpm exec tsc --noEmit && pnpm lint && pnpm build`
Expected: すべて成功

- [ ] **Step 3: 手動確認（任意）**

`pnpm dev` で起動 → 設定 → エージェントタブを開き、「返却チャンク数」「候補プール件数」の入力が表示され、値変更が localStorage（`arag:agent-cfg`）に永続することを確認する。candidate を top_k 未満にしてリロード後、top_k まで引き上げられていることを確認する。
