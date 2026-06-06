# LLM/プロンプト観測ダッシュボード 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 本番と同じ `runAgent` を別ポートで回し、全 LLM 呼び出しの生プロンプト/生出力を観測しつつ、検索を固定（初回実・以降リプレイ）し、5プロンプトをエフェメラル上書きして即再実行できる開発専用ダッシュボードを作る。

**Architecture:** 本番には無害な dev シーム2個だけ追加（run.ts の `observe?`、rag-client の transport フック）。観測ロジックは `src/` の外 `tools/observatory/` に隔離。AI SDK の `wrapLanguageModel` ミドルウェアで各モデルを包み、送信直前の system 文字列で役割判定→上書き→全入出力キャプチャ。検索は `ragFetch` 単一境界で snapshot/replay。Vite middlewareMode で UI(HMR)＋SSE API を `:3030` に立てる。

**Tech Stack:** TypeScript / AI SDK v6（`wrapLanguageModel`, `LanguageModelV3Middleware`）/ Vite（既存 devDep, middlewareMode + ssrLoadModule）/ React 19 / vitest（`MockLanguageModelV3` from `ai/test`）。

参照: 設計 spec `docs/superpowers/specs/2026-06-05-llm-prompt-observatory-design.md`。

---

## ファイル構成

- 本番シーム（既定で不活性）
  - Modify: `src/lib/rag-client.ts` — transport フック追加
  - Modify: `src/lib/agent/run.ts` — `RunInput.observe?` 追加、chat/rewrite モデルを wrap
  - Test: `src/lib/rag-client.test.ts`（新規）、`src/lib/agent/run.test.ts`（追記）
- 観測ツール（`src/` の外、アプリ非依存）
  - Create: `tools/observatory/observe.ts` — `createObserver()`：役割判定・上書き・キャプチャ
  - Create: `tools/observatory/replay.ts` — snapshot 保存/再生 transport
  - Create: `tools/observatory/server.ts` — Vite middlewareMode + SSE API
  - Create: `tools/observatory/index.html`、`tools/observatory/ui/main.tsx`、`tools/observatory/ui/App.tsx`
  - Create: `tools/observatory/tsconfig.json`、`tools/observatory/vitest.config.ts`
  - Test: `tools/observatory/observe.test.ts`、`tools/observatory/replay.test.ts`
- 隔離設定
  - Modify: `.gitignore`（`tools/observatory/snapshots/`）
  - Modify: `package.json`（`observe` スクリプト）
  - Modify: `eslint.config.mjs`（`tools/` を ignore）

---

## Task 1: rag-client に transport シームを追加

**Files:**
- Modify: `src/lib/rag-client.ts`
- Test: `src/lib/rag-client.test.ts`（新規）

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/rag-client.test.ts`:
```ts
import { afterEach, expect, test, vi } from "vitest";
import { ragFetch, setRagTransport } from "@/lib/rag-client";

afterEach(() => setRagTransport(null));

test("transport 未設定なら素の fetch を使う", async () => {
  const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
  await ragFetch("/retrieve", { method: "POST" });
  expect(spy).toHaveBeenCalledOnce();
  expect(String(spy.mock.calls[0][0])).toContain("/retrieve");
  spy.mockRestore();
});

test("transport 設定時はそちらを使い x-internal-token を付ける", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  setRagTransport(async (url, init) => { calls.push({ url: String(url), init }); return new Response("ok"); });
  await ragFetch("/retrieve", { method: "POST" });
  expect(calls).toHaveLength(1);
  expect(calls[0].url).toContain("/retrieve");
  expect((calls[0].init?.headers as Record<string,string>)["x-internal-token"]).toBeTruthy();
});

test("本番では transport 差し替えを拒否する", () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    expect(() => setRagTransport(async () => new Response(""))).toThrow(/dev-only/);
  } finally { process.env.NODE_ENV = prev; }
});
```

- [ ] **Step 2: 失敗を確認**

Run: `pnpm test src/lib/rag-client.test.ts`
Expected: FAIL（`setRagTransport` is not exported）

- [ ] **Step 3: 実装**

`src/lib/rag-client.ts` を全置換:
```ts
const base = () => process.env.RAG_SERVICE_URL || "http://localhost:8000";
const token = () => process.env.RAG_INTERNAL_TOKEN || "dev-internal-token";

/** dev 限定で rag への transport を差し替えるためのフック（snapshot/replay 用）。 */
let transport: typeof fetch | null = null;

/** 観測ツールから rag 通信を横取りする。本番では差し替えを拒否する安全弁付き。 */
export function setRagTransport(t: typeof fetch | null): void {
  if (process.env.NODE_ENV === "production" && t) {
    throw new Error("setRagTransport is dev-only");
  }
  transport = t;
}

/** Server-only fetch to the rag service with the internal auth header. */
export async function ragFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const f = transport ?? fetch;
  return f(base() + path, {
    ...init,
    headers: { "x-internal-token": token(), ...(init.headers || {}) },
  });
}
```

- [ ] **Step 4: 合格を確認**

Run: `pnpm test src/lib/rag-client.test.ts`
Expected: PASS（3 件）

- [ ] **Step 5: コミット**

```bash
git add src/lib/rag-client.ts src/lib/rag-client.test.ts
git commit -m "feat: rag-client に dev 限定 transport シームを追加"
```

---

## Task 2: run.ts に observe シームを追加

**Files:**
- Modify: `src/lib/agent/run.ts`（`RunInput` と `pump`）
- Test: `src/lib/agent/run.test.ts`（追記）

- [ ] **Step 1: 失敗するテストを追記**

`src/lib/agent/run.test.ts` の末尾に追加:
```ts
test("observe.wrap が chat と rewrite の両モデルに対して呼ばれる", async () => {
  const hints: string[] = [];
  const wrap = vi.fn((m: unknown, hint: "chat" | "rewrite") => { hints.push(hint); return m; });
  for await (const _ of runAgent({
    query: "認証は?", ownerUserId: "u1", threadId: "t1", locale: "ja",
    observe: { wrap: wrap as never },
  })) { /* drain */ }
  expect(hints).toContain("chat");
  expect(hints).toContain("rewrite");
});
```

- [ ] **Step 2: 失敗を確認**

Run: `pnpm test src/lib/agent/run.test.ts`
Expected: FAIL（`observe` がプロパティに無い型エラー、または wrap 未呼出）

- [ ] **Step 3: 実装**

`src/lib/agent/run.ts`:

(a) `RunInput` に追加（`agentCfg?: AgentCfg;` の直後）:
```ts
  /** dev 観測ツール用シーム。未指定なら本番挙動と完全一致。 */
  observe?: {
    wrap: (model: import("ai").LanguageModel, hint: "chat" | "rewrite") => import("ai").LanguageModel;
  };
```

(b) `pump` の引数destructureに `observe` を追加:
```ts
async function pump(
  { query, ownerUserId, threadId, history, modelId, attachments, attachmentDocIds, locale, agentCfg, observe }: RunInput,
  bus: StepBus,
): Promise<void> {
```

(c) `resolution.ok` 確定後、`const registry = ...` の直前に追加:
```ts
    // dev 観測時のみモデルを包む（未指定なら素通し＝挙動不変）。
    const chatModel = observe ? observe.wrap(resolution.models.chat, "chat") : resolution.models.chat;
    const rewriteModel = observe ? observe.wrap(resolution.models.rewrite, "rewrite") : resolution.models.rewrite;
```

(d) `streamText({ model: resolution.models.chat, ...})` を `model: chatModel` に変更。

(e) `buildTools({... gradeModel: resolution.models.rewrite, ...})` を `gradeModel: rewriteModel` に変更。

(f) `verifyAnswer({... model: resolution.models.rewrite, ...})` を `model: rewriteModel` に変更。

- [ ] **Step 4: 合格と回帰なしを確認**

Run: `pnpm test src/lib/agent/run.test.ts`
Expected: PASS（新規 + 既存すべて）。`observe` 未指定の既存テストが不変であること。

- [ ] **Step 5: コミット**

```bash
git add src/lib/agent/run.ts src/lib/agent/run.test.ts
git commit -m "feat: run に dev 観測用のモデル wrap シームを追加"
```

---

## Task 3: ツールの隔離設定（tsconfig / lint / gitignore / script）

**Files:**
- Create: `tools/observatory/tsconfig.json`
- Create: `tools/observatory/vitest.config.ts`
- Modify: `.gitignore`、`eslint.config.mjs`、`package.json`

- [ ] **Step 1: tools 用 tsconfig**

`tools/observatory/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "types": ["node"],
    "paths": { "@/*": ["../../src/*"] }
  },
  "include": ["**/*.ts", "**/*.tsx"]
}
```

- [ ] **Step 2: tools 用 vitest 設定（root の `pnpm test` とは独立）**

`tools/observatory/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

// アプリの vitest.config.ts とは独立。`@/` は src を指す。
export default defineConfig({
  resolve: { alias: { "@": new URL("../../src", import.meta.url).pathname } },
  test: { environment: "node", include: ["**/*.test.ts"] },
});
```

- [ ] **Step 3: 隔離設定の追記**

`.gitignore` に追記:
```
# observatory（観測ツールのスナップショット。実データ由来なのでコミットしない）
tools/observatory/snapshots/
```

`eslint.config.mjs` の ignores に `"tools/**"` を追加（既存 `ignores` 配列があればそこへ、無ければ先頭に `{ ignores: ["tools/**"] }` を追加）。

`package.json` の `scripts` に追加:
```json
    "observe": "node --experimental-strip-types tools/observatory/server.ts",
    "observe:test": "vitest --config tools/observatory/vitest.config.ts run"
```

- [ ] **Step 4: root 型/lint がツールを拾わないことを確認**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: PASS（`tools/` 由来のエラーが出ない。root tsconfig は `src` のみ include の想定。もし root tsconfig が `tools` を拾うなら root tsconfig の `exclude` に `"tools"` を追加する）。

- [ ] **Step 5: コミット**

```bash
git add tools/observatory/tsconfig.json tools/observatory/vitest.config.ts .gitignore eslint.config.mjs package.json
git commit -m "chore: observatory ツールをアプリのビルド/型/lint から隔離"
```

---

## Task 4: observe.ts — 役割判定・上書き・generate キャプチャ

**Files:**
- Create: `tools/observatory/observe.ts`
- Test: `tools/observatory/observe.test.ts`

役割判定辞書は run 開始時に呼び出し側が構築して渡す（chat の system は config 駆動で揺れるため）。

- [ ] **Step 1: 失敗するテストを書く**

`tools/observatory/observe.test.ts`:
```ts
import { expect, test } from "vitest";
import { generateText, Output, wrapLanguageModel } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";
import { createObserver } from "./observe";

function mockGen(text: string) {
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: "text", text }],
      finishReason: "stop", usage: { inputTokens: 5, outputTokens: 7, totalTokens: 12 },
      warnings: [],
    }),
  });
}

test("rewrite モデルの system 文字列から役割を判定し trace に記録する", async () => {
  const observer = createObserver({
    roleSystems: { grade: "GRADE_SYS", queryRewrite: "REWRITE_SYS", verify: "VERIFY_SYS", revise: "REVISE_SYS" },
    chatSystem: "CHAT_SYS",
    overrides: {},
  });
  const model = wrapLanguageModel({ model: mockGen("ok"), middleware: observer.wrap(mockGen("ok"), "rewrite") as never });
  // wrap は (baseModel,hint) を受け、middleware ではなく包んだモデルを返す設計にする：
  const wrapped = observer.wrap(mockGen("ok"), "rewrite");
  await generateText({ model: wrapped, system: "GRADE_SYS", prompt: "{}" });
  const t = observer.traces.at(-1)!;
  expect(t.role).toBe("grade");
  expect(t.response.text).toBe("ok");
  expect(t.request.overridden).toBe(false);
});

test("overrides があれば system を差し替え overridden=true", async () => {
  const observer = createObserver({
    roleSystems: { grade: "GRADE_SYS", queryRewrite: "R", verify: "V", revise: "RV" },
    chatSystem: "CHAT_SYS",
    overrides: { grade: "NEW_GRADE" },
  });
  let sentSystem = "";
  const sniff = new MockLanguageModelV3({
    doGenerate: async (opts) => {
      const sys = (opts.prompt as Array<{ role: string; content: unknown }>).find((m) => m.role === "system");
      sentSystem = sys?.content as string;
      return { content: [{ type: "text", text: "x" }], finishReason: "stop", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, warnings: [] };
    },
  });
  const wrapped = observer.wrap(sniff, "rewrite");
  await generateText({ model: wrapped, system: "GRADE_SYS", prompt: "{}" });
  expect(sentSystem).toBe("NEW_GRADE");
  expect(observer.traces.at(-1)!.request.overridden).toBe(true);
});

test("chat hint は常に role=chat、structured 出力の raw を保持", async () => {
  const observer = createObserver({ roleSystems: { grade: "G", queryRewrite: "R", verify: "V", revise: "RV" }, chatSystem: "CHAT_SYS", overrides: {} });
  const model = new MockLanguageModelV3({
    doGenerate: async () => ({ content: [{ type: "text", text: '{"relevantIds":["a"]}' }], finishReason: "stop", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, warnings: [] }),
  });
  const wrapped = observer.wrap(model, "chat");
  await generateText({ model: wrapped, output: Output.object({ schema: z.object({ relevantIds: z.array(z.string()) }) }), system: "CHAT_SYS", prompt: "{}" });
  expect(observer.traces.at(-1)!.role).toBe("chat");
});
```

注: 1番目テストの冗長な `wrapLanguageModel` 行は実装に合わせ削除してよい（`observer.wrap` が完成モデルを返す）。

- [ ] **Step 2: 失敗を確認**

Run: `pnpm observe:test tools/observatory/observe.test.ts`
Expected: FAIL（`./observe` が存在しない）

- [ ] **Step 3: 実装**

`tools/observatory/observe.ts`:
```ts
import { wrapLanguageModel, type LanguageModel, type LanguageModelMiddleware } from "ai";
import type { ModelMessage } from "ai";

export type Role = "chat" | "grade" | "queryRewrite" | "verify" | "revise";

export interface RoleSystems {
  grade: string; queryRewrite: string; verify: string; revise: string;
}

export interface LlmTrace {
  seq: number;
  role: Role | "rewrite:unknown";
  startedAt: number;
  durationMs: number;
  request: { system: string; messages: unknown; tools?: string[]; responseFormat?: unknown; overridden: boolean };
  response: { text: string; toolCalls?: { name: string; input: unknown }[]; finishReason?: string; usage?: unknown };
  error?: string;
}

export interface ObserverConfig {
  roleSystems: RoleSystems;
  chatSystem: string;
  overrides: Partial<Record<Role, string>>;
  onTrace?: (t: LlmTrace) => void;
}

interface PromptMsg { role: string; content: unknown }

function systemOf(prompt: unknown): string {
  const arr = (prompt as PromptMsg[]) ?? [];
  const sys = arr.find((m) => m.role === "system");
  return typeof sys?.content === "string" ? sys.content : "";
}

function setSystem(prompt: unknown, text: string): unknown {
  const arr = [...((prompt as PromptMsg[]) ?? [])];
  const i = arr.findIndex((m) => m.role === "system");
  if (i >= 0) arr[i] = { role: "system", content: text };
  else arr.unshift({ role: "system", content: text });
  return arr;
}

export function createObserver(cfg: ObserverConfig) {
  const traces: LlmTrace[] = [];
  let seq = 0;

  const detect = (system: string, hint: "chat" | "rewrite"): Role | "rewrite:unknown" => {
    if (hint === "chat") return "chat";
    if (system === cfg.roleSystems.grade) return "grade";
    if (system === cfg.roleSystems.queryRewrite) return "queryRewrite";
    if (system === cfg.roleSystems.verify) return "verify";
    if (system === cfg.roleSystems.revise) return "revise";
    return "rewrite:unknown";
  };

  function wrap(model: LanguageModel, hint: "chat" | "rewrite"): LanguageModel {
    const middleware: LanguageModelMiddleware = {
      transformParams: async ({ params }) => {
        const originalSystem = systemOf(params.prompt);
        const role = detect(originalSystem, hint);
        const overrideKey = role === "rewrite:unknown" ? undefined : (role as Role);
        const override = overrideKey ? cfg.overrides[overrideKey] : undefined;
        const overridden = typeof override === "string" && override.length > 0;
        // 採番してこの呼び出しの trace スロットを予約（wrapGenerate/Stream で確定）。
        const t: LlmTrace = {
          seq: ++seq, role, startedAt: Date.now(), durationMs: 0,
          request: {
            system: overridden ? override! : originalSystem,
            messages: params.prompt,
            responseFormat: params.responseFormat,
            overridden,
          },
          response: { text: "" },
        };
        traces.push(t);
        (params as { __traceSeq?: number }).__traceSeq = t.seq;
        if (overridden) return { ...params, prompt: setSystem(params.prompt, override!) };
        return params;
      },
      wrapGenerate: async ({ doGenerate, params }) => {
        const t = traces.find((x) => x.seq === (params as { __traceSeq?: number }).__traceSeq);
        try {
          const res = await doGenerate();
          if (t) {
            t.durationMs = Date.now() - t.startedAt;
            const text = res.content.filter((c) => c.type === "text").map((c) => (c as { text: string }).text).join("");
            t.response = {
              text,
              toolCalls: res.content.filter((c) => c.type === "tool-call").map((c) => ({ name: (c as { toolName: string }).toolName, input: (c as { input: unknown }).input })),
              finishReason: res.finishReason,
              usage: res.usage,
            };
            cfg.onTrace?.(t);
          }
          return res;
        } catch (err) {
          if (t) { t.error = err instanceof Error ? err.message : String(err); t.durationMs = Date.now() - t.startedAt; cfg.onTrace?.(t); }
          throw err;
        }
      },
      wrapStream: async ({ doStream, params }) => {
        const t = traces.find((x) => x.seq === (params as { __traceSeq?: number }).__traceSeq);
        const { stream, ...rest } = await doStream();
        let text = "";
        const toolCalls: { name: string; input: unknown }[] = [];
        let finishReason: string | undefined;
        let usage: unknown;
        const tap = new TransformStream({
          transform(part, controller) {
            const p = part as { type: string; delta?: string; toolName?: string; input?: unknown; finishReason?: string; usage?: unknown };
            if (p.type === "text-delta" && typeof p.delta === "string") text += p.delta;
            else if (p.type === "tool-call") toolCalls.push({ name: p.toolName ?? "", input: p.input });
            else if (p.type === "finish") { finishReason = p.finishReason; usage = p.usage; }
            controller.enqueue(part);
          },
          flush() {
            if (t) {
              t.durationMs = Date.now() - t.startedAt;
              t.response = { text, toolCalls, finishReason, usage };
              cfg.onTrace?.(t);
            }
          },
        });
        return { stream: stream.pipeThrough(tap), ...rest };
      },
    };
    return wrapLanguageModel({ model, middleware });
  }

  return { traces, wrap };
}
```

注: v6 の stream part の `text-delta` は `delta` フィールド。テストが `text` を見ているなら実装に合わせる（ここでは `delta`）。`MockLanguageModelV3` の doStream を使う stream テストは Task 5 で扱う。

- [ ] **Step 4: 合格を確認**

Run: `pnpm observe:test tools/observatory/observe.test.ts`
Expected: PASS（3 件）

- [ ] **Step 5: コミット**

```bash
git add tools/observatory/observe.ts tools/observatory/observe.test.ts
git commit -m "feat: observatory の LLM 観測ミドルウェア（役割判定・上書き・generateキャプチャ）"
```

---

## Task 5: observe.ts — stream パススルーのキャプチャ

**Files:**
- Modify: `tools/observatory/observe.test.ts`（stream テスト追加）

- [ ] **Step 1: 失敗するテストを追加**

`tools/observatory/observe.test.ts` に追加:
```ts
import { simulateReadableStream } from "ai";
import { streamText } from "ai";

test("stream を消費しつつ全 delta を連結して trace に残す", async () => {
  const observer = createObserver({ roleSystems: { grade: "G", queryRewrite: "R", verify: "V", revise: "RV" }, chatSystem: "CHAT_SYS", overrides: {} });
  const model = new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "text-start", id: "t" },
          { type: "text-delta", id: "t", delta: "Hello " },
          { type: "text-delta", id: "t", delta: "world" },
          { type: "text-end", id: "t" },
          { type: "finish", finishReason: "stop", usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 } },
        ],
      }),
    }),
  });
  const wrapped = observer.wrap(model, "chat");
  const result = streamText({ model: wrapped, system: "CHAT_SYS", prompt: "hi" });
  let consumed = "";
  for await (const d of result.textStream) consumed += d;
  expect(consumed).toBe("Hello world");           // 消費側は壊れない
  expect(observer.traces.at(-1)!.response.text).toBe("Hello world"); // 観測も全文取れる
});
```

- [ ] **Step 2: 失敗を確認**

Run: `pnpm observe:test tools/observatory/observe.test.ts`
Expected: 既に Task 4 実装で PASS する見込み。FAIL する場合は stream part のフィールド名（`delta` vs `text`）を実 SDK に合わせて Task 4 の `wrapStream` を修正。

- [ ] **Step 3: 必要なら実装修正**

stream part 名の差異のみ。`p.delta` を使う（v6 の `text-delta` は `delta`）。

- [ ] **Step 4: 合格を確認**

Run: `pnpm observe:test`
Expected: PASS（全件）

- [ ] **Step 5: コミット**

```bash
git add tools/observatory/observe.test.ts tools/observatory/observe.ts
git commit -m "test: stream パススルー観測の検証を追加"
```

---

## Task 6: replay.ts — snapshot 保存/再生 transport

**Files:**
- Create: `tools/observatory/replay.ts`
- Test: `tools/observatory/replay.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`tools/observatory/replay.test.ts`:
```ts
import { afterEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createReplayTransport } from "./replay";

const dirs: string[] = [];
function tmp() { const d = mkdtempSync(join(tmpdir(), "obs-")); dirs.push(d); return d; }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

test("live: 実 fetch を呼び応答を保存し、同内容を返す", async () => {
  const dir = tmp();
  let hits = 0;
  const upstream = async () => { hits++; return new Response(JSON.stringify({ chunks: [{ id: "c1" }] }), { headers: { "content-type": "application/json" } }); };
  const t = createReplayTransport({ mode: "live", dir, upstream });
  const res = await t("http://rag/retrieve", { method: "POST", body: JSON.stringify({ query: "x" }) });
  expect(await res.json()).toEqual({ chunks: [{ id: "c1" }] });
  expect(hits).toBe(1);
});

test("replay: 保存済みは upstream を呼ばず再生、未保存は live フォールバックして保存", async () => {
  const dir = tmp();
  let hits = 0;
  const upstream = async () => { hits++; return new Response("RESP-" + hits, {}); };
  const live = createReplayTransport({ mode: "live", dir, upstream });
  await live("http://rag/retrieve", { method: "POST", body: JSON.stringify({ query: "x" }) }); // 保存
  const replay = createReplayTransport({ mode: "replay", dir, upstream });
  const r1 = await replay("http://rag/retrieve", { method: "POST", body: JSON.stringify({ query: "x" }) });
  expect(await r1.text()).toBe("RESP-1"); // 再生（upstream 不使用）
  expect(hits).toBe(1);
  const r2 = await replay("http://rag/retrieve", { method: "POST", body: JSON.stringify({ query: "NEW" }) });
  expect(await r2.text()).toBe("RESP-2"); // 未保存 → live フォールバック
  expect(hits).toBe(2);
});
```

- [ ] **Step 2: 失敗を確認**

Run: `pnpm observe:test tools/observatory/replay.test.ts`
Expected: FAIL（`./replay` が無い）

- [ ] **Step 3: 実装**

`tools/observatory/replay.ts`:
```ts
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface ReplayOptions {
  mode: "live" | "replay";
  dir: string;
  /** 既定は実 fetch。テストでは差し替える。 */
  upstream?: typeof fetch;
}

interface Snapshot { status: number; headers: [string, string][]; bodyB64: string; }

function keyOf(url: string, init?: RequestInit): string {
  const method = (init?.method ?? "GET").toUpperCase();
  const path = new URL(url, "http://x").pathname;
  const body = typeof init?.body === "string" ? init.body : "";
  // body 内のキー順を正規化（JSON のときのみ）。
  let canon = body;
  try { canon = JSON.stringify(JSON.parse(body), Object.keys(JSON.parse(body)).sort()); } catch { /* 非JSONはそのまま */ }
  return createHash("sha256").update(`${method}:${path}:${canon}`).digest("hex").slice(0, 32);
}

async function toSnapshot(res: Response): Promise<Snapshot> {
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, headers: [...res.headers.entries()], bodyB64: buf.toString("base64") };
}

function fromSnapshot(s: Snapshot): Response {
  return new Response(Buffer.from(s.bodyB64, "base64"), { status: s.status, headers: s.headers });
}

export function createReplayTransport(opts: ReplayOptions): typeof fetch {
  mkdirSync(opts.dir, { recursive: true });
  const up = opts.upstream ?? fetch;
  const transport = (async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const file = join(opts.dir, keyOf(url, init) + ".json");
    if (opts.mode === "replay" && existsSync(file)) {
      return fromSnapshot(JSON.parse(readFileSync(file, "utf8")) as Snapshot);
    }
    // live、または replay で未保存：上流を呼び全バイトをバッファして保存し、複製を返す。
    const res = await up(input as never, init);
    const snap = await toSnapshot(res);
    writeFileSync(file, JSON.stringify(snap));
    return fromSnapshot(snap);
  }) as typeof fetch;
  return transport;
}
```

- [ ] **Step 4: 合格を確認**

Run: `pnpm observe:test tools/observatory/replay.test.ts`
Expected: PASS（2 件）

- [ ] **Step 5: コミット**

```bash
git add tools/observatory/replay.ts tools/observatory/replay.test.ts
git commit -m "feat: observatory の retrieve snapshot/replay transport"
```

---

## Task 7: server.ts — Vite middlewareMode + SSE API

**Files:**
- Create: `tools/observatory/server.ts`

役割辞書は run ごとに `getAgentPrompts(locale)` と `buildSystemPrompt(cfg, locale)` から構築する。

- [ ] **Step 1: 実装**

`tools/observatory/server.ts`:
```ts
import { createServer as createViteServer } from "vite";
import { createServer as createHttpServer } from "node:http";
import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createObserver, type RoleSystems } from "./observe";
import { createReplayTransport } from "./replay";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: join(__dirname, "../../.env.local") });

const PORT = Number(process.env.OBSERVE_PORT ?? 3030);
const OWNER = process.env.OBSERVE_OWNER_ID ?? "observe-owner";
const SNAP_DIR = join(__dirname, "snapshots");

const vite = await createViteServer({
  root: __dirname,
  server: { middlewareMode: true },
  appType: "custom",
  resolve: { alias: { "@": join(__dirname, "../../src") } },
});

// SDK モジュールはエイリアス解決込みで Vite SSR ローダから読む。
const run = await vite.ssrLoadModule("@/lib/agent/run.ts");
const prompts = await vite.ssrLoadModule("@/lib/agent/prompts.ts");
const cfgMod = await vite.ssrLoadModule("@/lib/agent/config.ts");
const ragClient = await vite.ssrLoadModule("@/lib/rag-client.ts");

function roleSystemsFor(locale: string): { roleSystems: RoleSystems; chatSystem: (cfg: unknown) => string } {
  const p = prompts.getAgentPrompts(locale);
  return {
    roleSystems: { grade: p.grade.system, queryRewrite: p.queryRewrite.system, verify: p.verify.system, revise: p.revise.system },
    chatSystem: (cfg: unknown) => cfgMod.buildSystemPrompt(cfg, locale),
  };
}

const http = createHttpServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (url.pathname === "/api/defaults") {
    const locale = url.searchParams.get("locale") ?? "ja";
    const { roleSystems, chatSystem } = roleSystemsFor(locale);
    const cfg = cfgMod.AGENT_CFG_DEFAULTS;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ chat: chatSystem(cfg), ...roleSystems, cfg }));
    return;
  }

  if (url.pathname === "/api/run" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      const { query, model, locale = "ja", cfg, overrides = {}, retrieveMode = "replay" } = JSON.parse(body || "{}");
      res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" });
      const send = (o: unknown) => res.write(`data: ${JSON.stringify(o)}\n\n`);

      const { roleSystems, chatSystem } = roleSystemsFor(locale);
      const resolvedCfg = cfg ?? cfgMod.AGENT_CFG_DEFAULTS;
      const observer = createObserver({
        roleSystems, chatSystem: chatSystem(resolvedCfg), overrides,
        onTrace: (t) => send({ kind: "trace", trace: t }),
      });
      ragClient.setRagTransport(createReplayTransport({ mode: retrieveMode, dir: SNAP_DIR }));
      try {
        for await (const ev of run.runAgent({
          query, ownerUserId: OWNER, threadId: "observe", modelId: model, locale, agentCfg: resolvedCfg,
          observe: { wrap: observer.wrap },
        })) {
          send({ kind: "event", event: ev });
        }
      } catch (err) {
        send({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        ragClient.setRagTransport(null);
        send({ kind: "end" });
        res.end();
      }
    });
    return;
  }

  if (url.pathname === "/api/snapshots" && req.method === "DELETE") {
    const { rmSync, mkdirSync } = require("node:fs");
    rmSync(SNAP_DIR, { recursive: true, force: true });
    mkdirSync(SNAP_DIR, { recursive: true });
    res.end("{}");
    return;
  }

  // それ以外は Vite に委譲（UI を HMR 配信）。
  vite.middlewares(req, res);
});

http.listen(PORT, () => console.log(`observatory: http://localhost:${PORT}`));
```

依存追加: `dotenv` が無ければ devDependency に追加（`pnpm add -D dotenv`）。`vite` は既存。

- [ ] **Step 2: 起動スモーク**

Run（フルスタック起動済み前提）: `pnpm observe`、別端末で `curl -s 'http://localhost:3030/api/defaults?locale=ja' | head -c 200`
Expected: `chat`/`grade`/`verify`/`revise`/`queryRewrite`/`cfg` を含む JSON。

- [ ] **Step 3: コミット**

```bash
git add tools/observatory/server.ts package.json pnpm-lock.yaml
git commit -m "feat: observatory サーバ（Vite middlewareMode + SSE run/defaults）"
```

---

## Task 8: UI — ダッシュボード（index.html + React）

**Files:**
- Create: `tools/observatory/index.html`、`tools/observatory/ui/main.tsx`、`tools/observatory/ui/App.tsx`

- [ ] **Step 1: index.html**

`tools/observatory/index.html`:
```html
<!doctype html>
<html lang="ja">
  <head><meta charset="utf-8" /><title>LLM Observatory</title>
    <style>
      body { font: 13px/1.5 ui-monospace, monospace; margin: 0; display: grid; grid-template-columns: 380px 1fr; height: 100vh; }
      .left { padding: 12px; border-right: 1px solid #ccc; overflow: auto; }
      .right { padding: 12px; overflow: auto; }
      textarea { width: 100%; min-height: 70px; font: inherit; }
      .trace { border: 1px solid #ddd; border-radius: 6px; margin: 8px 0; padding: 8px; }
      .badge { background: #e0b; color: #fff; border-radius: 4px; padding: 0 4px; font-size: 11px; }
      pre { white-space: pre-wrap; word-break: break-all; background: #f6f6f6; padding: 6px; }
      details summary { cursor: pointer; }
    </style>
  </head>
  <body><div id="root"></div><script type="module" src="/ui/main.tsx"></script></body>
</html>
```

- [ ] **Step 2: main.tsx**

`tools/observatory/ui/main.tsx`:
```tsx
import { createRoot } from "react-dom/client";
import { App } from "./App";
createRoot(document.getElementById("root")!).render(<App />);
```

- [ ] **Step 3: App.tsx**

`tools/observatory/ui/App.tsx`:
```tsx
import { useEffect, useState } from "react";

type Role = "chat" | "grade" | "queryRewrite" | "verify" | "revise";
const ROLES: Role[] = ["chat", "grade", "queryRewrite", "verify", "revise"];
interface Trace { seq: number; role: string; durationMs: number; request: { system: string; messages: unknown; overridden: boolean }; response: { text: string; usage?: unknown }; error?: string }

export function App() {
  const [defaults, setDefaults] = useState<Record<string, string>>({});
  const [overrides, setOverrides] = useState<Partial<Record<Role, string>>>({});
  const [query, setQuery] = useState("");
  const [locale, setLocale] = useState("ja");
  const [retrieveMode, setRetrieveMode] = useState<"live" | "replay">("replay");
  const [traces, setTraces] = useState<Trace[]>([]);
  const [events, setEvents] = useState<unknown[]>([]);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    fetch(`/api/defaults?locale=${locale}`).then((r) => r.json()).then(setDefaults);
  }, [locale]);

  async function runIt() {
    setTraces([]); setEvents([]); setRunning(true);
    const res = await fetch("/api/run", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, locale, retrieveMode, overrides }),
    });
    const reader = res.body!.getReader(); const dec = new TextDecoder(); let buf = "";
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split("\n\n"); buf = parts.pop() ?? "";
      for (const p of parts) {
        const line = p.replace(/^data: /, ""); if (!line) continue;
        const msg = JSON.parse(line);
        if (msg.kind === "trace") setTraces((t) => [...t.filter((x) => x.seq !== msg.trace.seq), msg.trace].sort((a, b) => a.seq - b.seq));
        else if (msg.kind === "event") setEvents((e) => [...e, msg.event]);
      }
    }
    setRunning(false);
  }

  return (
    <>
      <div className="left">
        <div><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="質問" style={{ width: "75%" }} />
          <button disabled={running || !query} onClick={runIt}>▶Run</button></div>
        <div>locale <select value={locale} onChange={(e) => setLocale(e.target.value)}><option>ja</option><option>zh</option></select>
          {" "}retrieve <select value={retrieveMode} onChange={(e) => setRetrieveMode(e.target.value as "live" | "replay")}><option value="replay">replay</option><option value="live">live</option></select></div>
        <h4>プロンプト上書き</h4>
        {ROLES.map((r) => (
          <details key={r}>
            <summary>{r}{overrides[r] ? " *" : ""}</summary>
            <textarea value={overrides[r] ?? defaults[r] ?? ""} onChange={(e) => setOverrides((o) => ({ ...o, [r]: e.target.value }))} />
            <button onClick={() => setOverrides((o) => { const n = { ...o }; delete n[r]; return n; })}>既定に戻す</button>
          </details>
        ))}
      </div>
      <div className="right">
        <h4>実行トレース</h4>
        {traces.map((t) => (
          <div className="trace" key={t.seq}>
            <b>{t.seq} {t.role}</b> {t.request.overridden && <span className="badge">overridden</span>} <small>{t.durationMs}ms</small>
            {t.error && <pre style={{ color: "red" }}>{t.error}</pre>}
            <details><summary>送信 system</summary><pre>{t.request.system}</pre></details>
            <details><summary>送信 messages</summary><pre>{JSON.stringify(t.request.messages, null, 2)}</pre></details>
            <details open><summary>出力</summary><pre>{t.response.text}</pre></details>
            <details><summary>usage</summary><pre>{JSON.stringify(t.response.usage, null, 2)}</pre></details>
          </div>
        ))}
        <h4>最終回答（events）</h4>
        <pre>{events.filter((e: unknown) => (e as { type?: string }).type === "answer-delta").map((e) => (e as { text: string }).text).join("")}</pre>
        <button onClick={() => navigator.clipboard.writeText(JSON.stringify({ traces, events }, null, 2))}>トレースをコピー</button>
      </div>
    </>
  );
}
```

依存: `react` / `react-dom` は既存。Vite は `.tsx` を変換できる（root が tools なので `@vitejs/plugin-react` を `createViteServer` の plugins に追加する必要あり）。Task 7 の `createViteServer` に `plugins: [react()]`（`import react from "@vitejs/plugin-react"`）を追加。無ければ `pnpm add -D @vitejs/plugin-react`。

- [ ] **Step 2: 起動確認**

Run: `pnpm observe` → ブラウザで `http://localhost:3030`
Expected: 質問欄・プロンプト編集欄・Run ボタンが表示され、defaults がプリフィルされる。

- [ ] **Step 3: コミット**

```bash
git add tools/observatory/index.html tools/observatory/ui package.json pnpm-lock.yaml tools/observatory/server.ts
git commit -m "feat: observatory ダッシュボード UI"
```

---

## Task 9: 手動 E2E と README

**Files:**
- Create: `tools/observatory/README.md`

- [ ] **Step 1: README に手順を書く**

`tools/observatory/README.md`:
```md
# LLM/プロンプト観測ダッシュボード

アプリ本体とは別枠の dev 専用ツール。本番と同じ `runAgent` を別ポートで回し、
全 LLM 呼び出しの生プロンプト/生出力を観測する。

## 起動
1. フルスタックを起動（rag/postgres/qdrant/redis）。
2. `.env.local` に API キーと `RAG_SERVICE_URL` を設定。`OBSERVE_OWNER_ID` に観測用の
   既存 owner（索引済み文書を持つ）を指定。
3. `pnpm observe` → http://localhost:3030

## 使い方
- 質問を入れて Run。右ペインに chat/grade/queryRewrite/verify/revise の trace が出る。
- retrieve=live で1回流すと snapshot が保存され、以降 replay で検索が固定される。
- 左ペインの各プロンプトを編集して Run すると、その system が差し替わって再実行される。

## スナップショット
`tools/observatory/snapshots/`（gitignore）。クリアは `curl -X DELETE localhost:3030/api/snapshots`。
```

- [ ] **Step 2: 手動 E2E チェックリスト実行**

1. `pnpm observe:test`（observe/replay ユニット）→ 全 PASS。
2. `pnpm test`（アプリ単体）→ 回帰なし（observe 未指定で既存不変）。
3. フルスタックで `pnpm observe` → 実質問1回（live）→ 5役の trace が出る。
4. retrieve=replay に切替え → 同質問で検索が固定。
5. chat の system を編集 → 出力が変化、trace に `overridden` バッジ。

- [ ] **Step 3: コミット**

```bash
git add tools/observatory/README.md
git commit -m "docs: observatory の起動手順と手動E2Eを追加"
```

---

## Self-Review（記入済み）

- **Spec coverage:** 観測対象5役（Task 4/5）、初回実・以降リプレイ（Task 6）、別ポート/SSE/defaults（Task 7）、5プロンプト上書き UI（Task 8）、隔離（Task 3）、本番シーム（Task 1/2）— 全節に対応タスクあり。
- **Placeholder scan:** 各コードステップは実コードを記載。残課題は stream part のフィールド名（`delta`）の SDK 実差異のみで、Task 5 Step 2/3 に検証・修正手順を明示。
- **Type consistency:** `createObserver(cfg).wrap(model, hint)` と `RunInput.observe.wrap(model, hint)` の引数（model, "chat"|"rewrite"）が一致。`RoleSystems` のキー（grade/queryRewrite/verify/revise）は observe/server で一致。`createReplayTransport({mode,dir,upstream})` は test/server で一致。
- **既知リスク:** (1) root tsconfig が `tools` を拾う場合は Task 3 Step 4 で `exclude` 追加。(2) `node --experimental-strip-types` が TS の一部構文で失敗する場合は `vite-node tools/observatory/server.ts` に切替（Task 7）。
