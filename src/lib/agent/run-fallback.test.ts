import { expect, test, vi } from "vitest";

vi.mock("@/lib/agent/retrieve-client", () => ({
  retrieveChunks: vi.fn(async () => { throw new Error("ECONNREFUSED"); }),
}));
vi.mock("ai", () => ({
  generateText: vi.fn(async () => ({ text: "q" })),
  streamText: vi.fn(() => ({ textStream: (async function* () {})() })),
}));
vi.mock("@ai-sdk/anthropic", () => ({ anthropic: () => "model" }));

import { runAgent } from "@/lib/agent/run";

test("retrieve failure yields a graceful answer and still finishes", async () => {
  const events: any[] = [];
  for await (const e of runAgent({ query: "x", ownerUserId: "u1", threadId: "t1" })) events.push(e);
  const answer = events.filter((e) => e.type === "answer-delta").map((e) => e.text).join("");
  expect(answer).toContain("接続できませんでした");
  expect(events.some((e) => e.type === "done")).toBe(true);
});
