import { afterEach, expect, test, vi } from "vitest";

const generateText = vi.fn();
vi.mock("ai", () => ({
  generateText: (...a: unknown[]) => generateText(...a),
  Output: { object: (cfg: unknown) => cfg, text: () => ({}) },
}));

import { verifyAnswer } from "@/lib/agent/verify";
import { getAgentPrompts } from "@/lib/agent/prompts";

const prompts = getAgentPrompts("ja");
const model = "m" as never;
const sources = [{ n: 1, title: "A", heading: "h", snippet: "トークンは24時間で失効する" }];

afterEach(() => generateText.mockReset());

test("全主張が裏付けられていれば revise しない", async () => {
  generateText.mockResolvedValueOnce({ output: { unsupported: [] } });
  const r = await verifyAnswer({ query: "q", answer: "失効します[1]。", sources, model, prompts, maxRevisions: 1 });
  expect(r.unsupported).toEqual([]);
  expect(r.revised).toBeNull();
  expect(generateText).toHaveBeenCalledTimes(1);
});

test("未裏付けがあり maxRevisions>0 なら訂正本文を返す", async () => {
  generateText.mockResolvedValueOnce({ output: { unsupported: ["48時間で失効する"] } });
  generateText.mockResolvedValueOnce({ text: "24時間で失効します[1]。" });
  const r = await verifyAnswer({ query: "q", answer: "48時間で失効します[1]。", sources, model, prompts, maxRevisions: 1 });
  expect(r.unsupported).toEqual(["48時間で失効する"]);
  expect(r.revised).toBe("24時間で失効します[1]。");
  expect(generateText).toHaveBeenCalledTimes(2);
});

test("maxRevisions=0 なら未裏付けでも revise しない", async () => {
  generateText.mockResolvedValueOnce({ output: { unsupported: ["x"] } });
  const r = await verifyAnswer({ query: "q", answer: "a[1]", sources, model, prompts, maxRevisions: 0 });
  expect(r.revised).toBeNull();
  expect(generateText).toHaveBeenCalledTimes(1);
});

test("検証 LLM が失敗したら未裏付けなし扱いで素通し", async () => {
  generateText.mockRejectedValueOnce(new Error("boom"));
  const r = await verifyAnswer({ query: "q", answer: "a[1]", sources, model, prompts, maxRevisions: 1 });
  expect(r.unsupported).toEqual([]);
  expect(r.revised).toBeNull();
});
