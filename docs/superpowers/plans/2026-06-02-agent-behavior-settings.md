# エージェント挙動設定の実装 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 設定モーダルの「エージェント挙動」4項目（最大ステップ数 / 並列ツール実行 / 引用の必須化 / 未知なら「わからない」）を localStorage で永続化し、chat リクエスト経由で実際のエージェント挙動に反映する。

**Architecture:** クライアントは `useAgentCfg`（localStorage `arag.agentCfg`、`useTweaks` と同型）で設定を保持し、chat の fetch body に同梱。サーバーは `clampAgentCfg` で正規化し `runAgent` に渡す。`maxSteps`→`stopWhen`、引用・未知トグル→`buildSystemPrompt`、`parallelTools`→自前 `Semaphore` でツール同時実行を制限する。

**Tech Stack:** Next.js / React (`useSyncExternalStore`) / Vercel AI SDK (`streamText`, `stepCountIs`) / Vitest

**テストコマンド:** `pnpm test`（= `vitest --project unit run`）。単一ファイルは `pnpm vitest --project unit run <path>`。

---

## File Structure

新規:
- `src/lib/agent/config.ts` — `AGENT_CFG_DEFAULTS`・境界定数・`clampAgentCfg`・`buildSystemPrompt`（client/server 共用の純モジュール）
- `src/lib/agent/config.test.ts`
- `src/lib/agent/semaphore.ts` — `Semaphore` クラス
- `src/lib/agent/semaphore.test.ts`
- `src/hooks/use-agent-cfg.ts` — localStorage 永続フック

変更:
- `src/lib/types.ts` — `AgentCfg` 型追加
- `src/lib/agent/tools.ts` — `buildTools` に `concurrency`＋セマフォ
- `src/lib/agent/run.ts` — `agentCfg` を `stopWhen`/`system`/`concurrency` に反映
- `src/app/api/chat/route.ts` — body から `agentCfg` を読み `clampAgentCfg` して渡す
- `src/hooks/use-agent.ts` — `run()` に `agentCfg` 引数＋body 同梱
- `src/components/workspace/workspace.tsx` — `useAgentCfg` を結線
- `src/components/modals/settings-modal.tsx` — `agentCfg`/`setAgentCfg` を props 化
- `src/components/modals/settings-modal.stories.tsx` — 追加 props のモック

---

## Task 1: `AgentCfg` 型と config モジュール

**Files:**
- Modify: `src/lib/types.ts`（`// ── Tweaks ──` ブロックの直前に追記）
- Create: `src/lib/agent/config.ts`
- Test: `src/lib/agent/config.test.ts`

- [ ] **Step 1: `AgentCfg` 型を追加**

`src/lib/types.ts` の `// ── Tweaks (persisted display preferences) ──` 行の直前に挿入:

```ts
// ── Agent behavior config (persisted, sent per chat request) ────────────────
export interface AgentCfg {
  /** エージェントが取れる最大のツール呼出し回数 */
  maxSteps: number;
  /** 同時に走らせるツール数 */
  parallelTools: number;
  /** 回答中の各事実に引用を付けることを強制 */
  requireCitations: boolean;
  /** 未知の場合に「わからない」と返す */
  admitUnknown: boolean;
}

```

- [ ] **Step 2: 失敗するテストを書く**

`src/lib/agent/config.test.ts`:

```ts
import { expect, test } from "vitest";
import { clampAgentCfg, buildSystemPrompt, AGENT_CFG_DEFAULTS } from "@/lib/agent/config";

test("clampAgentCfg returns defaults for null / non-object", () => {
  expect(clampAgentCfg(null)).toEqual(AGENT_CFG_DEFAULTS);
  expect(clampAgentCfg(undefined)).toEqual(AGENT_CFG_DEFAULTS);
  expect(clampAgentCfg(42)).toEqual(AGENT_CFG_DEFAULTS);
  expect(clampAgentCfg([])).toEqual(AGENT_CFG_DEFAULTS);
});

test("clampAgentCfg clamps numbers into range and rounds", () => {
  expect(clampAgentCfg({ maxSteps: 0 }).maxSteps).toBe(1);
  expect(clampAgentCfg({ maxSteps: 100 }).maxSteps).toBe(20);
  expect(clampAgentCfg({ maxSteps: 7.6 }).maxSteps).toBe(8);
  expect(clampAgentCfg({ parallelTools: 0 }).parallelTools).toBe(1);
  expect(clampAgentCfg({ parallelTools: 99 }).parallelTools).toBe(8);
});

test("clampAgentCfg coerces numeric strings and falls back on NaN", () => {
  expect(clampAgentCfg({ maxSteps: "5" }).maxSteps).toBe(5);
  expect(clampAgentCfg({ maxSteps: "abc" }).maxSteps).toBe(AGENT_CFG_DEFAULTS.maxSteps);
});

test("clampAgentCfg fills missing booleans with defaults", () => {
  const c = clampAgentCfg({ maxSteps: 5 });
  expect(c.requireCitations).toBe(AGENT_CFG_DEFAULTS.requireCitations);
  expect(c.admitUnknown).toBe(AGENT_CFG_DEFAULTS.admitUnknown);
});

test("clampAgentCfg keeps explicit boolean values", () => {
  expect(clampAgentCfg({ requireCitations: false }).requireCitations).toBe(false);
  expect(clampAgentCfg({ admitUnknown: false }).admitUnknown).toBe(false);
});

test("buildSystemPrompt enforces citations when requireCitations is on", () => {
  const p = buildSystemPrompt({ ...AGENT_CFG_DEFAULTS, requireCitations: true });
  expect(p).toContain("必ず");
  expect(p).toContain("[1]");
});

test("buildSystemPrompt relaxes citations when off", () => {
  const p = buildSystemPrompt({ ...AGENT_CFG_DEFAULTS, requireCitations: false });
  expect(p).toContain("必須ではありません");
});

test("buildSystemPrompt includes the わからない clause when admitUnknown is on", () => {
  const p = buildSystemPrompt({ ...AGENT_CFG_DEFAULTS, admitUnknown: true });
  expect(p).toContain("わからない");
});

test("buildSystemPrompt omits the わからない clause when off", () => {
  const p = buildSystemPrompt({ ...AGENT_CFG_DEFAULTS, admitUnknown: false });
  expect(p).not.toContain("わからない");
});
```

- [ ] **Step 3: 失敗を確認**

Run: `pnpm vitest --project unit run src/lib/agent/config.test.ts`
Expected: FAIL（`Cannot find module '@/lib/agent/config'`）

- [ ] **Step 4: config.ts を実装**

`src/lib/agent/config.ts`:

```ts
/** エージェント挙動設定の既定値・境界・正規化・システムプロンプト生成。
 *  client（フック）と server（chat route / runAgent）で共用するため、
 *  "use client" 依存を一切持たない純モジュールにする。 */
import type { AgentCfg } from "@/lib/types";

export const AGENT_CFG_DEFAULTS: AgentCfg = {
  maxSteps: 12,
  parallelTools: 3,
  requireCitations: true,
  admitUnknown: true,
};

export const MAX_STEPS_MIN = 1;
export const MAX_STEPS_MAX = 20;
export const PARALLEL_MIN = 1;
export const PARALLEL_MAX = 8;

function clampInt(raw: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function asBool(raw: unknown, fallback: boolean): boolean {
  return typeof raw === "boolean" ? raw : fallback;
}

/** localStorage / リクエスト由来の任意の値を、常に有効な AgentCfg へ正規化する。 */
export function clampAgentCfg(raw: unknown): AgentCfg {
  const o =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  return {
    maxSteps: clampInt(o.maxSteps, MAX_STEPS_MIN, MAX_STEPS_MAX, AGENT_CFG_DEFAULTS.maxSteps),
    parallelTools: clampInt(o.parallelTools, PARALLEL_MIN, PARALLEL_MAX, AGENT_CFG_DEFAULTS.parallelTools),
    requireCitations: asBool(o.requireCitations, AGENT_CFG_DEFAULTS.requireCitations),
    admitUnknown: asBool(o.admitUnknown, AGENT_CFG_DEFAULTS.admitUnknown),
  };
}

/** 設定に応じてエージェントのシステムプロンプトを組み立てる。 */
export function buildSystemPrompt(cfg: AgentCfg): string {
  const citation = cfg.requireCitations
    ? "重要な事実には必ずツール結果に付いた [1] [2] の出典番号を付けてください。"
    : "可能であればツール結果に付いた [1] [2] の出典番号を付けてください（必須ではありません）。";
  const unknown = cfg.admitUnknown
    ? "資料に無いことは推測せず、判断できない場合は「わからない」と明確に答えてください。"
    : "資料に直接の記載が無い場合は、一般的な知識で補って回答してもかまいません。";
  return (
    "あなたは社内ナレッジ検索アシスタントです。必要に応じて retrieve / fetch_document ツールを使い、" +
    "会話の文脈を踏まえて自己完結した検索クエリを組み立ててください。" +
    "回答は提供された一次資料に基づき日本語で簡潔に行い、" +
    "Markdown の見出し(**太字**)と箇条書き(-)で構造化してください。" +
    citation +
    unknown
  );
}
```

- [ ] **Step 5: テストが通ることを確認**

Run: `pnpm vitest --project unit run src/lib/agent/config.test.ts`
Expected: PASS（9 tests）

- [ ] **Step 6: コミット**

```bash
git add src/lib/types.ts src/lib/agent/config.ts src/lib/agent/config.test.ts
git commit -m "feat: エージェント設定の型・正規化・プロンプト生成を追加"
```

---

## Task 2: Semaphore

**Files:**
- Create: `src/lib/agent/semaphore.ts`
- Test: `src/lib/agent/semaphore.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/agent/semaphore.test.ts`:

```ts
import { expect, test } from "vitest";
import { Semaphore } from "@/lib/agent/semaphore";

test("caps concurrent executions at max", async () => {
  const sema = new Semaphore(2);
  let active = 0;
  let peak = 0;
  const task = () =>
    sema.run(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
      return true;
    });
  await Promise.all(Array.from({ length: 6 }, task));
  expect(peak).toBe(2);
});

test("rounds max below 1 up to 1", async () => {
  const sema = new Semaphore(0);
  let active = 0;
  let peak = 0;
  const task = () =>
    sema.run(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
    });
  await Promise.all(Array.from({ length: 3 }, task));
  expect(peak).toBe(1);
});

test("returns each task's resolved value", async () => {
  const sema = new Semaphore(2);
  const results = await Promise.all([1, 2, 3].map((n) => sema.run(async () => n * 2)));
  expect(results).toEqual([2, 4, 6]);
});

test("releases the slot even when a task throws", async () => {
  const sema = new Semaphore(1);
  await expect(sema.run(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
  // スロットが解放されていれば次のタスクは完走する。
  await expect(sema.run(async () => "ok")).resolves.toBe("ok");
});
```

- [ ] **Step 2: 失敗を確認**

Run: `pnpm vitest --project unit run src/lib/agent/semaphore.test.ts`
Expected: FAIL（`Cannot find module '@/lib/agent/semaphore'`）

- [ ] **Step 3: semaphore.ts を実装**

`src/lib/agent/semaphore.ts`:

```ts
/** 非同期処理の同時実行数を max 件に制限する最小セマフォ。
 *  ツールの execute をラップして並列ツール実行数の上限を強制するために使う。 */
export class Semaphore {
  private readonly max: number;
  private active = 0;
  private readonly queue: (() => void)[] = [];

  constructor(max: number) {
    const n = Math.floor(max);
    this.max = Number.isFinite(n) && n >= 1 ? n : 1;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this.queue.push(resolve));
  }

  private release(): void {
    const next = this.queue.shift();
    // 待機者がいればスロットを直接引き渡す（active は据え置き）。いなければ解放。
    if (next) next();
    else this.active--;
  }
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm vitest --project unit run src/lib/agent/semaphore.test.ts`
Expected: PASS（4 tests）

- [ ] **Step 5: コミット**

```bash
git add src/lib/agent/semaphore.ts src/lib/agent/semaphore.test.ts
git commit -m "feat: ツール同時実行を制限する Semaphore を追加"
```

---

## Task 3: `buildTools` に並列制限を組み込む

**Files:**
- Modify: `src/lib/agent/tools.ts`
- Test: `src/lib/agent/tools.test.ts`（既存。回帰確認のみ）

> 既存テストは `buildTools({ registry, ownerUserId, meta, bus })` を `concurrency` 無しで呼ぶため、`concurrency` は任意とし既定へフォールバックする。

- [ ] **Step 1: import を追加**

`src/lib/agent/tools.ts` の import 群（`import type { AgentEvent, ToolName } from "@/lib/types";` の直後）に追加:

```ts
import { Semaphore } from "@/lib/agent/semaphore";
import { AGENT_CFG_DEFAULTS } from "@/lib/agent/config";
```

- [ ] **Step 2: `BuildToolsInput` に `concurrency` を追加**

`src/lib/agent/tools.ts` の `BuildToolsInput` 末尾（`attachmentDocIds?: string[];` の直後、`}` の前）に追加:

```ts
  /** ツール execute の同時実行上限。未指定なら既定の並列数。 */
  concurrency?: number;
```

- [ ] **Step 3: セマフォ生成と分割代入を更新**

`export function buildTools({ registry, ownerUserId, meta, bus, attachmentDocIds }: BuildToolsInput): ToolSet {`
を次に置換:

```ts
export function buildTools({ registry, ownerUserId, meta, bus, attachmentDocIds, concurrency }: BuildToolsInput): ToolSet {
  const sema = new Semaphore(concurrency ?? AGENT_CFG_DEFAULTS.parallelTools);
```

（直後の `return {` はそのまま残す。）

- [ ] **Step 4: `retrieve.execute` をセマフォでラップ**

`retrieve` の `execute: async ({ query }, { toolCallId }) => {`
を次に置換:

```ts
      execute: ({ query }, { toolCallId }) => sema.run(async () => {
```

対応する `retrieve.execute` 本体の閉じ `},`（`return lines.length ? lines.join("\n\n") : "該当する資料は見つかりませんでした。";` の次の行）を次に置換:

```ts
      }),
```

- [ ] **Step 5: `fetch_document.execute` をセマフォでラップ**

`fetch_document` の `execute: async ({ ref }, { toolCallId }) => {`
を次に置換:

```ts
      execute: ({ ref }, { toolCallId }) => sema.run(async () => {
```

対応する `fetch_document.execute` 本体の閉じ `},`（`return lines.length ? lines.join("\n\n") : "文書の本文が取得できませんでした。";` の次の行）を次に置換:

```ts
      }),
```

- [ ] **Step 6: 既存テスト（tools / run）が通ることを確認**

Run: `pnpm vitest --project unit run src/lib/agent/tools.test.ts src/lib/agent/run.test.ts`
Expected: PASS（回帰なし）

- [ ] **Step 7: コミット**

```bash
git add src/lib/agent/tools.ts
git commit -m "feat: buildTools にツール同時実行の上限制御を追加"
```

---

## Task 4: `runAgent` に agentCfg を反映

**Files:**
- Modify: `src/lib/agent/run.ts`
- Test: `src/lib/agent/run.test.ts`（既存。回帰確認）

- [ ] **Step 1: import と型を更新**

`src/lib/agent/run.ts` の `import type { AgentEvent, ToolCall, ToolName } from "@/lib/types";` を次に置換:

```ts
import type { AgentCfg, AgentEvent, ToolCall, ToolName } from "@/lib/types";
import { AGENT_CFG_DEFAULTS, buildSystemPrompt } from "@/lib/agent/config";
```

`RunInput` の `modelId?: string;` の直後に追加:

```ts
  agentCfg?: AgentCfg;
```

- [ ] **Step 2: 旧定数を撤去**

`src/lib/agent/run.ts` の次の2つの定義を削除する:

```ts
const SYSTEM =
  "あなたは社内ナレッジ検索アシスタントです。必要に応じて retrieve / fetch_document ツールを使い、" +
  "会話の文脈を踏まえて自己完結した検索クエリを組み立ててください。" +
  "回答は提供された一次資料のみに基づき日本語で簡潔に行い、重要な事実には必ずツール結果に付いた [1] [2] の出典番号を付け、" +
  "Markdown の見出し(**太字**)と箇条書き(-)で構造化してください。資料に無いことは推測しないでください。";

const MAX_STEPS = 6;
```

- [ ] **Step 3: pump の分割代入に agentCfg を追加し cfg を導出**

`pump` の引数分割代入
`{ query, ownerUserId, threadId, history, modelId, attachments, attachmentDocIds }: RunInput,`
を次に置換:

```ts
  { query, ownerUserId, threadId, history, modelId, attachments, attachmentDocIds, agentCfg }: RunInput,
```

`const started = Date.now();` の直後の行に追加:

```ts
    const cfg = agentCfg ?? AGENT_CFG_DEFAULTS;
```

- [ ] **Step 4: buildTools と streamText に反映**

`const tools = buildTools({ registry, ownerUserId, meta, bus, attachmentDocIds });`
を次に置換:

```ts
    const tools = buildTools({ registry, ownerUserId, meta, bus, attachmentDocIds, concurrency: cfg.parallelTools });
```

`streamText({ ... })` の `system: SYSTEM,` を `system: buildSystemPrompt(cfg),` に、
`stopWhen: stepCountIs(MAX_STEPS),` を `stopWhen: stepCountIs(cfg.maxSteps),` に置換。

- [ ] **Step 5: 既存テストが通ることを確認**

Run: `pnpm vitest --project unit run src/lib/agent/run.test.ts src/lib/agent/run-fallback.test.ts`
Expected: PASS（回帰なし）

- [ ] **Step 6: コミット**

```bash
git add src/lib/agent/run.ts
git commit -m "feat: runAgent に最大ステップ・引用・並列設定を反映"
```

---

## Task 5: chat route で agentCfg を受け取りクランプ

**Files:**
- Modify: `src/app/api/chat/route.ts`

- [ ] **Step 1: import を追加**

`src/app/api/chat/route.ts` の `import { runAgent } from "@/lib/agent/run";` の直後に追加:

```ts
import { clampAgentCfg } from "@/lib/agent/config";
```

- [ ] **Step 2: body の型と分割代入に agentCfg を追加**

`const { query, threadId, model, regenerateFrom, attachments, attachmentDocIds } =`
で始まる分割代入と型注釈を次に置換:

```ts
  const { query, threadId, model, regenerateFrom, attachments, attachmentDocIds, agentCfg } =
    (await req.json().catch(() => ({}))) as {
      query?: string; threadId?: string; model?: string; regenerateFrom?: number;
      attachments?: string[]; attachmentDocIds?: string[]; agentCfg?: unknown;
    };
```

- [ ] **Step 3: cfg を正規化**

同じ関数内、`const q = query || "";` の直後に追加:

```ts
  const cfg = clampAgentCfg(agentCfg);
```

- [ ] **Step 4: runAgent 呼び出しに渡す**

`for await (const event of runAgent({ query: q, ownerUserId: claims.sub, threadId: tid, modelId: model, history, attachments, attachmentDocIds })) {`
の `runAgent({ ... })` 引数末尾 `attachmentDocIds` の直後に `, agentCfg: cfg` を追加:

```ts
        for await (const event of runAgent({ query: q, ownerUserId: claims.sub, threadId: tid, modelId: model, history, attachments, attachmentDocIds, agentCfg: cfg })) {
```

- [ ] **Step 5: 型チェックが通ることを確認**

Run: `pnpm vitest --project unit run src/lib/agent`
Expected: PASS（既存の agent テスト群が通る＝import 整合）

- [ ] **Step 6: コミット**

```bash
git add src/app/api/chat/route.ts
git commit -m "feat: chat API でエージェント設定を受け取り正規化して渡す"
```

---

## Task 6: `useAgentCfg` フック

**Files:**
- Modify: `src/lib/constants.ts`
- Create: `src/hooks/use-agent-cfg.ts`

- [ ] **Step 1: ストレージキー定数を追加**

`src/lib/constants.ts` の `export const MODEL_STORAGE_KEY = "arag.model";` の直後に追加:

```ts
export const AGENT_CFG_STORAGE_KEY = "arag.agentCfg";
```

- [ ] **Step 2: フックを実装**

`src/hooks/use-agent-cfg.ts`:

```ts
"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { AGENT_CFG_STORAGE_KEY } from "@/lib/constants";
import { AGENT_CFG_DEFAULTS, clampAgentCfg } from "@/lib/agent/config";
import type { AgentCfg } from "@/lib/types";

const AGENT_CFG_EVENT = "arag:agent-cfg";

function subscribe(onChange: () => void) {
  window.addEventListener(AGENT_CFG_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(AGENT_CFG_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}
// 生の文字列を返してスナップショット参照を読み取り間で安定させる。
const getSnapshot = () => localStorage.getItem(AGENT_CFG_STORAGE_KEY) ?? "";
const getServerSnapshot = () => "";

/** 永続化されたエージェント挙動設定（localStorage）。chat リクエストに同梱して使う。 */
export function useAgentCfg() {
  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const agentCfg = useMemo<AgentCfg>(() => {
    try {
      return clampAgentCfg(raw ? JSON.parse(raw) : null);
    } catch {
      return AGENT_CFG_DEFAULTS;
    }
  }, [raw]);

  const setAgentCfg = useCallback(
    <K extends keyof AgentCfg>(key: K, value: AgentCfg[K]) => {
      const current = (() => {
        try {
          return clampAgentCfg(JSON.parse(localStorage.getItem(AGENT_CFG_STORAGE_KEY) || "null"));
        } catch {
          return AGENT_CFG_DEFAULTS;
        }
      })();
      const next = { ...current, [key]: value };
      try {
        localStorage.setItem(AGENT_CFG_STORAGE_KEY, JSON.stringify(next));
      } catch {}
      window.dispatchEvent(new Event(AGENT_CFG_EVENT));
    },
    [],
  );

  return { agentCfg, setAgentCfg };
}
```

- [ ] **Step 3: 型チェック（lint）が通ることを確認**

Run: `pnpm lint`
Expected: エラーなし（新規ファイルに警告が出ないこと）

- [ ] **Step 4: コミット**

```bash
git add src/lib/constants.ts src/hooks/use-agent-cfg.ts
git commit -m "feat: エージェント設定を永続化する useAgentCfg を追加"
```

---

## Task 7: `useAgent.run()` に agentCfg を流す

**Files:**
- Modify: `src/hooks/use-agent.ts`

- [ ] **Step 1: import を追加**

`src/hooks/use-agent.ts` の `import type { AgentEvent, Turn } from "@/lib/types";`
を次に置換:

```ts
import type { AgentCfg, AgentEvent, Turn } from "@/lib/types";
```

- [ ] **Step 2: `run` の引数に agentCfg を追加**

`run` 定義の引数リストで、`modelId: string | undefined,` の直後（`cb:` の前）に追加:

```ts
      agentCfg: AgentCfg,
```

- [ ] **Step 3: fetch body に同梱**

`body: JSON.stringify({ query, attachments, attachmentDocIds, threadId, model: modelId, regenerateFrom: cb.regenerateFrom }),`
を次に置換:

```ts
          body: JSON.stringify({ query, attachments, attachmentDocIds, threadId, model: modelId, regenerateFrom: cb.regenerateFrom, agentCfg }),
```

- [ ] **Step 4: コミット**

```bash
git add src/hooks/use-agent.ts
git commit -m "feat: useAgent.run でエージェント設定を chat リクエストに同梱"
```

> 注: この時点で `workspace.tsx` の `agent.run(...)` 呼び出しは引数不足で型エラーになる。次タスクで解消する（タスク順序どおりに進めれば連続コミットで整合する）。

---

## Task 8: workspace で結線

**Files:**
- Modify: `src/components/workspace/workspace.tsx`

- [ ] **Step 1: import を追加**

`import { useTweaks } from "@/hooks/use-tweaks";`（23 行目付近）の直後に追加:

```ts
import { useAgentCfg } from "@/hooks/use-agent-cfg";
```

- [ ] **Step 2: フックを呼ぶ**

`const { tweaks, setTweak } = useTweaks();`（38 行目付近）の直後に追加:

```ts
  const { agentCfg, setAgentCfg } = useAgentCfg();
```

- [ ] **Step 3: `agent.run(...)` に agentCfg を渡す**

`await agent.run(finalQuery, attachNames, attachDocIds, continueId, model.id, {`（209 行目付近）
を次に置換:

```ts
      await agent.run(finalQuery, attachNames, attachDocIds, continueId, model.id, agentCfg, {
```

- [ ] **Step 4: `<SettingsModal>` に props を渡す**

`<SettingsModal>` 内の `setTweak={setTweak}`（780 行目付近）の直後に追加:

```tsx
        agentCfg={agentCfg}
        setAgentCfg={setAgentCfg}
```

- [ ] **Step 5: コミット**

```bash
git add src/components/workspace/workspace.tsx
git commit -m "feat: workspace でエージェント設定を結線"
```

> 注: この時点で `SettingsModal` はまだ新 props を受け取っていない（次タスクで追加）。連続実行を前提とする。

---

## Task 9: SettingsModal を props 化

**Files:**
- Modify: `src/components/modals/settings-modal.tsx`
- Modify: `src/components/modals/settings-modal.stories.tsx`

- [ ] **Step 1: import に型を追加**

`import type { AppUser, ModelOption, Tweaks } from "@/lib/types";`
を次に置換:

```ts
import type { AgentCfg, AppUser, ModelOption, Tweaks } from "@/lib/types";
```

- [ ] **Step 2: Props に追加**

`interface Props` の `setTweak: <K extends keyof Tweaks>(key: K, value: Tweaks[K]) => void;` の直後に追加:

```ts
  agentCfg: AgentCfg;
  setAgentCfg: <K extends keyof AgentCfg>(key: K, value: AgentCfg[K]) => void;
```

- [ ] **Step 3: 関数引数の分割代入に追加**

`export function SettingsModal({` のパラメータで `setTweak,` の直後に追加:

```ts
  agentCfg,
  setAgentCfg,
```

- [ ] **Step 4: 使い捨て useState を撤去**

次の行を削除する:

```ts
  const [agentCfg, setAgentCfg] = useState({ maxSteps: 12, parallelTools: 3, requireCitations: true, admitUnknown: true });
```

- [ ] **Step 5: agent セクションの更新呼び出しを置換**

`section === "agent"` ブロック内を、props の `setAgentCfg(key, value)` を使う形へ置換する。該当ブロック全体を次に置換:

```tsx
            {section === "agent" && (
              <div className="flex flex-col gap-3.5">
                <Field label="最大ステップ数" hint="エージェントが取れる最大のツール呼出し回数">
                  <input
                    type="number"
                    min={1}
                    value={agentCfg.maxSteps}
                    onChange={(e) => setAgentCfg("maxSteps", Number(e.target.value))}
                    className={fieldInput}
                  />
                </Field>
                <Field label="並列ツール実行" hint="同時に走らせるツール数">
                  <input
                    type="number"
                    min={1}
                    value={agentCfg.parallelTools}
                    onChange={(e) => setAgentCfg("parallelTools", Number(e.target.value))}
                    className={fieldInput}
                  />
                </Field>
                <Field label="引用の必須化" hint="回答中の各事実に引用を付けることを強制">
                  <Switch
                    on={agentCfg.requireCitations}
                    onToggle={() => setAgentCfg("requireCitations", !agentCfg.requireCitations)}
                    label="引用の必須化"
                  />
                </Field>
                <Field label='未知の場合に "わからない" と返す'>
                  <Switch
                    on={agentCfg.admitUnknown}
                    onToggle={() => setAgentCfg("admitUnknown", !agentCfg.admitUnknown)}
                    label='未知の場合に "わからない" と返す'
                  />
                </Field>
              </div>
            )}
```

- [ ] **Step 6: 未使用 import の整理**

`useState` が他で使われていなければ（このファイルでは `connectors` 等で使用中なので残す）import 変更は不要。`pnpm lint` で確認する。

- [ ] **Step 7: Story にモック props を追加**

`src/components/modals/settings-modal.stories.tsx` の import で型を追加:

`import type { Tweaks, AppUser } from "@/lib/types";`
を次に置換:

```ts
import type { AgentCfg, Tweaks, AppUser } from "@/lib/types";
```

トップレベルの `tweaks` const 定義（`const tweaks: Tweaks = { ... };`）の直後に追加:

```ts
const agentCfg: AgentCfg = {
  maxSteps: 12,
  parallelTools: 3,
  requireCitations: true,
  admitUnknown: true,
};
```

`meta.args` 内の `setTweak: fn(),` の直後に追加:

```ts
    agentCfg,
    setAgentCfg: fn(),
```

- [ ] **Step 8: lint と全テストを実行**

Run: `pnpm lint && pnpm test`
Expected: lint エラーなし。全 unit テスト PASS。

- [ ] **Step 9: Storybook テスト（任意）**

Run: `pnpm test:storybook`
Expected: SettingsModal の story が描画エラーなく PASS。

- [ ] **Step 10: コミット**

```bash
git add src/components/modals/settings-modal.tsx src/components/modals/settings-modal.stories.tsx
git commit -m "feat: エージェント挙動設定を永続設定に接続"
```

---

## 最終確認

- [ ] **全テスト & lint**

Run: `pnpm lint && pnpm test`
Expected: すべて PASS

- [ ] **手動確認（任意・`run` スキル等）**

1. アプリ起動 → 設定 → エージェント挙動で値を変更しモーダルを閉じる
2. リロードしても値が保持されること（localStorage `arag.agentCfg`）
3. 「引用の必須化」OFF・「最大ステップ数」を小さくして質問 → 挙動が変わること

---

## メモ（実装者向け）

- `clampAgentCfg` がクライアント読み出し時とサーバー受信時の二重防御。UI 側で範囲強制はしない（サーバーが最終権威）。
- `parallelTools` はモデルの並列呼出し意思決定そのものではなく、自前ツール execute の同時実行数の上限。
- バックエンド既定 `maxSteps` は 6 → 12 に変更済み（`AGENT_CFG_DEFAULTS`）。古いクライアントが `agentCfg` を送らなくても既定で動作する。
