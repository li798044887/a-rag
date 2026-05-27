import { expect, test, vi } from "vitest";
import type { ToolSet } from "ai";

// retrieve-client はツール経由でのみ使われる。ツールの execute がレジストリ登録する様子を再現するため
// tools をモックせず、retrieve-client をモックして実 buildTools を通す。
vi.mock("@/lib/agent/retrieve-client", () => ({
  retrieveChunks: vi.fn(async () => [{
    chunkId: "c1", documentId: "d1", documentTitle: "設計.pdf", headingPath: "認証",
    pageStart: 0, pageEnd: 0, blockType: "text", text: "トークンは24時間で失効する。",
    expandedText: "前文。トークンは24時間で失効する。後文。", score: 0.9,
  }]),
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

import { runAgent } from "@/lib/agent/run";
import type { AgentEvent } from "@/lib/types";

process.env.ANTHROPIC_API_KEY = "test-key";

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
