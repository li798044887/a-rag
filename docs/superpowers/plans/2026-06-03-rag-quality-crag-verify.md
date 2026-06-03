# 回答品質向上（CRAG 風 grade→再検索 + 根拠検証）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 既存の TS / AI SDK 統括ループを温存したまま、`retrieve` を CRAG 化（grade→不足なら rewrite+再検索）し、生成をバッファ化して根拠検証→必要なら訂正再生成→確定ストリームする 2 ノードを追加し、回答品質を高める。

**Architecture:** LangGraph は導入しない（C先行方針）。生成「前」のノード（grade→再検索）は `src/lib/agent/tools.ts` の retrieve ツール内に内包し、生成「後」のノード（verify→revise）は `src/lib/agent/run.ts` の生成バッファ化として実装する。新規 LLM 呼び出しは既存の安価モデル `ResolvedModels.rewrite` を流用し、引用は既存 `CitationRegistry` を根拠に検証する。

**Tech Stack:** TypeScript / Vercel AI SDK（`ai` の `streamText`/`generateObject`/`generateText`）/ Zod / Vitest。設計書: `docs/superpowers/specs/2026-06-03-langgraph-rag-quality-design.md`。

---

## ファイル構成（責務）

| ファイル | 区分 | 責務 |
|---|---|---|
| `src/lib/types.ts` | 変更 | `ToolName` に `grade`/`verify`/`revise` を追加。`AgentCfg` に `maxRetrieveRetries`/`gradeThreshold`/`maxRevisions`/`verify` を追加 |
| `src/lib/agent/config.ts` | 変更 | 新 cfg の既定値・境界・clamp |
| `src/lib/agent/citations.ts` | 変更 | verify 用に登録済み出典を列挙する `listSources()` を追加 |
| `src/lib/agent/prompts.ts` | 変更 | grade/queryRewrite/verify/revise のプロンプト断片を zh（出所）+ ja で追加 |
| `src/lib/agent/grade.ts` | 新規 | 取得チャンクの関連度判定（ハイブリッド: 閾値ゲート＋曖昧帯のみ LLM） |
| `src/lib/agent/verify.ts` | 新規 | groundedness 検証と訂正再生成 |
| `src/lib/agent/tools.ts` | 変更 | retrieve に grade→rewrite→再検索ループを内包 |
| `src/lib/agent/run.ts` | 変更 | 生成バッファ化＋verify/revise＋確定ストリーム。buildTools へモデル/cfg を配線 |

各タスクは独立にテストでき、Task 1→8 の順で価値を積み上げる。

---

## Task 1: 型と設定（AgentCfg / ToolName 拡張）

**Files:**
- Modify: `src/lib/types.ts`（`ToolName` 約 35-48 行、`AgentCfg` 約 225-239 行）
- Modify: `src/lib/agent/config.ts`
- Test: `src/lib/agent/config.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/agent/config.test.ts` の末尾に追記:

```ts
import { AGENT_CFG_DEFAULTS, clampAgentCfg } from "@/lib/agent/config";

test("clampAgentCfg は新フィールドの既定値を埋める", () => {
  const cfg = clampAgentCfg({});
  expect(cfg.maxRetrieveRetries).toBe(AGENT_CFG_DEFAULTS.maxRetrieveRetries);
  expect(cfg.gradeThreshold).toBe(AGENT_CFG_DEFAULTS.gradeThreshold);
  expect(cfg.maxRevisions).toBe(AGENT_CFG_DEFAULTS.maxRevisions);
  expect(cfg.verify).toBe(AGENT_CFG_DEFAULTS.verify);
});

test("clampAgentCfg は範囲外の新フィールドを丸める", () => {
  const cfg = clampAgentCfg({ maxRetrieveRetries: 9, gradeThreshold: 5, maxRevisions: 9, verify: false });
  expect(cfg.maxRetrieveRetries).toBe(2); // 上限 2
  expect(cfg.gradeThreshold).toBeLessThanOrEqual(1);
  expect(cfg.gradeThreshold).toBeGreaterThanOrEqual(0);
  expect(cfg.maxRevisions).toBe(1); // 上限 1
  expect(cfg.verify).toBe(false);
});

test("clampAgentCfg は負値の retries/revisions を 0 に丸める", () => {
  const cfg = clampAgentCfg({ maxRetrieveRetries: -3, maxRevisions: -1 });
  expect(cfg.maxRetrieveRetries).toBe(0);
  expect(cfg.maxRevisions).toBe(0);
});
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `pnpm test src/lib/agent/config.test.ts`
Expected: FAIL（`maxRetrieveRetries` 等が undefined）

- [ ] **Step 3: 型を追加**

`src/lib/types.ts` の `ToolName` ユニオンに 3 値を追加（既存の `| "expand"` の後など）:

```ts
  | "expand"
  | "grade"
  | "verify"
  | "revise"
  | "fetch_document"
```

`src/lib/types.ts` の `AgentCfg` インターフェース末尾（`candidateK: number;` の後）に追加:

```ts
  /** grade で関連資料が不足のときに再検索する最大回数（0=無効） */
  maxRetrieveRetries: number;
  /** grade のリランクスコア閾値（0–1）。これ以上を関連、近傍のみ LLM 判定 */
  gradeThreshold: number;
  /** 根拠検証で未裏付けがあったとき訂正再生成する最大回数（0=無効, 上限1） */
  maxRevisions: number;
  /** 生成後の根拠検証フェーズを有効にするか */
  verify: boolean;
```

- [ ] **Step 4: config を実装**

`src/lib/agent/config.ts` の `AGENT_CFG_DEFAULTS` に追加:

```ts
  topK: 6,
  candidateK: 10,
  maxRetrieveRetries: 1,
  gradeThreshold: 0.5,
  maxRevisions: 1,
  verify: true,
```

境界定数を既存定数群（`CANDIDATE_K_MAX` の後）に追加:

```ts
export const RETRIEVE_RETRIES_MIN = 0;
export const RETRIEVE_RETRIES_MAX = 2;
export const REVISIONS_MIN = 0;
export const REVISIONS_MAX = 1;
export const GRADE_THRESHOLD_MIN = 0;
export const GRADE_THRESHOLD_MAX = 1;
```

`clampInt` の隣に小数クランプを追加:

```ts
function clampFloat(raw: unknown, min: number, max: number, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
```

`clampAgentCfg` の return オブジェクトに追加（`candidateK,` の後）:

```ts
    maxRetrieveRetries: clampInt(o.maxRetrieveRetries, RETRIEVE_RETRIES_MIN, RETRIEVE_RETRIES_MAX, AGENT_CFG_DEFAULTS.maxRetrieveRetries),
    gradeThreshold: clampFloat(o.gradeThreshold, GRADE_THRESHOLD_MIN, GRADE_THRESHOLD_MAX, AGENT_CFG_DEFAULTS.gradeThreshold),
    maxRevisions: clampInt(o.maxRevisions, REVISIONS_MIN, REVISIONS_MAX, AGENT_CFG_DEFAULTS.maxRevisions),
    verify: asBool(o.verify, AGENT_CFG_DEFAULTS.verify),
```

- [ ] **Step 5: テストが通ることを確認**

Run: `pnpm test src/lib/agent/config.test.ts`
Expected: PASS

- [ ] **Step 6: コミット**

```bash
git add src/lib/types.ts src/lib/agent/config.ts src/lib/agent/config.test.ts
git commit -m "feat: CRAG/検証用の AgentCfg と ToolName を追加"
```

---

## Task 2: CitationRegistry に listSources を追加

**Files:**
- Modify: `src/lib/agent/citations.ts`
- Test: `src/lib/agent/citations.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/agent/citations.test.ts` に追記:

```ts
test("listSources は登録順に n 付きの出典スナップショットを返す", () => {
  const reg = new CitationRegistry();
  reg.register({ documentId: "d1", documentTitle: "A.pdf", chunkId: "c1", headingPath: "h1", snippet: "本文1", blockType: "text", page: 1, score: 0.9 });
  reg.register({ documentId: "d1", documentTitle: "A.pdf", chunkId: "c2", headingPath: "h2", snippet: "本文2", blockType: "text", page: 2 });
  const list = reg.listSources();
  expect(list).toEqual([
    { n: 1, title: "A.pdf", heading: "h1", snippet: "本文1" },
    { n: 2, title: "A.pdf", heading: "h2", snippet: "本文2" },
  ]);
});
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `pnpm test src/lib/agent/citations.test.ts`
Expected: FAIL（`listSources` 未定義）

- [ ] **Step 3: 実装**

`src/lib/agent/citations.ts` の `get size()` の直前に追加:

```ts
  /** verify 用に、登録済み出典を引用番号 n 付きで列挙する（登録順）。 */
  listSources(): { n: number; title: string; heading: string; snippet: string }[] {
    return this.order.map((c, i) => ({
      n: i + 1, title: c.documentTitle, heading: c.headingPath, snippet: c.snippet,
    }));
  }
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm test src/lib/agent/citations.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/lib/agent/citations.ts src/lib/agent/citations.test.ts
git commit -m "feat: 引用レジストリに listSources を追加"
```

---

## Task 3: プロンプト断片（grade/queryRewrite/verify/revise）

**Files:**
- Modify: `src/lib/agent/prompts.ts`（`AgentPrompts` インターフェースと `JA`/`ZH` 定数）
- Test: `src/lib/agent/prompts.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/agent/prompts.test.ts` に追記:

```ts
import { getAgentPrompts } from "@/lib/agent/prompts";

test("grade/verify/revise プロンプトが zh/ja 双方で揃う", () => {
  for (const loc of ["zh", "ja"] as const) {
    const p = getAgentPrompts(loc);
    expect(p.grade.label.length).toBeGreaterThan(0);
    expect(p.grade.system.length).toBeGreaterThan(0);
    expect(p.grade.done(1, 3).length).toBeGreaterThan(0);
    expect(p.queryRewrite.system.length).toBeGreaterThan(0);
    expect(p.verify.system.length).toBeGreaterThan(0);
    expect(p.verify.done(0).length).toBeGreaterThan(0);
    expect(p.verify.done(2).length).toBeGreaterThan(0);
    expect(p.revise.system.length).toBeGreaterThan(0);
    expect(p.revise.done.length).toBeGreaterThan(0);
  }
});
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `pnpm test src/lib/agent/prompts.test.ts`
Expected: FAIL（`p.grade` 未定義）

- [ ] **Step 3: インターフェースに型を追加**

`src/lib/agent/prompts.ts` の `AgentPrompts` インターフェース内（`toolErrorSummary: string;` の後など）に追加:

```ts
  /** grade（関連度判定）ノード。 */
  grade: {
    label: string;
    running: string;
    /** 曖昧帯チャンクの関連性を判定する LLM system。 */
    system: string;
    done: (kept: number, total: number) => string;
    /** 関連不足で再検索する際のサマリ。 */
    retry: string;
  };
  /** 再検索時のクエリ改善 LLM system。 */
  queryRewrite: { system: string };
  /** verify（根拠検証）ノード。 */
  verify: {
    label: string;
    running: string;
    system: string;
    done: (unsupported: number) => string;
  };
  /** revise（訂正再生成）ノード。 */
  revise: {
    label: string;
    running: string;
    system: string;
    done: string;
  };
```

- [ ] **Step 4: JA 定数に値を追加**

`const JA: AgentPrompts = {` 内（`fallback` の前など）に追加:

```ts
  grade: {
    label: "関連度判定",
    running: "取得結果の関連度を判定中…",
    system:
      "あなたは検索結果の関連性を判定する審査器です。ユーザーの質問に対し、各候補チャンクが回答の根拠になり得るかを判定し、" +
      "関連すると判断したチャンクの chunkId のみを返してください。確証が持てないものは含めないでください。",
    done: (k, t) => `${t} 件中 ${k} 件が関連`,
    retry: "関連資料が不足のため再検索",
  },
  queryRewrite: {
    system:
      "あなたは検索クエリを改善する補助器です。直前の検索では十分な関連資料が得られませんでした。" +
      "質問の意図を保ちつつ、語彙や言い回しを変えた自己完結な検索クエリを1つだけ返してください。",
  },
  verify: {
    label: "根拠検証",
    running: "回答の根拠を検証中…",
    system:
      "あなたは事実検証器です。回答中の各主張が、与えられた出典の記述で裏付けられるかを検証し、" +
      "裏付けの取れない主張だけを短く列挙してください。出典に明記されていない主張は未裏付けとみなします。",
    done: (n) => (n > 0 ? `未裏付けの主張 ${n} 件` : "全主張が出典で裏付け済み"),
  },
  revise: {
    label: "回答の訂正",
    running: "未裏付け箇所を訂正中…",
    system:
      "あなたは回答を訂正する編集器です。指摘された未裏付けの主張を、与えられた出典のみを根拠に書き直すか、" +
      "根拠が無ければ削除してください。出典に無い情報を新たに追加しないでください。出典番号 [n] の表記は保持してください。" +
      "訂正後の回答本文だけを返してください。",
    done: "未裏付け箇所を訂正",
  },
```

- [ ] **Step 5: ZH 定数に値を追加**

`const ZH: AgentPrompts = {` 内の同じ位置に追加:

```ts
  grade: {
    label: "相关性判定",
    running: "正在判定检索结果的相关性…",
    system:
      "你是检索结果相关性审查器。针对用户问题，判断每个候选片段是否能作为回答依据，" +
      "只返回你判定为相关的片段 chunkId。无法确定的不要包含。",
    done: (k, t) => `${t} 条中 ${k} 条相关`,
    retry: "相关资料不足，重新检索",
  },
  queryRewrite: {
    system:
      "你是检索查询改写助手。上一次检索未获得足够相关资料。" +
      "请在保持问题意图的前提下，更换措辞与表达，只返回一个自包含的检索查询。",
  },
  verify: {
    label: "依据校验",
    running: "正在校验回答依据…",
    system:
      "你是事实校验器。校验回答中每条主张是否被给定出处支撑，只简要列出无法被出处支撑的主张。" +
      "出处中未明确记载的主张视为无依据。",
    done: (n) => (n > 0 ? `无依据主张 ${n} 条` : "全部主张均有出处支撑"),
  },
  revise: {
    label: "修订回答",
    running: "正在修订无依据内容…",
    system:
      "你是回答修订编辑器。请将被指出的无依据主张仅依据给定出处重写，若无依据则删除。" +
      "不要新增出处中没有的信息。保留出处编号 [n] 标注。只返回修订后的回答正文。",
    done: "已修订无依据内容",
  },
```

- [ ] **Step 6: テストが通ることを確認**

Run: `pnpm test src/lib/agent/prompts.test.ts`
Expected: PASS

- [ ] **Step 7: コミット**

```bash
git add src/lib/agent/prompts.ts src/lib/agent/prompts.test.ts
git commit -m "feat: grade/検証/訂正のプロンプト断片を zh/ja に追加"
```

---

## Task 4: grade.ts（ハイブリッド関連度判定）

**Files:**
- Create: `src/lib/agent/grade.ts`
- Test: `src/lib/agent/grade.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/agent/grade.test.ts`:

```ts
import { expect, test, vi } from "vitest";

const generateObject = vi.fn();
vi.mock("ai", () => ({ generateObject: (...a: unknown[]) => generateObject(...a) }));

import { gradeChunks } from "@/lib/agent/grade";
import { getAgentPrompts } from "@/lib/agent/prompts";

const prompts = getAgentPrompts("ja");
const model = "m" as never;
const mk = (chunkId: string, score: number) => ({ chunkId, score, documentTitle: "A", headingPath: "h", text: "本文" });

test("全て強スコアなら LLM を呼ばず全件 kept・再検索なし", async () => {
  const r = await gradeChunks({ query: "q", chunks: [mk("c1", 0.9), mk("c2", 0.8)], threshold: 0.5, model, prompts });
  expect(generateObject).not.toHaveBeenCalled();
  expect(r.keptIds.sort()).toEqual(["c1", "c2"]);
  expect(r.needRetry).toBe(false);
});

test("曖昧帯のみ LLM 判定し、選ばれたものを kept に足す", async () => {
  generateObject.mockResolvedValueOnce({ object: { relevantIds: ["c2"] } });
  // threshold 0.5, margin 0.1 → c2=0.45 が曖昧帯, c3=0.1 は除外
  const r = await gradeChunks({ query: "q", chunks: [mk("c1", 0.9), mk("c2", 0.45), mk("c3", 0.1)], threshold: 0.5, model, prompts });
  expect(generateObject).toHaveBeenCalledTimes(1);
  expect(r.keptIds.sort()).toEqual(["c1", "c2"]);
  expect(r.needRetry).toBe(false);
});

test("関連が一件も無ければ needRetry=true", async () => {
  const r = await gradeChunks({ query: "q", chunks: [mk("c1", 0.05)], threshold: 0.5, model, prompts });
  expect(r.keptIds).toEqual([]);
  expect(r.needRetry).toBe(true);
});

test("空入力は needRetry=true", async () => {
  const r = await gradeChunks({ query: "q", chunks: [], threshold: 0.5, model, prompts });
  expect(r.needRetry).toBe(true);
});

test("LLM 失敗時は強スコアのみで素通し（throw しない）", async () => {
  generateObject.mockRejectedValueOnce(new Error("boom"));
  const r = await gradeChunks({ query: "q", chunks: [mk("c1", 0.9), mk("c2", 0.45)], threshold: 0.5, model, prompts });
  expect(r.keptIds).toEqual(["c1"]);
  expect(r.needRetry).toBe(false);
});
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `pnpm test src/lib/agent/grade.test.ts`
Expected: FAIL（`grade.ts` 未作成）

- [ ] **Step 3: 実装**

`src/lib/agent/grade.ts`:

```ts
/** 取得チャンクの関連度判定（ハイブリッド）。
 *  まず rerank スコア閾値で安価にゲートし、閾値近傍の曖昧帯のみ LLM 判定する。
 *  関連が一件も残らなければ needRetry=true を返し、呼び出し側が再検索する。 */
import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import type { AgentPrompts } from "@/lib/agent/prompts";

export interface GradeChunk {
  chunkId: string;
  score: number;
  documentTitle: string;
  headingPath: string;
  text: string;
}

export interface GradeResult {
  /** 関連と判断したチャンク ID（強スコア＋LLM 採択）。 */
  keptIds: string[];
  /** 関連が不足し再検索すべきか。 */
  needRetry: boolean;
  /** 判定対象の総数（サマリ表示用）。 */
  total: number;
}

/** 閾値からどれだけ下までを「曖昧帯」として LLM に回すか。 */
const AMBIGUOUS_MARGIN = 0.1;
/** これ未満しか関連が残らなければ再検索する。 */
const MIN_KEPT = 1;

export async function gradeChunks(input: {
  query: string;
  chunks: GradeChunk[];
  threshold: number;
  model: LanguageModel;
  prompts: AgentPrompts;
}): Promise<GradeResult> {
  const { query, chunks, threshold, model, prompts } = input;
  const total = chunks.length;

  const strong = chunks.filter((c) => c.score >= threshold);
  const ambiguous = chunks.filter((c) => c.score < threshold && c.score >= threshold - AMBIGUOUS_MARGIN);

  const kept = new Set(strong.map((c) => c.chunkId));

  if (ambiguous.length > 0) {
    try {
      const { object } = await generateObject({
        model,
        schema: z.object({ relevantIds: z.array(z.string()) }),
        system: prompts.grade.system,
        prompt: JSON.stringify({
          query,
          candidates: ambiguous.map((c) => ({
            chunkId: c.chunkId, title: c.documentTitle, heading: c.headingPath,
            text: c.text.slice(0, 600),
          })),
        }),
      });
      const valid = new Set(ambiguous.map((c) => c.chunkId));
      for (const id of object.relevantIds) if (valid.has(id)) kept.add(id);
    } catch {
      // LLM 失敗時は強スコアのみで続行（回答は必ず出す方針）。
    }
  }

  const keptIds = chunks.map((c) => c.chunkId).filter((id) => kept.has(id));
  return { keptIds, needRetry: keptIds.length < MIN_KEPT, total };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm test src/lib/agent/grade.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/lib/agent/grade.ts src/lib/agent/grade.test.ts
git commit -m "feat: ハイブリッド関連度判定 grade を追加"
```

---

## Task 5: verify.ts（根拠検証 + 訂正再生成）

**Files:**
- Create: `src/lib/agent/verify.ts`
- Test: `src/lib/agent/verify.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/agent/verify.test.ts`:

```ts
import { expect, test, vi } from "vitest";

const generateObject = vi.fn();
const generateText = vi.fn();
vi.mock("ai", () => ({
  generateObject: (...a: unknown[]) => generateObject(...a),
  generateText: (...a: unknown[]) => generateText(...a),
}));

import { verifyAnswer } from "@/lib/agent/verify";
import { getAgentPrompts } from "@/lib/agent/prompts";

const prompts = getAgentPrompts("ja");
const model = "m" as never;
const sources = [{ n: 1, title: "A", heading: "h", snippet: "トークンは24時間で失効する" }];

test("全主張が裏付けられていれば revise しない", async () => {
  generateObject.mockResolvedValueOnce({ object: { unsupported: [] } });
  const r = await verifyAnswer({ query: "q", answer: "失効します[1]。", sources, model, prompts, maxRevisions: 1 });
  expect(r.unsupported).toEqual([]);
  expect(r.revised).toBeNull();
  expect(generateText).not.toHaveBeenCalled();
});

test("未裏付けがあり maxRevisions>0 なら訂正本文を返す", async () => {
  generateObject.mockResolvedValueOnce({ object: { unsupported: ["48時間で失効する"] } });
  generateText.mockResolvedValueOnce({ text: "24時間で失効します[1]。" });
  const r = await verifyAnswer({ query: "q", answer: "48時間で失効します[1]。", sources, model, prompts, maxRevisions: 1 });
  expect(r.unsupported).toEqual(["48時間で失効する"]);
  expect(r.revised).toBe("24時間で失効します[1]。");
});

test("maxRevisions=0 なら未裏付けでも revise しない", async () => {
  generateObject.mockResolvedValueOnce({ object: { unsupported: ["x"] } });
  const r = await verifyAnswer({ query: "q", answer: "a[1]", sources, model, prompts, maxRevisions: 0 });
  expect(r.revised).toBeNull();
  expect(generateText).not.toHaveBeenCalled();
});

test("検証 LLM が失敗したら未裏付けなし扱いで素通し", async () => {
  generateObject.mockRejectedValueOnce(new Error("boom"));
  const r = await verifyAnswer({ query: "q", answer: "a[1]", sources, model, prompts, maxRevisions: 1 });
  expect(r.unsupported).toEqual([]);
  expect(r.revised).toBeNull();
});
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `pnpm test src/lib/agent/verify.test.ts`
Expected: FAIL（`verify.ts` 未作成）

- [ ] **Step 3: 実装**

`src/lib/agent/verify.ts`:

```ts
/** 生成回答の根拠検証（groundedness）と訂正再生成。
 *  回答中の主張を出典 snippet と突合し、未裏付けがあれば（上限内で）出典のみに基づき書き直す。 */
import { generateObject, generateText, type LanguageModel } from "ai";
import { z } from "zod";
import type { AgentPrompts } from "@/lib/agent/prompts";

export interface VerifySource {
  n: number;
  title: string;
  heading: string;
  snippet: string;
}

export interface VerifyResult {
  /** 出典で裏付けられない主張。 */
  unsupported: string[];
  /** 訂正再生成した本文（行わなかった場合は null）。 */
  revised: string | null;
}

export async function verifyAnswer(input: {
  query: string;
  answer: string;
  sources: VerifySource[];
  model: LanguageModel;
  prompts: AgentPrompts;
  maxRevisions: number;
}): Promise<VerifyResult> {
  const { query, answer, sources, model, prompts, maxRevisions } = input;

  let unsupported: string[] = [];
  try {
    const { object } = await generateObject({
      model,
      schema: z.object({ unsupported: z.array(z.string()) }),
      system: prompts.verify.system,
      prompt: JSON.stringify({ query, answer, sources }),
    });
    unsupported = object.unsupported;
  } catch {
    // 検証失敗時は素通し（回答は必ず出す方針）。
    return { unsupported: [], revised: null };
  }

  if (unsupported.length === 0 || maxRevisions <= 0) {
    return { unsupported, revised: null };
  }

  try {
    const { text } = await generateText({
      model,
      system: prompts.revise.system,
      prompt: JSON.stringify({ answer, unsupported, sources }),
    });
    return { unsupported, revised: text.trim() || null };
  } catch {
    return { unsupported, revised: null };
  }
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm test src/lib/agent/verify.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/lib/agent/verify.ts src/lib/agent/verify.test.ts
git commit -m "feat: 根拠検証と訂正再生成 verify を追加"
```

---

## Task 6: retrieve の CRAG 化（grade→rewrite→再検索ループ）

**Files:**
- Modify: `src/lib/agent/tools.ts`
- Test: `src/lib/agent/tools.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/agent/tools.test.ts` に追記（既存の retrieve-client モック方式に合わせる）。ファイル先頭の `ai` / `retrieve-client` モックに以下が無ければ追加し、テストを足す:

```ts
// ファイル冒頭のモック（既存になければ追加）
const generateObject = vi.fn();
const generateText = vi.fn();
// 既存の vi.mock("ai", ...) があれば generateObject/generateText を併せて返すよう拡張する。

test("grade が不足判定なら rewrite して再検索する", async () => {
  // 1回目は弱スコア（再検索を誘発）、2回目は強スコア
  vi.mocked(retrieveChunksStream)
    .mockImplementationOnce(async () => [
      { chunkId: "c1", documentId: "d1", documentTitle: "A", headingPath: "h", pageStart: 0, pageEnd: 0, blockType: "text", text: "弱", expandedText: "弱", score: 0.05 },
    ])
    .mockImplementationOnce(async () => [
      { chunkId: "c2", documentId: "d2", documentTitle: "B", headingPath: "h", pageStart: 0, pageEnd: 0, blockType: "text", text: "強", expandedText: "強", score: 0.9 },
    ]);
  generateText.mockResolvedValueOnce({ text: "改善クエリ" }); // queryRewrite

  const registry = new CitationRegistry();
  const meta = new Map();
  const bus = new StepBus();
  const tools = buildTools({
    registry, ownerUserId: "u1", meta, bus, prompts: getAgentPrompts("ja"),
    gradeModel: "m" as never, gradeThreshold: 0.5, maxRetrieveRetries: 1,
  });
  const events: AgentEvent[] = [];
  const drain = (async () => { for await (const e of bus) events.push(e); })();
  const out = await tools.retrieve.execute!({ query: "q" }, { toolCallId: "call-1", messages: [] } as never);
  bus.close();
  await drain;

  expect(retrieveChunksStream).toHaveBeenCalledTimes(2);
  expect(String(out)).toContain("強");
  expect(events.some((e) => e.type === "step" && e.step.name === "grade")).toBe(true);
  expect(events.some((e) => e.type === "step" && e.step.name === "rewrite_query" && e.step.parentId === "call-1")).toBe(true);
});

test("maxRetrieveRetries=0 なら grade のみで再検索しない", async () => {
  vi.mocked(retrieveChunksStream).mockImplementationOnce(async () => [
    { chunkId: "c1", documentId: "d1", documentTitle: "A", headingPath: "h", pageStart: 0, pageEnd: 0, blockType: "text", text: "弱", expandedText: "弱", score: 0.05 },
  ]);
  const tools = buildTools({
    registry: new CitationRegistry(), ownerUserId: "u1", meta: new Map(), bus: new StepBus(),
    prompts: getAgentPrompts("ja"), gradeModel: "m" as never, gradeThreshold: 0.5, maxRetrieveRetries: 0,
  });
  await tools.retrieve.execute!({ query: "q" }, { toolCallId: "c", messages: [] } as never);
  expect(retrieveChunksStream).toHaveBeenCalledTimes(1);
});
```

> 注: `tools.test.ts` 既存のトップに `CitationRegistry` / `StepBus` / `getAgentPrompts` / `AgentEvent` import が無ければ追加する。

- [ ] **Step 2: テストが落ちることを確認**

Run: `pnpm test src/lib/agent/tools.test.ts`
Expected: FAIL（`gradeModel` 等の引数が未対応 / grade ステップ無し）

- [ ] **Step 3: 実装**

`src/lib/agent/tools.ts` の `import` 群に追加:

```ts
import { generateText, type LanguageModel } from "ai";
import { gradeChunks } from "@/lib/agent/grade";
```

`BuildToolsInput` に追加:

```ts
  /** grade / 再検索クエリ生成に使う安価モデル。 */
  gradeModel: LanguageModel;
  /** grade のスコア閾値。 */
  gradeThreshold: number;
  /** 関連不足時の再検索の最大回数。 */
  maxRetrieveRetries: number;
```

`buildTools` の引数分割代入に `gradeModel, gradeThreshold, maxRetrieveRetries` を追加。

`retrieve` ツールの `execute` 本体を、CRAG ループ版に差し替える:

```ts
      execute: ({ query }, { toolCallId }) => sema.run(async () => {
        let q = query;
        let chunks = await retrieveChunksStream({
          query: q, ownerUserId, topK: resolvedTopK, candidateK: resolvedCandidateK,
          documentIds: attachmentDocIds && attachmentDocIds.length ? attachmentDocIds : undefined,
          onStage: (ev) => bus.push(stageToEvent(ev, toolCallId, q, prompts)),
        });

        // grade→不足なら rewrite して再検索（有限回）。grade は関連判定のみ。
        for (let retry = 0; retry <= maxRetrieveRetries; retry++) {
          const grade = await gradeChunks({
            query: q, threshold: gradeThreshold, model: gradeModel, prompts,
            chunks: chunks.map((c) => ({
              chunkId: c.chunkId, score: c.score, documentTitle: c.documentTitle,
              headingPath: c.headingPath, text: c.expandedText || c.text,
            })),
          });
          bus.push({ type: "step", step: {
            id: `${toolCallId}:grade`, name: "grade", parentId: toolCallId, label: prompts.grade.label,
            status: "done", durationMs: 0, input: {}, output: { kept: grade.keptIds.length, total: grade.total },
            summary: prompts.grade.done(grade.keptIds.length, grade.total),
          } });
          if (!grade.needRetry || retry >= maxRetrieveRetries) break;

          // 再検索クエリを生成（失敗したら再検索を打ち切る）。
          let rewritten = q;
          try {
            const { text } = await generateText({ model: gradeModel, system: prompts.queryRewrite.system, prompt: q });
            rewritten = text.trim() || q;
          } catch {
            break;
          }
          if (rewritten === q) break;
          bus.push({ type: "step", step: {
            id: `${toolCallId}:rewrite-retry-${retry}`, name: "rewrite_query", parentId: toolCallId,
            label: prompts.rewriteLabel, status: "done", durationMs: 0,
            input: { original: q, rewritten }, output: null, summary: prompts.rewriteSummary(rewritten),
          } });
          q = rewritten;
          chunks = await retrieveChunksStream({
            query: q, rewritten: q, ownerUserId, topK: resolvedTopK, candidateK: resolvedCandidateK,
            documentIds: attachmentDocIds && attachmentDocIds.length ? attachmentDocIds : undefined,
            onStage: (ev) => bus.push(stageToEvent(ev, toolCallId, q, prompts)),
          });
        }

        const lines = chunks.map((c) => {
          const n = registry.register({
            documentId: c.documentId, documentTitle: c.documentTitle, chunkId: c.chunkId,
            headingPath: c.headingPath,
            snippet: resolveImageUrls(
              c.blockType === "table" ? c.text : (c.expandedText || c.text),
              c.documentId,
            ),
            blockType: c.blockType, page: c.pageStart, score: c.score,
          });
          const body = resolveImageUrls(c.expandedText || c.text, c.documentId);
          return `[${n}] ${c.documentTitle} — ${c.headingPath}\n${body}`;
        });
        meta.set(toolCallId, { name: "retrieve", input: { query: q },
          summary: prompts.retrieveMetaSummary(q, chunks.length) });
        return lines.length ? lines.join("\n\n") : prompts.fallback.retrieveNoHits;
      }),
```

> 注: grade が throw しないこと（Task 4 でフォールバック済み）に依存。`gradeChunks` 自体は try/catch 内蔵だが、念のためループ全体での回答返却は保証される。

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm test src/lib/agent/tools.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/lib/agent/tools.ts src/lib/agent/tools.test.ts
git commit -m "feat: retrieve を CRAG 化（grade→rewrite→再検索）"
```

---

## Task 7: run.ts のバッファ化 + verify/revise + 確定ストリーム

**Files:**
- Modify: `src/lib/agent/run.ts`
- Test: `src/lib/agent/run.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/agent/run.test.ts` の冒頭 `vi.mock("ai", ...)` を、`generateObject`/`generateText` も返すよう拡張し、既定で「未裏付けなし」を返す。テストを追加:

```ts
// vi.mock("ai", ...) 内の return オブジェクトに追加:
//   generateObject: vi.fn(async () => ({ object: { unsupported: [] } })),
//   generateText: vi.fn(async () => ({ text: "" })),

test("生成はバッファ化され、根拠検証ステップの後に回答がストリームされる", async () => {
  const events: AgentEvent[] = [];
  for await (const e of runAgent({ query: "認証は?", ownerUserId: "u1", threadId: "t1", locale: "ja" })) {
    events.push(e);
  }
  // verify ステップが出る
  expect(events.some((e) => e.type === "step" && e.step.name === "verify")).toBe(true);

  // answer-start は verify ステップ done の後に来る（バッファ化の確認）
  const idxVerify = events.findIndex((e) => e.type === "step" && e.step.name === "verify");
  const idxAnswerStart = events.findIndex((e) => e.type === "answer-start");
  expect(idxVerify).toBeGreaterThanOrEqual(0);
  expect(idxAnswerStart).toBeGreaterThan(idxVerify);

  // 回答本文は最終的に流れる
  const answer = events.filter((e) => e.type === "answer-delta").map((e) => e.text).join("");
  expect(answer).toContain("失効");
});

test("未裏付けがあれば訂正本文が最終回答になる", async () => {
  const ai = await import("ai");
  vi.mocked(ai.generateObject).mockResolvedValueOnce({ object: { unsupported: ["x"] } } as never);
  vi.mocked(ai.generateText).mockResolvedValueOnce({ text: "訂正後の回答[1]。" } as never);
  const events: AgentEvent[] = [];
  for await (const e of runAgent({ query: "q", ownerUserId: "u1", threadId: "t1", locale: "ja" })) {
    events.push(e);
  }
  expect(events.some((e) => e.type === "step" && e.step.name === "revise")).toBe(true);
  const answer = events.filter((e) => e.type === "answer-delta").map((e) => e.text).join("");
  expect(answer).toBe("訂正後の回答[1]。");
});
```

> 既存テスト「runAgent runs tool loop, streams answer …」は、回答が末尾でまとめてストリームされるよう順序が変わる。`answer` の内容アサーション（`toContain("失効")`）は維持されるが、必要なら `done` 前に answer-delta が来ることを再確認する。

- [ ] **Step 2: テストが落ちることを確認**

Run: `pnpm test src/lib/agent/run.test.ts`
Expected: FAIL（verify ステップ無し / バッファ順序になっていない）

- [ ] **Step 3: buildTools 配線を更新**

`src/lib/agent/run.ts` の `buildTools({...})` 呼び出し（61 行付近）に grade 用の引数を追加:

```ts
    const tools = buildTools({
      registry, ownerUserId, meta, bus, attachmentDocIds, prompts,
      concurrency: cfg.parallelTools, topK: cfg.topK, candidateK: cfg.candidateK,
      gradeModel: resolution.models.rewrite, gradeThreshold: cfg.gradeThreshold,
      maxRetrieveRetries: cfg.maxRetrieveRetries,
    });
```

- [ ] **Step 4: import を追加**

`src/lib/agent/run.ts` の import 群に追加:

```ts
import { verifyAnswer } from "@/lib/agent/verify";
import type { ToolName } from "@/lib/types";
```

（`ToolName` が既存 import に含まれていれば重複させない。`AgentEvent` 等は既存のまま。）

- [ ] **Step 5: text-delta を「蓄積のみ」に変更**

`fullStream` ループ内の `text-delta` 分岐（145-154 行付近）を、ライブ送出をやめてバッファ蓄積に変更:

```ts
        } else if (part.type === "text-delta") {
          if (!answerStarted) {
            answerStarted = true;
            answerStartT = Date.now();
            bus.push(emitAnswerStep("running", answerStartT));
            answerStepEmitted = true;
            // バッファ化: answer-start / answer-delta はここでは出さない（検証後に確定ストリーム）。
          }
          answer += part.text;
        } else if (part.type === "finish") {
```

（`bus.push({ type: "answer-start" });` と `bus.push({ type: "answer-delta", text: part.text });` の 2 行を削除する。）

- [ ] **Step 6: 生成後に verify/revise → 確定ストリームを追加**

`fullStream` ループ（`try { … } catch {…}` ブロック）の直後、`if (!answer) {…}` フォールバックの後ろ、`if (answerStepEmitted) bus.push(emitAnswerStep("done", …));` の前後を以下のように再構成する。具体的には、`if (answerStepEmitted) bus.push(emitAnswerStep("done", answerStartT, totalUsage));` の直後に検証フェーズを挿入し、その後で確定ストリームを出す:

```ts
    if (answerStepEmitted) bus.push(emitAnswerStep("done", answerStartT, totalUsage));

    // 根拠検証（バッファ生成→検証→確定）。失敗時は素通し（answer は必ず出す）。
    if (cfg.verify && answer && registry.size > 0) {
      const vStart = Date.now();
      bus.push({ type: "step", step: {
        id: "verify", name: "verify" as ToolName, label: prompts.verify.label,
        status: "running", durationMs: 0, input: {}, output: null, summary: prompts.verify.running,
      } });
      const v = await verifyAnswer({
        query, answer, sources: registry.listSources(),
        model: resolution.models.rewrite, prompts, maxRevisions: cfg.maxRevisions,
      });
      bus.push({ type: "step", step: {
        id: "verify", name: "verify" as ToolName, label: prompts.verify.label,
        status: "done", durationMs: Date.now() - vStart,
        input: {}, output: { unsupported: v.unsupported.length },
        summary: prompts.verify.done(v.unsupported.length),
      } });
      if (v.revised) {
        bus.push({ type: "step", step: {
          id: "revise", name: "revise" as ToolName, label: prompts.revise.label,
          status: "done", durationMs: 0, input: {}, output: null, summary: prompts.revise.done,
        } });
        answer = v.revised;
      }
    }

    // 確定ストリーム: 検証済み本文をここで初めて送出する。
    bus.push({ type: "answer-start" });
    bus.push({ type: "answer-delta", text: answer });
```

> 注: 既存の `if (!answer)` フォールバック分岐は、その中で `answer-start` を push している。バッファ化後はフォールバック分岐内の `bus.push({ type: "answer-start" });` と `bus.push({ type: "answer-delta", text: answer });` を削除し、確定ストリーム（上記末尾 2 行）に一本化する。catch 節（159-165 行）内の `answer-start`/`answer-delta` push も同様に削除し、`answer` への代入のみ残す。これにより answer-start/answer-delta は必ず確定ストリームの 1 か所だけになる。

- [ ] **Step 7: done の引用抽出は変更不要**

`citedNums` は `answer`（＝確定本文）から抽出するため既存ロジックのまま正しく動く（176-181 行）。確認のみ。

- [ ] **Step 8: テストが通ることを確認**

Run: `pnpm test src/lib/agent/run.test.ts`
Expected: PASS

- [ ] **Step 9: コミット**

```bash
git add src/lib/agent/run.ts src/lib/agent/run.test.ts
git commit -m "feat: 生成をバッファ化し根拠検証→確定ストリームを追加"
```

---

## Task 8: 全体ゲート（型/lint/ビルド）と手動スモーク

**Files:**
- 変更なし（検証のみ）

- [ ] **Step 1: 単体テスト全件**

Run: `pnpm test`
Expected: PASS（config/citations/prompts/grade/verify/tools/run 全て緑）

- [ ] **Step 2: 型チェック**

Run: `pnpm exec tsc --noEmit`
Expected: エラーなし

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: エラーなし

- [ ] **Step 4: 本番ビルド**

Run: `pnpm build`
Expected: 成功

- [ ] **Step 5: 手動スモーク（フルスタック）**

`docker compose --profile worker up -d` 済みの状態で `pnpm dev` を起動し、文書をアップロード→索引化後に質問する。確認点:
- ステップ列に「関連度判定（grade）」が retrieve のサブステップとして出る
- 回答前に「根拠検証（verify）」ステップが出てから本文がストリームされる（初回トークンが検証後に出る）
- 未裏付けが検出された場合「回答の訂正（revise）」が出る

Expected: 上記が表示され、回答本文が正しくレンダリングされる。

- [ ] **Step 6: コミット（必要なら微修正のみ）**

```bash
git add -A
git commit -m "test: CRAG/根拠検証の統合検証"
```

---

## API 修正メモ（実装時に判明）

本リポジトリの AI SDK は **v6**。`generateObject` は **非推奨**（「`generateText` に `output` 設定を使え」）。よって本計画の grade.ts / verify.ts / run.test.ts で `generateObject` を使う箇所はすべて、現行 API へ置換する:

```ts
import { generateText, Output } from "ai";
const { output } = await generateText({
  model,
  output: Output.object({ schema: z.object({ /* … */ }) }),
  system, prompt,
});
// output が構造化結果（result.output）
```

テストのモックも `vi.mock("ai", () => ({ generateText: (...a) => fn(...a), Output: { object: (c) => c, text: () => ({}) } }))` とし、構造化呼び出しの戻り値は `{ output: {...} }`、プレーン生成（revise）は `{ text: "…" }` を返す。revise は元から `generateText`（プレーン）なので `.text` 読み出しのまま。

## Self-Review メモ

- **Spec カバレッジ**: grade→再検索（Task 4,6）／根拠検証＋訂正（Task 5,7）／設定 4 キー（Task 1）／プロンプト zh-ja parity（Task 3）／UX 現在ステージ表示（Task 6,7 のステップ送出＋Task 8 手動確認）／フォールバック（Task 4,5 の try/catch、Task 7 の `cfg.verify` ガード）を網羅。
- **対象外**: ルーティング・明示的クエリ分解・適応パラメータ・LangGraph 本体は本計画に含めない（後続弾）。
- **型整合**: `gradeChunks`/`verifyAnswer`/`buildTools` のシグネチャは Task 4/5/6 で一貫。`ToolName` の `grade`/`verify`/`revise` は Task 1 で定義し Task 6/7 で使用。
- **既存テスト影響**: `run.test.ts` の `ai` モックに `generateObject`/`generateText` を追加し、回答ストリーム順序の変更（バッファ化）に追従する（Task 7 Step 1）。
