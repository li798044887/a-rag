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
import type { AgentEvent } from "@/lib/types";

// 生成パス（streamText）を検証するため API キー有りを模す（実呼び出しはモック済み）。
process.env.ANTHROPIC_API_KEY = "test-key";

test("runAgent yields steps, streams answer, and finishes with sources+citationMap", async () => {
  const events: AgentEvent[] = [];
  for await (const e of runAgent({ query: "認証は?", ownerUserId: "u1", threadId: "t1" })) {
    events.push(e);
  }
  const answer = events.filter((e) => e.type === "answer-delta").map((e) => e.text).join("");
  expect(answer).toContain("失効");

  const done = events.find((e) => e.type === "done");
  expect(done).toBeDefined();
  if (!done || done.type !== "done") throw new Error("done event missing");
  expect(done.threadId).toBe("t1");
  expect(done.sources[0].id).toBe("d1");
  expect(done.sources[0].sections[0].id).toBe("c1");
  expect(done.citationMap[1]).toMatchObject({ sourceId: "d1", sectionId: "c1" });

  // すべてのステップが done になる
  const steps = events.filter((e) => e.type === "step");
  expect(steps.some((e) => e.step.name === "rewrite_query" && e.step.status === "done")).toBe(true);
});
