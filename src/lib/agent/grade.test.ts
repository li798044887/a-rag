import { afterEach, expect, test, vi } from "vitest";

const generateText = vi.fn();
vi.mock("ai", () => ({
  generateText: (...a: unknown[]) => generateText(...a),
  Output: { object: (cfg: unknown) => cfg, text: () => ({}) },
}));

import { gradeChunks } from "@/lib/agent/grade";
import { getAgentPrompts } from "@/lib/agent/prompts";

const prompts = getAgentPrompts("ja");
const model = "m" as never;
const mk = (chunkId: string, score: number) => ({ chunkId, score, documentTitle: "A", headingPath: "h", text: "本文" });

test("全て強スコアなら LLM を呼ばず全件 kept・再検索なし", async () => {
  const r = await gradeChunks({ query: "q", chunks: [mk("c1", 0.9), mk("c2", 0.8)], threshold: 0.5, model, prompts });
  expect(generateText).not.toHaveBeenCalled();
  expect(r.keptIds.sort()).toEqual(["c1", "c2"]);
  expect(r.needRetry).toBe(false);
});

test("曖昧帯のみ LLM 判定し、選ばれたものを kept に足す", async () => {
  generateText.mockResolvedValueOnce({ output: { relevantIds: ["c2"] } });
  const r = await gradeChunks({ query: "q", chunks: [mk("c1", 0.9), mk("c2", 0.45), mk("c3", 0.1)], threshold: 0.5, model, prompts });
  expect(generateText).toHaveBeenCalledTimes(1);
  expect(r.keptIds.sort()).toEqual(["c1", "c2"]);
  expect(r.needRetry).toBe(false);
});

test("関連が一件も無ければ needRetry=true", async () => {
  const r = await gradeChunks({ query: "q", chunks: [mk("c1", 0.05)], threshold: 0.5, model, prompts });
  expect(r.keptIds).toEqual([]);
  expect(r.needRetry).toBe(true);
});

test("空入力は needRetry=true", async () => {
  const r = await gradeChunks({ query: "q", chunks: [], threshold: 0.5, model, prompts });
  expect(r.needRetry).toBe(true);
});

test("LLM 失敗時は強スコアのみで素通し（throw しない）", async () => {
  generateText.mockRejectedValueOnce(new Error("boom"));
  const r = await gradeChunks({ query: "q", chunks: [mk("c1", 0.9), mk("c2", 0.45)], threshold: 0.5, model, prompts });
  expect(r.keptIds).toEqual(["c1"]);
  expect(r.needRetry).toBe(false);
});

afterEach(() => generateText.mockReset());
