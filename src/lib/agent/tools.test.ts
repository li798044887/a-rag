import { afterEach, expect, test, vi } from "vitest";

const generateTextMock = vi.fn();
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateText: (...a: unknown[]) => generateTextMock(...a),
    Output: { object: (cfg: unknown) => cfg, text: () => ({}) },
  };
});

vi.mock("@/lib/agent/retrieve-client", () => ({
  retrieveChunks: vi.fn(),
  retrieveChunksStream: vi.fn(async ({ onStage }: { onStage: (e: Record<string, unknown>) => void }) => {
    onStage({ stage: "embed", status: "done", ms: 1, model: "BAAI/bge-m3", dims: 1024 });
    onStage({ stage: "vector_search", status: "done", ms: 2, count: 1, hits: [{ title: "設計.pdf", heading: "認証", score: 0.8 }] });
    onStage({ stage: "rerank", status: "done", ms: 3, count: 1, model: "bge", top_n: 6, selected: [{ id: "c1", score: 0.04, title: "設計.pdf" }] });
    return [{
      chunkId: "c1", documentId: "d1", documentTitle: "設計.pdf", headingPath: "認証",
      pageStart: 0, pageEnd: 0, blockType: "text", text: "トークンは24時間で失効する。",
      expandedText: "前文。トークンは24時間で失効する。後文。", score: 0.9,
    }];
  }),
  fetchDocument: vi.fn(async () => ({
    documentId: "d1", documentTitle: "設計.pdf",
    chunks: [{ chunkId: "c2", ordinal: 1, headingPath: "認可", pageStart: 0, pageEnd: 0,
      blockType: "text", text: "認可の本文。" }],
  })),
}));

import { buildTools } from "@/lib/agent/tools";
import { CitationRegistry } from "@/lib/agent/citations";
import { retrieveChunksStream, fetchDocument } from "@/lib/agent/retrieve-client";
import { StepBus } from "@/lib/agent/step-bus";
import type { AgentEvent } from "@/lib/types";
import { getAgentPrompts } from "@/lib/agent/prompts";

afterEach(() => {
  generateTextMock.mockReset();
  vi.mocked(retrieveChunksStream).mockClear();
});

test("retrieve tool registers citations and returns numbered text", async () => {
  const reg = new CitationRegistry();
  const meta = new Map();
  const tools = buildTools({ registry: reg, ownerUserId: "u1", meta, bus: new StepBus(), prompts: getAgentPrompts("ja") });
  const out = await tools.retrieve.execute!({ query: "認証" }, { toolCallId: "call-1", messages: [] } as never);

  expect(typeof out).toBe("string");
  expect(out).toContain("[1]");
  expect(out).toContain("失効");
  expect(reg.size).toBe(1);
  expect(meta.get("call-1")).toMatchObject({ name: "retrieve", summary: expect.stringContaining("1") });
});

test("table chunk citations keep expanded surrounding text shown to the model", async () => {
  vi.mocked(retrieveChunksStream).mockResolvedValueOnce([{
    chunkId: "table-1",
    documentId: "doc-1",
    documentTitle: "冷却ライン.pdf",
    headingPath: "一次対応",
    pageStart: 2,
    pageEnd: 2,
    blockType: "table",
    text: "<table><tr><td>T2</td></tr></table>",
    expandedText: "<table><tr><td>T2</td></tr></table>\n\nHX-7熱交換器は洗浄対象だが、交換対象ではない。",
    score: 0.8,
  }]);
  const reg = new CitationRegistry();
  const tools = buildTools({ registry: reg, ownerUserId: "u1", meta: new Map(), bus: new StepBus(), prompts: getAgentPrompts("ja") });

  const out = await tools.retrieve.execute!({ query: "HX-7" }, { toolCallId: "call-table", messages: [] } as never);
  const sources = reg.toSources();

  expect(String(out)).toContain("HX-7熱交換器は洗浄対象");
  expect(sources[0].sections[0].body).toContain("<table");
  expect(sources[0].sections[0].body).toContain("HX-7熱交換器は洗浄対象");
});

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

test("retrieve tool は multiHop を検索へ透過する", async () => {
  const reg = new CitationRegistry();
  const meta = new Map();
  const tools = buildTools({
    registry: reg, ownerUserId: "u1", meta, bus: new StepBus(),
    prompts: getAgentPrompts("ja"), multiHop: true,
  });

  await tools.retrieve.execute!({ query: "認証" }, { toolCallId: "call-mh", messages: [] } as never);

  expect(vi.mocked(retrieveChunksStream)).toHaveBeenLastCalledWith(
    expect.objectContaining({ multiHop: true }));
});

test("retrieve tool は multiHop 未指定なら透過しない（既定挙動）", async () => {
  const reg = new CitationRegistry();
  const meta = new Map();
  const tools = buildTools({
    registry: reg, ownerUserId: "u1", meta, bus: new StepBus(), prompts: getAgentPrompts("ja"),
  });

  await tools.retrieve.execute!({ query: "認証" }, { toolCallId: "call-no-mh", messages: [] } as never);

  expect(vi.mocked(retrieveChunksStream)).toHaveBeenLastCalledWith(
    expect.objectContaining({ multiHop: undefined }));
});

test("fetch_document resolves a citation ref to the real document/chunk ids", async () => {
  const reg = new CitationRegistry();
  const meta = new Map();
  const tools = buildTools({ registry: reg, ownerUserId: "u1", meta, bus: new StepBus(), prompts: getAgentPrompts("ja") });
  // 先に retrieve して [1] を登録（chunkId=c1, documentId=d1）。
  await tools.retrieve.execute!({ query: "認証" }, { toolCallId: "call-r", messages: [] } as never);

  const out = await tools.fetch_document.execute!(
    { ref: 1 }, { toolCallId: "call-2", messages: [] } as never);

  // [1] の実 ID へ解決して fetchDocument を呼ぶこと。
  expect(vi.mocked(fetchDocument)).toHaveBeenCalledWith(
    expect.objectContaining({ documentId: "d1", aroundChunkId: "c1" }));
  expect(out).toContain("[");
  expect(meta.get("call-2")).toMatchObject({ name: "fetch_document" });
});

test("fetch_document errors when the ref was never retrieved", async () => {
  const reg = new CitationRegistry();
  const meta = new Map();
  const tools = buildTools({ registry: reg, ownerUserId: "u1", meta, bus: new StepBus(), prompts: getAgentPrompts("ja") });

  const out = (await tools.fetch_document.execute!(
    { ref: 99 }, { toolCallId: "call-x", messages: [] } as never)) as string;

  expect(out).toContain("retrieve");
});

test("retrieve output does not leak raw uuids (only [n] is shown)", async () => {
  const reg = new CitationRegistry();
  const meta = new Map();
  const tools = buildTools({ registry: reg, ownerUserId: "u1", meta, bus: new StepBus(), prompts: getAgentPrompts("ja") });
  const out = (await tools.retrieve.execute!(
    { query: "認証" }, { toolCallId: "call-ids", messages: [] } as never)) as string;

  expect(out).toContain("[1]");
  expect(out).not.toContain("doc_id=");
  expect(out).not.toContain("d1");
});

test("retrieve tool falls back when no chunks are returned", async () => {
  vi.mocked(retrieveChunksStream).mockResolvedValueOnce([]);
  const reg = new CitationRegistry();
  const meta = new Map();
  const tools = buildTools({ registry: reg, ownerUserId: "u1", meta, bus: new StepBus(), prompts: getAgentPrompts("ja") });
  const out = await tools.retrieve.execute!({ query: "存在しない" }, { toolCallId: "call-3", messages: [] } as never);

  expect(out).toBe("該当する資料は見つかりませんでした。");
  expect(reg.size).toBe(0);
});

test("fetch_document tool falls back when no chunks are returned", async () => {
  vi.mocked(fetchDocument).mockResolvedValueOnce({ documentId: "d1", documentTitle: "X", chunks: [] });
  const reg = new CitationRegistry();
  const meta = new Map();
  const tools = buildTools({ registry: reg, ownerUserId: "u1", meta, bus: new StepBus(), prompts: getAgentPrompts("ja") });
  await tools.retrieve.execute!({ query: "認証" }, { toolCallId: "call-r2", messages: [] } as never);

  const out = await tools.fetch_document.execute!(
    { ref: 1 }, { toolCallId: "call-4", messages: [] } as never);

  expect(out).toBe("文書の本文が取得できませんでした。");
});

test("stageToEvent populates per-stage input/output detail", async () => {
  const reg = new CitationRegistry();
  const meta = new Map();
  const bus = new StepBus();
  const events: AgentEvent[] = [];
  const drain = (async () => { for await (const e of bus) events.push(e); })();

  const tools = buildTools({ registry: reg, ownerUserId: "u1", meta, bus, prompts: getAgentPrompts("ja") });
  await tools.retrieve.execute!({ query: "認証は?" }, { toolCallId: "call-1", messages: [] } as never);
  bus.close();
  await drain;

  const steps = events.filter((e): e is Extract<AgentEvent, { type: "step" }> => e.type === "step").map((e) => e.step);
  const vs = steps.find((s) => s.name === "vector_search" && s.status === "done")!;
  expect(vs.input).toMatchObject({ mode: "dense", query: "認証は?" });
  expect((vs.output as { hits: unknown[] }).hits).toHaveLength(1);
  const rr = steps.find((s) => s.name === "rerank" && s.status === "done")!;
  expect(rr.input).toMatchObject({ model: "bge", top_n: 6 });
  expect((rr.output as { selected: unknown[] }).selected).toHaveLength(1);
  const embed = steps.find((s) => s.name === "embed" && s.status === "done")!;
  expect(embed.output).toMatchObject({ dims: 1024 });
});

test("retrieve tool pushes nested sub-steps with parentId to the bus", async () => {
  const reg = new CitationRegistry();
  const meta = new Map();
  const bus = new StepBus();
  const events: AgentEvent[] = [];
  const drain = (async () => { for await (const e of bus) events.push(e); })();

  const tools = buildTools({ registry: reg, ownerUserId: "u1", meta, bus, prompts: getAgentPrompts("ja") });
  await tools.retrieve.execute!({ query: "認証" }, { toolCallId: "call-1", messages: [] } as never);
  bus.close();
  await drain;

  const subSteps = events.filter((e): e is Extract<AgentEvent, { type: "step" }> => e.type === "step");
  expect(subSteps.every((e) => e.step.parentId === "call-1")).toBe(true);
  expect(subSteps.map((e) => e.step.name)).toContain("vector_search");
  const vsDone = subSteps.find((e) => e.step.name === "vector_search" && e.step.status === "done");
  expect(vsDone!.step.output).toMatchObject({ count: 1 });
});

test("retrieve tool scopes to attachmentDocIds when provided", async () => {
  const reg = new CitationRegistry();
  const meta = new Map();
  const tools = buildTools({ registry: reg, ownerUserId: "u1", meta, bus: new StepBus(),
    attachmentDocIds: ["docA", "docB"], prompts: getAgentPrompts("ja") });

  await tools.retrieve.execute!({ query: "認証" }, { toolCallId: "call-scope", messages: [] } as never);

  expect(vi.mocked(retrieveChunksStream)).toHaveBeenLastCalledWith(
    expect.objectContaining({ documentIds: ["docA", "docB"] }));
});

test("retrieve tool passes undefined documentIds without attachments", async () => {
  const reg = new CitationRegistry();
  const meta = new Map();
  const tools = buildTools({ registry: reg, ownerUserId: "u1", meta, bus: new StepBus(), prompts: getAgentPrompts("ja") });

  await tools.retrieve.execute!({ query: "認証" }, { toolCallId: "call-noscope", messages: [] } as never);

  expect(vi.mocked(retrieveChunksStream)).toHaveBeenLastCalledWith(
    expect.objectContaining({ documentIds: undefined }));
});

test("grade が不足判定なら rewrite して再検索する", async () => {
  vi.mocked(retrieveChunksStream)
    .mockImplementationOnce(async () => [
      { chunkId: "c1", documentId: "d1", documentTitle: "A", headingPath: "h", pageStart: 0, pageEnd: 0, blockType: "text", text: "弱", expandedText: "弱", score: 0.05 },
    ])
    .mockImplementationOnce(async () => [
      { chunkId: "c2", documentId: "d2", documentTitle: "B", headingPath: "h", pageStart: 0, pageEnd: 0, blockType: "text", text: "強", expandedText: "強", score: 0.9 },
    ]);
  generateTextMock
    .mockResolvedValueOnce({ output: { relevantIds: [] } })
    .mockResolvedValueOnce({ text: "改善クエリ" });

  const reg = new CitationRegistry();
  const bus = new StepBus();
  const events: AgentEvent[] = [];
  const drain = (async () => { for await (const e of bus) events.push(e); })();
  const meta = new Map();
  const tools = buildTools({
    registry: reg, ownerUserId: "u1", meta, bus, prompts: getAgentPrompts("ja"),
    gradeModel: "m" as never, gradeThreshold: 0.5, maxRetrieveRetries: 1,
  });
  const out = await tools.retrieve.execute!({ query: "q" }, { toolCallId: "call-1", messages: [] } as never);
  bus.close();
  await drain;

  expect(vi.mocked(retrieveChunksStream)).toHaveBeenCalledTimes(2);
  expect(String(out)).toContain("強");
  expect(meta.get("call-1")).toMatchObject({
    input: { query: "q" },
    summary: expect.stringContaining("q"),
  });
  expect(meta.get("call-1")?.summary).not.toContain("改善クエリ");
  expect(events.some((e) => e.type === "step" && e.step.name === "grade")).toBe(true);
  const retryRewrite = events.find((e) => e.type === "step" && e.step.name === "rewrite_query" && e.step.id === "call-1:rewrite-retry-0");
  expect(retryRewrite).toBeDefined();
  expect((retryRewrite as Extract<AgentEvent, { type: "step" }>).step.parentId).toBeUndefined();
  const firstGrade = events.find((e) => e.type === "step" && e.step.name === "grade" && e.step.parentId === "call-1");
  expect((firstGrade as Extract<AgentEvent, { type: "step" }>).step.output).toMatchObject({
    kept: 0,
    total: 1,
    needRetry: true,
    candidates: [{ title: "A", heading: "h", score: 0.05, kept: false }],
  });
  const retryRetrieve = events.find((e) => e.type === "step" && e.step.name === "retrieve" && e.step.id === "call-1:retry-1:retrieve" && e.step.status === "done");
  expect(retryRetrieve).toBeDefined();
  expect((retryRetrieve as Extract<AgentEvent, { type: "step" }>).step).toMatchObject({
    label: "再検索",
    input: { query: "改善クエリ", retryReason: "関連資料が不足のため再検索" },
    summary: expect.stringContaining("関連資料が不足のため再検索"),
  });
  expect(events.some((e) => e.type === "step" && e.step.name === "grade" && e.step.parentId === "call-1:retry-1:retrieve")).toBe(true);
});

test("再検索時の retrieve サブステップは前回試行を上書きしない", async () => {
  vi.mocked(retrieveChunksStream)
    .mockImplementationOnce(async ({ onStage }) => {
      onStage({ stage: "bm25_search", status: "start" });
      onStage({ stage: "bm25_search", status: "done", ms: 4, count: 1 });
      onStage({ stage: "rerank", status: "done", ms: 5, count: 1 });
      return [
        { chunkId: "c1", documentId: "d1", documentTitle: "A", headingPath: "h", pageStart: 0, pageEnd: 0, blockType: "text", text: "弱", expandedText: "弱", score: 0.05 },
      ];
    })
    .mockImplementationOnce(async ({ onStage }) => {
      onStage({ stage: "bm25_search", status: "start" });
      onStage({ stage: "bm25_search", status: "done", ms: 6, count: 2 });
      onStage({ stage: "rerank", status: "done", ms: 7, count: 1 });
      return [
        { chunkId: "c2", documentId: "d2", documentTitle: "B", headingPath: "h", pageStart: 0, pageEnd: 0, blockType: "text", text: "強", expandedText: "強", score: 0.9 },
      ];
    });
  generateTextMock
    .mockResolvedValueOnce({ output: { relevantIds: [] } })
    .mockResolvedValueOnce({ text: "改善クエリ" });

  const bus = new StepBus();
  const events: AgentEvent[] = [];
  const drain = (async () => { for await (const e of bus) events.push(e); })();
  const tools = buildTools({
    registry: new CitationRegistry(), ownerUserId: "u1", meta: new Map(), bus,
    prompts: getAgentPrompts("ja"), gradeModel: "m" as never, gradeThreshold: 0.5, maxRetrieveRetries: 1,
  });

  await tools.retrieve.execute!({ query: "q" }, { toolCallId: "call-1", messages: [] } as never);
  bus.close();
  await drain;

  const steps = events.filter((e): e is Extract<AgentEvent, { type: "step" }> => e.type === "step").map((e) => e.step);
  const bm25Done = steps.filter((s) => s.name === "bm25_search" && s.status === "done");
  expect(bm25Done).toHaveLength(2);
  expect(new Set(bm25Done.map((s) => s.id)).size).toBe(2);
  expect(bm25Done[1].label).toBe("キーワード検索");
  expect(bm25Done[1].label).not.toContain("#2");
  expect(steps.filter((s) => s.name === "grade")).toHaveLength(2);
  expect(steps.filter((s) => s.name === "grade")[1].label).toBe("関連度判定");
});

test("maxRetrieveRetries=0 なら grade のみで再検索しない", async () => {
  vi.mocked(retrieveChunksStream).mockImplementationOnce(async () => [
    { chunkId: "c1", documentId: "d1", documentTitle: "A", headingPath: "h", pageStart: 0, pageEnd: 0, blockType: "text", text: "弱", expandedText: "弱", score: 0.05 },
  ]);
  generateTextMock.mockResolvedValueOnce({ output: { relevantIds: [] } });
  const meta = new Map();
  const tools = buildTools({
    registry: new CitationRegistry(), ownerUserId: "u1", meta, bus: new StepBus(),
    prompts: getAgentPrompts("ja"), gradeModel: "m" as never, gradeThreshold: 0.5, maxRetrieveRetries: 0,
  });
  await tools.retrieve.execute!({ query: "q" }, { toolCallId: "c", messages: [] } as never);
  expect(vi.mocked(retrieveChunksStream)).toHaveBeenCalledTimes(1);
  expect(meta.get("c")?.summary).toBe("「q」→ 0 件");
});
