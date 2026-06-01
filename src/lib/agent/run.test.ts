import { afterEach, expect, test, vi } from "vitest";
import type { ToolSet } from "ai";

// retrieve-client はツール経由でのみ使われる。ツールの execute がレジストリ登録する様子を再現するため
// tools をモックせず、retrieve-client をモックして実 buildTools を通す。
vi.mock("@/lib/agent/retrieve-client", () => ({
  retrieveChunks: vi.fn(),
  retrieveChunksStream: vi.fn(async ({ onStage }: { onStage: (e: { stage: string; status: string; ms?: number; count?: number }) => void }) => {
    onStage({ stage: "embed", status: "done", ms: 1 });
    onStage({ stage: "vector_search", status: "done", ms: 2, count: 3 });
    return [{
      chunkId: "c1", documentId: "d1", documentTitle: "設計.pdf", headingPath: "認証",
      pageStart: 0, pageEnd: 0, blockType: "text", text: "トークンは24時間で失効する。",
      expandedText: "前文。トークンは24時間で失効する。後文。", score: 0.9,
    }];
  }),
  fetchDocument: vi.fn(),
}));

// streamText を、retrieve を1回呼んでから回答を流す筋書きでモックする。
vi.mock("ai", async (orig) => {
  const actual = await orig<typeof import("ai")>();
  return {
    ...actual,
    stepCountIs: actual.stepCountIs,
    tool: actual.tool,
    streamText: vi.fn(({ tools }: { tools: ToolSet }) => {
      async function* gen() {
        yield { type: "tool-call", toolCallId: "call-1", toolName: "retrieve", input: { query: "認証" } };
        // SDK は execute を実行する。テストでは手動で呼んでレジストリ登録を発火させる。
        await tools.retrieve.execute!({ query: "認証" }, { toolCallId: "call-1", messages: [] } as never);
        yield { type: "tool-result", toolCallId: "call-1", toolName: "retrieve", input: { query: "認証" }, output: "[1] …" };
        yield { type: "text-delta", id: "t1", text: "失効" };
        yield { type: "text-delta", id: "t1", text: "します[1]。" };
        yield { type: "finish", finishReason: "stop", totalUsage: { totalTokens: 42 } };
      }
      return { fullStream: gen() };
    }),
  };
});

vi.mock("@ai-sdk/anthropic", () => ({ anthropic: () => "model" }));

import { streamText } from "ai";
import { retrieveChunksStream } from "@/lib/agent/retrieve-client";
import { runAgent, buildUserContent } from "@/lib/agent/run";
import type { AgentEvent } from "@/lib/types";

process.env.ANTHROPIC_API_KEY = "test-key";

// 各テストでキーやモック差し替えが他テストへ漏れないよう確実に復元する。
afterEach(() => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  vi.mocked(streamText).mockClear();
});

test("runAgent runs tool loop, streams answer, finishes with sources+citationMap", async () => {
  const events: AgentEvent[] = [];
  for await (const e of runAgent({ query: "認証は?", ownerUserId: "u1", threadId: "t1" })) {
    events.push(e);
  }

  const answer = events.filter((e) => e.type === "answer-delta").map((e) => e.text).join("");
  expect(answer).toContain("失効");

  const steps = events.filter((e) => e.type === "step");
  // retrieve ツールの running と done が出る
  expect(steps.some((e) => e.step.name === "retrieve" && e.step.status === "running")).toBe(true);
  const retrieveDone = steps.find((e) => e.step.name === "retrieve" && e.step.status === "done");
  expect(retrieveDone).toBeDefined();
  expect(retrieveDone!.step.summary).toContain("1");

  const done = events.find((e) => e.type === "done");
  if (!done || done.type !== "done") throw new Error("done event missing");
  expect(done.threadId).toBe("t1");
  expect(done.sources[0].id).toBe("d1");
  expect(done.sources[0].sections[0].id).toBe("c1");
  expect(done.citationMap[1]).toMatchObject({ sourceId: "d1", sectionId: "c1" });
});

test("runAgent surfaces only the sources actually cited in the answer", async () => {
  // retrieve は 2 件返すが、回答は [1] のみ引用する → d2 はパネルに出さない。
  vi.mocked(retrieveChunksStream).mockImplementationOnce(async () => [
    { chunkId: "c1", documentId: "d1", documentTitle: "A.pdf", headingPath: "h1",
      pageStart: 0, pageEnd: 0, blockType: "text", text: "本文1", expandedText: "前 本文1 後", score: 0.9 },
    { chunkId: "c2", documentId: "d2", documentTitle: "B.pdf", headingPath: "h2",
      pageStart: 0, pageEnd: 0, blockType: "text", text: "本文2", expandedText: "前 本文2 後", score: 0.01 },
  ]);
  vi.mocked(streamText).mockImplementationOnce((opts) => {
    const { tools } = opts as unknown as { tools: ToolSet };
    async function* gen() {
      yield { type: "tool-call", toolCallId: "call-1", toolName: "retrieve", input: { query: "q" } };
      await tools.retrieve.execute!({ query: "q" }, { toolCallId: "call-1", messages: [] } as never);
      yield { type: "tool-result", toolCallId: "call-1", toolName: "retrieve", input: { query: "q" }, output: "…" };
      yield { type: "text-delta", id: "t1", text: "答え[1]。" };
      yield { type: "finish", finishReason: "stop", totalUsage: { totalTokens: 10 } };
    }
    return { fullStream: gen() } as never;
  });

  const events: AgentEvent[] = [];
  for await (const e of runAgent({ query: "q", ownerUserId: "u1", threadId: "t1" })) events.push(e);

  const done = events.find((e) => e.type === "done");
  if (!done || done.type !== "done") throw new Error("done event missing");
  expect(done.sources.map((s) => s.id)).toEqual(["d1"]);
  expect(Object.keys(done.citationMap)).toEqual(["1"]);
  // 引用された資料の関連度は実スコア（0.00 ではない）。
  expect(done.sources[0].score).toBe(0.9);
  // expandedText が引用箇所の本文として使われる。
  expect(done.sources[0].sections[0].body).toBe("前 本文1 後");
});

test("runAgent emits an error step on tool-error and continues to stream the answer", async () => {
  // ツールがエラーを返す筋書きへ差し替え。エラーステップ配信後も text-delta → finish が続く。
  vi.mocked(streamText).mockReturnValueOnce({
    fullStream: (async function* () {
      yield { type: "tool-error", toolCallId: "call-1", toolName: "retrieve", input: { query: "x" }, error: new Error("boom") };
      yield { type: "text-delta", id: "t1", text: "復旧しました。" };
      yield { type: "finish", finishReason: "stop", totalUsage: { totalTokens: 7 } };
    })(),
  } as never);

  const events: AgentEvent[] = [];
  for await (const e of runAgent({ query: "認証は?", ownerUserId: "u1", threadId: "t1" })) {
    events.push(e);
  }

  const steps = events.filter((e) => e.type === "step");
  expect(steps.some((e) => e.step.name === "retrieve" && e.step.status === "error")).toBe(true);

  const answer = events.filter((e) => e.type === "answer-delta").map((e) => e.text).join("");
  expect(answer).toContain("復旧");

  const done = events.find((e) => e.type === "done");
  expect(done).toBeDefined();
});

test("runAgent returns the missing-key reason and empty sources when no API key is set", async () => {
  delete process.env.ANTHROPIC_API_KEY;

  const events: AgentEvent[] = [];
  for await (const e of runAgent({ query: "認証は?", ownerUserId: "u1", threadId: "t1" })) {
    events.push(e);
  }

  const answer = events.filter((e) => e.type === "answer-delta").map((e) => e.text).join("");
  expect(answer).toContain("ANTHROPIC_API_KEY");

  const done = events.find((e) => e.type === "done");
  if (!done || done.type !== "done") throw new Error("done event missing");
  expect(done.sources).toEqual([]);
  expect(done.citationMap).toEqual({});
  expect(done.threadId).toBe("t1");
});

test("runAgent emits rewrite_query sibling and nested retrieve sub-steps", async () => {
  const events: AgentEvent[] = [];
  for await (const e of runAgent({ query: "認証は?", ownerUserId: "u1", threadId: "t1" })) {
    events.push(e);
  }
  const steps = events.filter((e): e is Extract<AgentEvent, { type: "step" }> => e.type === "step");

  // rewrite_query はトップレベル（parentId なし）で retrieve より前に出る。
  const rw = steps.find((e) => e.step.name === "rewrite_query");
  expect(rw).toBeDefined();
  expect(rw!.step.parentId).toBeUndefined();
  const rwIdx = steps.findIndex((e) => e.step.name === "rewrite_query");
  const retrIdx = steps.findIndex((e) => e.step.name === "retrieve");
  expect(rwIdx).toBeLessThan(retrIdx);

  // vector_search は retrieve の子（parentId === retrieve の toolCallId = "call-1"）。
  const vs = steps.find((e) => e.step.name === "vector_search");
  expect(vs!.step.parentId).toBe("call-1");

  // サブステップが retrieve の running と done の間に interleave される（フルイベント列で順序確認）。
  const idx = (pred: (e: Extract<AgentEvent, { type: "step" }>) => boolean) =>
    events.findIndex((e): e is Extract<AgentEvent, { type: "step" }> => e.type === "step" && pred(e));
  const rwI = idx((e) => e.step.name === "rewrite_query");
  const rRunI = idx((e) => e.step.name === "retrieve" && e.step.status === "running");
  const vsI = idx((e) => e.step.name === "vector_search");
  const rDoneI = idx((e) => e.step.name === "retrieve" && e.step.status === "done");
  expect(rwI).toBeLessThan(rRunI);
  expect(rRunI).toBeLessThan(vsI);
  expect(vsI).toBeLessThan(rDoneI);
});

test("buildUserContent prepends attachment names when docIds present", () => {
  const out = buildUserContent("これ何？", ["a.json", "b.pdf"], ["docA", "docB"]);
  expect(out).toBe("[添付ファイル: a.json、b.pdf]\nこれ何？");
});

test("buildUserContent returns plain query when no attachment docIds", () => {
  expect(buildUserContent("通常の質問", [], [])).toBe("通常の質問");
  expect(buildUserContent("通常の質問", ["a.json"], [])).toBe("通常の質問");
});
