# フェーズ5: 生成と履歴永続化

> 前提・共通規約は [README.md](./README.md) を参照。

**このフェーズのゴール:** `run.ts` を実 `/retrieve`（フェーズ4）+ Haiku クエリ書換 + Sonnet 生成に再構築し、回答・ツールステップ・引用・ソースを Postgres に永続化。スレッド一覧・履歴復元を実データ化する。旧 lexical retriever を撤去。

**依存:** フェーズ2, 4

**作成/変更するファイル:**
- Modify: `src/lib/db/schema.ts`（threads/messages/citations）, `drizzle/`（マイグレーション）
- Create: `src/lib/threads.ts`（リポジトリ + 復元変換）
- Create: `src/app/api/threads/route.ts`, `src/app/api/threads/[id]/route.ts`
- Modify: `src/lib/types.ts`（`AgentEvent.done` に `sources`/`threadId`、`RetrievedChunk`→`Source` 変換）
- Modify: `src/lib/agent/run.ts`（全面再構築）、Delete: `src/lib/agent/retriever.ts`（lexical 版）
- Modify: `src/app/api/chat/route.ts`（threadId 解決 + 永続化）
- Modify: `src/hooks/use-agent.ts`（`sources` 状態 + 復元）
- Modify: `src/components/workspace/workspace.tsx`（API からスレッド/履歴/ソース）
- Tests: `src/lib/threads.test.ts`, `src/app/api/threads/threads.test.ts`, `src/lib/agent/run.test.ts`

---

### Task 1: threads / messages / citations スキーマ

**Files:**
- Modify: `src/lib/db/schema.ts`

- [ ] **Step 1: テーブル追加**

`src/lib/db/schema.ts` に追記:
```ts
import { pgTable, uuid, text, timestamp, integer, boolean, jsonb } from "drizzle-orm/pg-core";

export const threads = pgTable("threads", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  pinned: boolean("pinned").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const messages = pgTable("messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  threadId: uuid("thread_id").notNull().references(() => threads.id, { onDelete: "cascade" }),
  query: text("query").notNull(),
  answerText: text("answer_text").notNull(),
  tokens: integer("tokens").notNull().default(0),
  durationMs: integer("duration_ms").notNull().default(0),
  steps: jsonb("steps").$type<unknown[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const citations = pgTable("citations", {
  id: uuid("id").defaultRandom().primaryKey(),
  messageId: uuid("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
  ordinal: integer("ordinal").notNull(),
  documentId: text("document_id").notNull(),
  documentTitle: text("document_title").notNull(),
  chunkId: text("chunk_id").notNull(),
  sectionId: text("section_id").notNull(),
  headingPath: text("heading_path").notNull().default(""),
  snippet: text("snippet").notNull(),
});

export type ThreadRow = typeof threads.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type CitationRow = typeof citations.$inferSelect;
```

- [ ] **Step 2: マイグレーション生成・適用**

Run: `pnpm drizzle-kit generate && pnpm drizzle-kit migrate`
Expected: threads/messages/citations が作成される。

- [ ] **Step 3: コミット**

```bash
git add src/lib/db/schema.ts drizzle/
git commit -m "feat: threads/messages/citations スキーマを追加"
```

---

### Task 2: スレッドリポジトリと API（TDD）

**Files:**
- Create: `src/lib/threads.ts`, `src/lib/threads.test.ts`
- Create: `src/app/api/threads/route.ts`, `src/app/api/threads/[id]/route.ts`
- Create: `src/app/api/threads/threads.test.ts`

- [ ] **Step 1: 失敗テスト（リポジトリ）**

`src/lib/threads.test.ts`:
```ts
import { afterAll, beforeAll, expect, test } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { createUser } from "@/lib/users";
import {
  createThread, listThreads, saveCompletedMessage, getThreadDetail,
} from "@/lib/threads";

let userId: string;
const email = `thr_${Date.now()}@example.com`;

beforeAll(async () => {
  const u = await createUser({ email, password: "pw-secret-123", name: "T U" });
  userId = u.id;
});
afterAll(async () => {
  await db.execute(sql`delete from users where id = ${userId}`);
});

test("create, save message+citations, list, and reconstruct", async () => {
  const t = await createThread(userId, "認証について");
  await saveCompletedMessage({
    threadId: t.id, query: "認証について", answerText: "失効します[1]。",
    tokens: 12, durationMs: 800, steps: [{ id: "s1" }],
    citations: [{ ordinal: 1, documentId: "d1", documentTitle: "設計.pdf",
      chunkId: "c1", sectionId: "c1", headingPath: "認証", snippet: "失効する" }],
  });

  const list = await listThreads(userId);
  expect(list.find((x) => x.id === t.id)?.title).toBe("認証について");

  const detail = await getThreadDetail(t.id, userId);
  expect(detail?.completed.answerText).toBe("失効します[1]。");
  expect(detail?.sources[0].id).toBe("d1");
  expect(detail?.citationMap[1]).toMatchObject({ sourceId: "d1", sectionId: "c1" });
});
```

- [ ] **Step 2: 失敗を確認 → 実装**

Run: `pnpm test src/lib/threads.test.ts` → FAIL

`src/lib/threads.ts`:
```ts
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { citations, messages, threads } from "@/lib/db/schema";
import type {
  CitationMap, CompletedThread, Source, ThreadSummary, ToolCall,
} from "@/lib/types";
import { relativeTime } from "@/lib/utils";

export async function createThread(userId: string, title: string) {
  const [row] = await db.insert(threads).values({ userId, title: title.slice(0, 80) }).returning();
  return row;
}

export async function listThreads(userId: string): Promise<ThreadSummary[]> {
  const rows = await db.select().from(threads)
    .where(eq(threads.userId, userId))
    .orderBy(desc(threads.pinned), desc(threads.updatedAt));
  return rows.map((t) => ({
    id: t.id, title: t.title, updated: relativeTime(t.updatedAt), pinned: t.pinned,
  }));
}

export interface SaveInput {
  threadId: string;
  query: string;
  answerText: string;
  tokens: number;
  durationMs: number;
  steps: unknown[];
  citations: Array<{
    ordinal: number; documentId: string; documentTitle: string;
    chunkId: string; sectionId: string; headingPath: string; snippet: string;
  }>;
}

export async function saveCompletedMessage(input: SaveInput): Promise<void> {
  const [msg] = await db.insert(messages).values({
    threadId: input.threadId, query: input.query, answerText: input.answerText,
    tokens: input.tokens, durationMs: input.durationMs, steps: input.steps,
  }).returning();
  if (input.citations.length) {
    await db.insert(citations).values(input.citations.map((c) => ({ ...c, messageId: msg.id })));
  }
  await db.update(threads).set({ updatedAt: new Date() }).where(eq(threads.id, input.threadId));
}

export interface ThreadDetail {
  completed: CompletedThread;
  sources: Source[];
  citationMap: CitationMap;
  steps: ToolCall[];
}

/** 最新メッセージから会話スナップショットを復元（引用の denormalized 値のみ使用）。 */
export async function getThreadDetail(threadId: string, userId: string): Promise<ThreadDetail | null> {
  const [t] = await db.select().from(threads)
    .where(and(eq(threads.id, threadId), eq(threads.userId, userId)));
  if (!t) return null;

  const [msg] = await db.select().from(messages)
    .where(eq(messages.threadId, threadId))
    .orderBy(desc(messages.createdAt)).limit(1);
  if (!msg) {
    return { completed: { query: t.title, answerText: "", tokens: 0, durationMs: 0 },
             sources: [], citationMap: {}, steps: [] };
  }

  const cites = await db.select().from(citations).where(eq(citations.messageId, msg.id));
  const sources = sourcesFromCitations(cites);
  const citationMap: CitationMap = {};
  for (const c of cites) citationMap[c.ordinal] = { sourceId: c.documentId, sectionId: c.sectionId };

  return {
    completed: { query: msg.query, answerText: msg.answerText, tokens: msg.tokens, durationMs: msg.durationMs },
    sources,
    citationMap,
    steps: msg.steps as ToolCall[],
  };
}

function sourcesFromCitations(cites: Array<typeof citations.$inferSelect>): Source[] {
  const byDoc = new Map<string, Source>();
  for (const c of cites) {
    let src = byDoc.get(c.documentId);
    if (!src) {
      src = { id: c.documentId, type: "doc", title: c.documentTitle, path: c.documentTitle,
              author: "", date: "", sections: [] };
      byDoc.set(c.documentId, src);
    }
    if (!src.sections.some((s) => s.id === c.sectionId)) {
      src.sections.push({ id: c.sectionId, heading: c.headingPath, body: c.snippet, highlight: true });
    }
  }
  return [...byDoc.values()];
}
```

> `relativeTime(date)` が `src/lib/utils.ts` に無ければ追加する（`updated` 表示用の相対時刻。例: 「3分前」）。既存 utils の書式に倣う。

- [ ] **Step 3: 合格を確認**

Run: `pnpm test src/lib/threads.test.ts`
Expected: `1 passed`

- [ ] **Step 4: スレッド API（失敗テスト → 実装）**

`src/app/api/threads/threads.test.ts`: register でユーザー作成 → cookie 取得は複雑なため、ルートはリポジトリ層を厚くテスト済みとして、ここでは 401（無 cookie）を確認する薄いテストにする:
```ts
import { expect, test } from "vitest";
import { GET } from "@/app/api/threads/route";

test("threads list requires auth", async () => {
  const res = await GET(new Request("http://test/api/threads"));
  expect(res.status).toBe(401);
});
```

`src/app/api/threads/route.ts`:
```ts
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { verifyAccessToken, authCookieName } from "@/lib/auth";
import { createThread, listThreads } from "@/lib/threads";

export const runtime = "nodejs";

async function userId(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(authCookieName)?.value;
  const claims = token ? await verifyAccessToken(token) : null;
  return claims?.sub ?? null;
}

export async function GET(_req: Request) {
  const uid = await userId();
  if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ threads: await listThreads(uid) });
}

export async function POST(req: Request) {
  const uid = await userId();
  if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { title } = (await req.json().catch(() => ({}))) as { title?: string };
  const t = await createThread(uid, title || "新しいスレッド");
  return NextResponse.json({ thread: { id: t.id, title: t.title, updated: "たった今" } });
}
```

`src/app/api/threads/[id]/route.ts`:
```ts
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { verifyAccessToken, authCookieName } from "@/lib/auth";
import { db } from "@/lib/db";
import { threads } from "@/lib/db/schema";
import { getThreadDetail } from "@/lib/threads";

export const runtime = "nodejs";

async function userId(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(authCookieName)?.value;
  const claims = token ? await verifyAccessToken(token) : null;
  return claims?.sub ?? null;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const uid = await userId();
  if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const detail = await getThreadDetail(id, uid);
  if (!detail) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(detail);
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const uid = await userId();
  if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  await db.delete(threads).where(and(eq(threads.id, id), eq(threads.userId, uid)));
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 5: 合格 + コミット**

Run: `pnpm test src/lib/threads.test.ts src/app/api/threads/threads.test.ts && pnpm lint`
```bash
git add src/lib/threads.ts src/lib/threads.test.ts src/app/api/threads src/lib/utils.ts
git commit -m "feat: スレッド永続化リポジトリと API を追加"
```

---

### Task 3: AgentEvent 拡張（sources / threadId）と use-agent

**Files:**
- Modify: `src/lib/types.ts`, `src/hooks/use-agent.ts`

- [ ] **Step 1: done イベントに sources/threadId を追加**

`src/lib/types.ts` の `AgentEvent` の `done` を変更:
```ts
  | {
      type: "done";
      tokens: number;
      durationMs: number;
      citationMap: CitationMap;
      sourceIds: string[];
      sources: Source[];
      threadId: string;
    }
```

- [ ] **Step 2: use-agent に sources 状態を追加**

`src/hooks/use-agent.ts`:
- `AgentState` に `sources: Source[]` と `threadId: string` を追加（`Source` を import）。
- `EMPTY` の `sources: []`, `threadId: ""`、`sourceIds: []`（SAMPLE 依存を除去）。`citationMap: {}`。
- `applyEvent` の `done` で `sources: event.sources`, `threadId: event.threadId` をセット。
- `loadCompleted` を拡張: 引数に `ThreadDetail` 相当（completed/sources/citationMap/steps）を受け取り、`steps` をそのまま、`sources`/`citationMap` を実値でセットする。シグネチャを `loadCompleted(detail: { completed: CompletedThread; sources: Source[]; citationMap: CitationMap; steps: ToolCall[] })` に変更。
- 先頭の `import { CITATION_MAP, SAMPLE_SOURCES } from "@/lib/data";` を削除。

- [ ] **Step 3: lint（型エラーで workspace が赤くなる→ Task 6 で解消）**

Run: `pnpm lint`
Expected: `use-agent` 自体は型整合。`workspace.tsx` の `loadCompleted` 呼び出し箇所が型不一致になる場合があるが、Task 6 で修正する。ここでは use-agent 単体の整合を確認。

- [ ] **Step 4: コミット**

```bash
git add src/lib/types.ts src/hooks/use-agent.ts
git commit -m "feat: AgentEvent に sources/threadId を追加し use-agent を実データ化"
```

---

### Task 4: run.ts を実フローに再構築（+ 旧 retriever 撤去）

**Files:**
- Modify: `src/lib/agent/run.ts`
- Delete: `src/lib/agent/retriever.ts`
- Create: `src/lib/agent/run.test.ts`

- [ ] **Step 1: 失敗テスト（retrieve-client と AI SDK をモック）**

`src/lib/agent/run.test.ts`:
```ts
import { expect, test, vi } from "vitest";

vi.mock("@/lib/agent/retrieve-client", () => ({
  retrieveChunks: vi.fn(async () => [{
    chunkId: "c1", documentId: "d1", documentTitle: "設計.pdf", headingPath: "認証",
    pageStart: 0, pageEnd: 0, blockType: "text", text: "トークンは24時間で失効する。",
    expandedText: "前文。トークンは24時間で失効する。後文。", score: 0.9,
  }]),
}));
vi.mock("ai", () => ({
  generateText: vi.fn(async () => ({ text: "認証 トークン 失効" })),
  streamText: vi.fn(() => ({
    // async iterable of deltas
    textStream: (async function* () { yield "失効"; yield "します[1]。"; })(),
  })),
}));
vi.mock("@ai-sdk/anthropic", () => ({ anthropic: () => "model" }));

import { runAgent } from "@/lib/agent/run";

test("runAgent yields steps, streams answer, and finishes with sources+citationMap", async () => {
  const events: any[] = [];
  for await (const e of runAgent({ query: "認証は?", ownerUserId: "u1", threadId: "t1" })) {
    events.push(e);
  }
  const answer = events.filter((e) => e.type === "answer-delta").map((e) => e.text).join("");
  expect(answer).toContain("失効");

  const done = events.find((e) => e.type === "done");
  expect(done.threadId).toBe("t1");
  expect(done.sources[0].id).toBe("d1");
  expect(done.sources[0].sections[0].id).toBe("c1");
  expect(done.citationMap[1]).toMatchObject({ sourceId: "d1", sectionId: "c1" });

  // すべてのステップが done になる
  const steps = events.filter((e) => e.type === "step");
  expect(steps.some((e) => e.step.name === "rewrite_query" && e.step.status === "done")).toBe(true);
});
```

- [ ] **Step 2: 失敗を確認 → run.ts を実装**

Run: `pnpm test src/lib/agent/run.test.ts` → FAIL

`src/lib/agent/run.ts`（全置換）:
```ts
/** Server-side agent orchestrator (real backend).
 *
 * rewrite_query は Haiku、検索は rag /retrieve（hybrid+rerank+近傍拡張）、
 * summarize は Sonnet ストリーミング。各ステップを AgentEvent として配信する。 */

import { anthropic } from "@ai-sdk/anthropic";
import { generateText, streamText } from "ai";
import { retrieveChunks, type RetrievedChunk } from "@/lib/agent/retrieve-client";
import { buildInitialSteps } from "@/lib/agent/steps";
import type { AgentEvent, CitationMap, Source, ToolCall } from "@/lib/types";

export interface RunInput {
  query: string;
  ownerUserId: string;
  threadId: string;
  attachments?: string[];
}

export async function* runAgent({ query, ownerUserId, threadId }: RunInput): AsyncGenerator<AgentEvent> {
  const started = Date.now();
  const steps = buildInitialSteps(query);
  const byName = (name: string) => steps.find((s) => s.name === name)!;

  async function* runStep(step: ToolCall, work: () => Promise<Partial<ToolCall>>): AsyncGenerator<AgentEvent> {
    yield { type: "step", step: { ...step, status: "running" } };
    const patch = await work();
    Object.assign(step, patch, { status: "done" as const });
    yield { type: "step", step };
  }

  // 1) rewrite_query (Haiku)
  let rewritten = query;
  for await (const e of runStep(byName("rewrite_query"), async () => {
    try {
      const { text } = await generateText({
        model: anthropic("claude-haiku-4-5"),
        system: "検索意図を保ちつつ、日本語の検索クエリに簡潔に書き換えてください。説明や引用符は不要、クエリ本文のみ返答。",
        prompt: query,
      });
      rewritten = text.trim() || query;
    } catch {
      rewritten = query;
    }
    return { input: { query }, output: { rewritten }, summary: `「${rewritten}」に書き換え` };
  })) yield e;

  // 2) retrieve（1 ホップで dense/sparse/rerank/近傍拡張）
  let chunks: RetrievedChunk[] = [];
  let retrieveError = false;
  try {
    chunks = await retrieveChunks({ query, rewritten, ownerUserId, topK: 6 });
  } catch {
    retrieveError = true;
  }

  for await (const e of runStep(byName("vector_search"), async () =>
    ({ output: { backend: "qdrant", mode: "dense" }, summary: "密ベクトル検索を実行" }))) yield e;
  for await (const e of runStep(byName("bm25_search"), async () =>
    ({ output: { backend: "qdrant", mode: "sparse" }, summary: "スパース(BM25)検索を実行" }))) yield e;
  for await (const e of runStep(byName("rerank"), async () =>
    ({ output: { kept: chunks.length }, summary: `${chunks.length} 件を再順位付け` }))) yield e;
  const docCount = new Set(chunks.map((c) => c.documentId)).size;
  for await (const e of runStep(byName("fetch_document"), async () =>
    ({ output: { documents: docCount }, summary: `${docCount} 件の文書から文脈取得` }))) yield e;

  // 3) sources / citationMap を構築
  const sources = sourcesFromChunks(chunks);
  const citationMap: CitationMap = {};
  chunks.forEach((c, i) => { citationMap[i + 1] = { sourceId: c.documentId, sectionId: c.chunkId }; });
  const sourceIds = sources.map((s) => s.id);

  // 4) summarize (Sonnet streaming)
  const summarize = byName("summarize");
  yield { type: "step", step: { ...summarize, status: "running" } };
  yield { type: "answer-start" };

  let answer = "";
  if (retrieveError) {
    answer = "検索バックエンドに接続できませんでした。時間をおいて再度お試しください。";
    yield { type: "answer-delta", text: answer };
  } else if (chunks.length === 0) {
    answer = "該当する資料が見つかりませんでした。別の言い回しで質問するか、関連ファイルをアップロードしてください。";
    yield { type: "answer-delta", text: answer };
  } else {
    const context = chunks
      .map((c, i) => `[${i + 1}] ${c.documentTitle} — ${c.headingPath}\n${c.expandedText || c.text}`)
      .join("\n\n");
    const result = streamText({
      model: anthropic("claude-sonnet-4-5"),
      system:
        "あなたは社内ナレッジ検索アシスタントです。提供された一次資料のみに基づき日本語で簡潔に回答してください。" +
        "重要な事実には必ず [1] [2] のように出典番号を付け、Markdown の見出し(**太字**)と箇条書き(-)で構造化してください。",
      prompt: `一次資料:\n${context}\n\n質問: ${query}`,
    });
    for await (const delta of result.textStream) {
      answer += delta;
      yield { type: "answer-delta", text: delta };
    }
  }

  Object.assign(summarize, { status: "done" as const, summary: "回答を生成" });
  yield { type: "step", step: summarize };

  const tokens = Math.max(1, Math.round(answer.length / 1.8));
  yield {
    type: "done",
    tokens,
    durationMs: Date.now() - started,
    citationMap,
    sourceIds,
    sources,
    threadId,
  };
}

function sourcesFromChunks(chunks: RetrievedChunk[]): Source[] {
  const byDoc = new Map<string, Source>();
  for (const c of chunks) {
    let src = byDoc.get(c.documentId);
    if (!src) {
      src = { id: c.documentId, type: "doc", title: c.documentTitle, path: c.documentTitle,
              author: "", date: "", sections: [] };
      byDoc.set(c.documentId, src);
    }
    if (!src.sections.some((s) => s.id === c.chunkId)) {
      src.sections.push({ id: c.chunkId, heading: c.headingPath, body: c.text, highlight: true });
    }
  }
  return [...byDoc.values()];
}
```

- [ ] **Step 3: 旧 lexical retriever を削除**

Run: `git rm src/lib/agent/retriever.ts`
（`highlightSectionFor`/`retrieve` の参照が他に無いことを確認: `grep -rn "agent/retriever" src` が空であること。）

- [ ] **Step 4: 合格を確認**

Run: `pnpm test src/lib/agent/run.test.ts`
Expected: `1 passed`

- [ ] **Step 5: コミット**

```bash
git add src/lib/agent/run.ts src/lib/agent/run.test.ts
git rm src/lib/agent/retriever.ts
git commit -m "feat: run.ts を実 /retrieve + Haiku 書換 + Sonnet 生成に再構築"
```

---

### Task 5: chat ルートで threadId 解決と永続化

**Files:**
- Modify: `src/app/api/chat/route.ts`

- [ ] **Step 1: ルートを更新**

`src/app/api/chat/route.ts`（全置換）:
```ts
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { verifyAccessToken, authCookieName } from "@/lib/auth";
import { runAgent } from "@/lib/agent/run";
import { createThread, saveCompletedMessage } from "@/lib/threads";
import type { AgentEvent, ToolCall } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const jar = await cookies();
  const token = jar.get(authCookieName)?.value;
  const claims = token ? await verifyAccessToken(token) : null;
  if (!claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { query, threadId } = (await req.json().catch(() => ({}))) as {
    query?: string; threadId?: string;
  };
  const q = query || "";

  // スレッドを確定（無ければ作成、タイトルは query から）
  const tid = threadId || (await createThread(claims.sub, q || "新しいスレッド")).id;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (data: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

      let answer = "";
      const steps: ToolCall[] = [];
      let done: Extract<AgentEvent, { type: "done" }> | null = null;

      try {
        for await (const event of runAgent({ query: q, ownerUserId: claims.sub, threadId: tid })) {
          if (event.type === "answer-delta") answer += event.text;
          if (event.type === "step") {
            const idx = steps.findIndex((s) => s.id === event.step.id);
            if (idx >= 0) steps[idx] = event.step; else steps.push(event.step);
          }
          if (event.type === "done") done = event;
          send(event);
        }

        // 永続化（done が来た正常終了時のみ）
        if (done) {
          const cites = Object.entries(done.citationMap).map(([ord, ref]) => {
            const src = done!.sources.find((s) => s.id === ref.sourceId);
            const sec = src?.sections.find((x) => x.id === ref.sectionId);
            return {
              ordinal: Number(ord),
              documentId: ref.sourceId,
              documentTitle: src?.title ?? ref.sourceId,
              chunkId: ref.sectionId,
              sectionId: ref.sectionId,
              headingPath: sec?.heading ?? "",
              snippet: sec?.body ?? "",
            };
          });
          await saveCompletedMessage({
            threadId: tid, query: q, answerText: answer,
            tokens: done.tokens, durationMs: done.durationMs, steps, citations: cites,
          });
        }
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : "error" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
```

- [ ] **Step 2: lint + 手動確認**

Run: `pnpm lint`
（手動）`docker compose up -d` + worker + `pnpm dev`：質問 → ステップが進み回答がストリーム → リロードしてもスレッドに残ることを Task 6 完了後に確認。

- [ ] **Step 3: コミット**

```bash
git add src/app/api/chat/route.ts
git commit -m "feat: chat ルートで threadId 解決と回答/引用の永続化を実装"
```

---

### Task 6: workspace を API データに配線

**Files:**
- Modify: `src/components/workspace/workspace.tsx`

> 大きい既存コンポーネント。以下の置換を外科的に行う（既存の JSX 構造・クラスは維持）。

- [ ] **Step 1: スレッド一覧を API から取得**

- `SAMPLE_THREADS` import を除去。`const [threads, setThreads] = useState<ThreadSummary[]>([])` を追加し、マウント時に `fetch("/api/threads")` → `setThreads(data.threads)`。`activeThreadId` で `active` フラグを付与する既存の `.map` はそのまま流用。

- [ ] **Step 2: スレッド選択で履歴を復元**

- 既存のスレッド選択ハンドラ（`COMPLETED_THREADS[id]` を参照していた箇所、`workspace.tsx:178` 付近）を、`fetch(\`/api/threads/${id}\`)` → `agent.loadCompleted(detail)`（Task 3 で拡張したシグネチャ）に置換。`COMPLETED_THREADS` import を除去。

- [ ] **Step 3: 右パネルのソースを実データに**

- `sources={SAMPLE_SOURCES}` を渡している 2 箇所（`workspace.tsx:458`, `:495`）を `sources={agent.sources}` に変更。
- `SAMPLE_SOURCES.length` を使うヘッダ表示（`:356`, `:396`）を `agent.sources.length` に変更。
- エクスポート用 markdown（`:222`）の `SAMPLE_SOURCES.map(...)` を `agent.sources.map(...)` に変更。
- `SAMPLE_SOURCES` import を除去。

- [ ] **Step 4: 送信時に activeThreadId を渡し、新規スレッドを一覧へ反映**

- チャット送信（`agent.run`）で `threadId` を body に含めるよう、`use-agent` の `run` を `run(query, attachments, threadId?)` に拡張し、`fetch("/api/chat", { body: JSON.stringify({ query, attachments, threadId }) })` を送る。
- `done` イベントの `event.threadId` を受けて、新規スレッドなら `activeThreadId` を更新し、`listThreads` を再取得（または返却 threadId で楽観追加）。`use-agent` の `done` 処理で `threadId` を state に保持済みなので、`run` 解決後に `agent.threadId` を見て一覧を再取得する。

- [ ] **Step 5: lint + 型チェック + 手動 e2e**

Run: `pnpm lint && pnpm test`
（手動）ログイン → PDF アップロードして ready → 質問 → 回答＋引用＋右パネルが実ソースで表示 → リロード／別スレッド切替で履歴復元を確認。

- [ ] **Step 6: コミット**

```bash
git add src/components/workspace/workspace.tsx src/hooks/use-agent.ts
git commit -m "feat: workspace をスレッド/履歴/ソースの実データに配線"
```

---

## フェーズ5 完了条件
- 質問 → Haiku 書換 → 実 `/retrieve` → Sonnet 生成 → 回答＋引用が実データで表示
- 回答・ステップ・引用が Postgres に保存され、リロード／スレッド切替で復元
- 右パネルのソースが実 `/retrieve` 由来
- `pnpm test` / `cd rag && uv run pytest` 双方 green、`pnpm lint` クリーン
