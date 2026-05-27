import { expect, test, vi } from "vitest";

vi.mock("@/lib/agent/retrieve-client", () => ({
  retrieveChunks: vi.fn(async () => [{
    chunkId: "c1", documentId: "d1", documentTitle: "設計.pdf", headingPath: "認証",
    pageStart: 0, pageEnd: 0, blockType: "text", text: "トークンは24時間で失効する。",
    expandedText: "前文。トークンは24時間で失効する。後文。", score: 0.9,
  }]),
  fetchDocument: vi.fn(async () => ({
    documentId: "d1", documentTitle: "設計.pdf",
    chunks: [{ chunkId: "c2", ordinal: 1, headingPath: "認可", pageStart: 0, pageEnd: 0,
      blockType: "text", text: "認可の本文。" }],
  })),
}));

import { buildTools } from "@/lib/agent/tools";
import { CitationRegistry } from "@/lib/agent/citations";

test("retrieve tool registers citations and returns numbered text", async () => {
  const reg = new CitationRegistry();
  const meta = new Map();
  const tools = buildTools({ registry: reg, ownerUserId: "u1", meta });
  const out = await tools.retrieve.execute!({ query: "認証" }, { toolCallId: "call-1", messages: [] } as never);

  expect(typeof out).toBe("string");
  expect(out).toContain("[1]");
  expect(out).toContain("失効");
  expect(reg.size).toBe(1);
  expect(meta.get("call-1")).toMatchObject({ name: "retrieve", summary: expect.stringContaining("1") });
});

test("fetch_document tool registers citations and records meta", async () => {
  const reg = new CitationRegistry();
  const meta = new Map();
  const tools = buildTools({ registry: reg, ownerUserId: "u1", meta });
  const out = await tools.fetch_document.execute!(
    { document_id: "d1" }, { toolCallId: "call-2", messages: [] } as never);

  expect(out).toContain("[1]");
  expect(reg.size).toBe(1);
  expect(meta.get("call-2")).toMatchObject({ name: "fetch_document" });
});
