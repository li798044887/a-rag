import { expect, test, vi } from "vitest";
import type { ToolSet } from "ai";

// retrieve は agentic ループのツール経由でのみ呼ばれ、現在は retrieveChunksStream を使う。
// バックエンド接続失敗（/retrieve/stream への到達失敗）を再現する。
vi.mock("@/lib/agent/retrieve-client", () => ({
  retrieveChunks: vi.fn(),
  retrieveChunksStream: vi.fn(async () => { throw new Error("ECONNREFUSED"); }),
  fetchDocument: vi.fn(),
}));

// streamText を、retrieve を1回呼ぶ（execute が throw する）筋書きでモックする。
vi.mock("ai", async (orig) => {
  const actual = await orig<typeof import("ai")>();
  return {
    ...actual,
    streamText: vi.fn(({ tools }: { tools: ToolSet }) => {
      async function* gen() {
        yield { type: "tool-call", toolCallId: "call-1", toolName: "retrieve", input: { query: "x" } };
        // SDK が execute を呼ぶと retrieveChunks が throw する → tool-error として配信される様子を再現。
        let error: unknown = null;
        try {
          await tools.retrieve.execute!({ query: "x" }, { toolCallId: "call-1", messages: [] } as never);
        } catch (e) { error = e; }
        yield { type: "tool-error", toolCallId: "call-1", toolName: "retrieve", input: { query: "x" }, error };
        yield { type: "finish", finishReason: "stop", totalUsage: { totalTokens: 0 } };
      }
      return { fullStream: gen() };
    }),
  };
});

vi.mock("@ai-sdk/anthropic", () => ({ anthropic: () => "model" }));

import { runAgent } from "@/lib/agent/run";
import type { AgentEvent } from "@/lib/types";

process.env.ANTHROPIC_API_KEY = "test-key";

test("retrieve failure surfaces an error step and still finishes gracefully", async () => {
  const events: AgentEvent[] = [];
  for await (const e of runAgent({ query: "x", ownerUserId: "u1", threadId: "t1" })) events.push(e);

  // ツール失敗は error ステップとして配信される。
  const steps = events.filter((e) => e.type === "step");
  expect(steps.some((e) => e.step.name === "retrieve" && e.step.status === "error")).toBe(true);

  // 本文が得られなくてもフォールバック文言が出て、done で完走する。
  const answer = events.filter((e) => e.type === "answer-delta").map((e) => e.text).join("");
  expect(answer.length).toBeGreaterThan(0);
  expect(events.some((e) => e.type === "done")).toBe(true);
});
