import { expect, test, vi } from "vitest";

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

test("retrieve tool registers citations and returns numbered text", async () => {
  const reg = new CitationRegistry();
  const meta = new Map();
  const tools = buildTools({ registry: reg, ownerUserId: "u1", meta, bus: new StepBus() });
  const out = await tools.retrieve.execute!({ query: "認証" }, { toolCallId: "call-1", messages: [] } as never);

  expect(typeof out).toBe("string");
  expect(out).toContain("[1]");
  expect(out).toContain("失効");
  expect(reg.size).toBe(1);
  expect(meta.get("call-1")).toMatchObject({ name: "retrieve", summary: expect.stringContaining("1") });
});

test("retrieve tool uses a bounded rerank candidate count", async () => {
  const reg = new CitationRegistry();
  const meta = new Map();
  const tools = buildTools({ registry: reg, ownerUserId: "u1", meta, bus: new StepBus() });

  await tools.retrieve.execute!({ query: "認証" }, { toolCallId: "call-candidates", messages: [] } as never);

  expect(vi.mocked(retrieveChunksStream)).toHaveBeenLastCalledWith(
    expect.objectContaining({ candidateK: 10 }));
});

test("fetch_document resolves a citation ref to the real document/chunk ids", async () => {
  const reg = new CitationRegistry();
  const meta = new Map();
  const tools = buildTools({ registry: reg, ownerUserId: "u1", meta, bus: new StepBus() });
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
  const tools = buildTools({ registry: reg, ownerUserId: "u1", meta, bus: new StepBus() });

  const out = (await tools.fetch_document.execute!(
    { ref: 99 }, { toolCallId: "call-x", messages: [] } as never)) as string;

  expect(out).toContain("retrieve");
});

test("retrieve output does not leak raw uuids (only [n] is shown)", async () => {
  const reg = new CitationRegistry();
  const meta = new Map();
  const tools = buildTools({ registry: reg, ownerUserId: "u1", meta, bus: new StepBus() });
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
  const tools = buildTools({ registry: reg, ownerUserId: "u1", meta, bus: new StepBus() });
  const out = await tools.retrieve.execute!({ query: "存在しない" }, { toolCallId: "call-3", messages: [] } as never);

  expect(out).toBe("該当する資料は見つかりませんでした。");
  expect(reg.size).toBe(0);
});

test("fetch_document tool falls back when no chunks are returned", async () => {
  vi.mocked(fetchDocument).mockResolvedValueOnce({ documentId: "d1", documentTitle: "X", chunks: [] });
  const reg = new CitationRegistry();
  const meta = new Map();
  const tools = buildTools({ registry: reg, ownerUserId: "u1", meta, bus: new StepBus() });
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

  const tools = buildTools({ registry: reg, ownerUserId: "u1", meta, bus });
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

  const tools = buildTools({ registry: reg, ownerUserId: "u1", meta, bus });
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
    attachmentDocIds: ["docA", "docB"] });

  await tools.retrieve.execute!({ query: "認証" }, { toolCallId: "call-scope", messages: [] } as never);

  expect(vi.mocked(retrieveChunksStream)).toHaveBeenLastCalledWith(
    expect.objectContaining({ documentIds: ["docA", "docB"] }));
});

test("retrieve tool passes undefined documentIds without attachments", async () => {
  const reg = new CitationRegistry();
  const meta = new Map();
  const tools = buildTools({ registry: reg, ownerUserId: "u1", meta, bus: new StepBus() });

  await tools.retrieve.execute!({ query: "認証" }, { toolCallId: "call-noscope", messages: [] } as never);

  expect(vi.mocked(retrieveChunksStream)).toHaveBeenLastCalledWith(
    expect.objectContaining({ documentIds: undefined }));
});
