import { expect, test } from "vitest";
import { toModelHistory } from "@/lib/agent/history";

test("converts turns to user/assistant messages in order", () => {
  const msgs = toModelHistory([
    { query: "Q1", answerText: "A1" },
    { query: "Q2", answerText: "A2" },
  ], 8);
  expect(msgs).toEqual([
    { role: "user", content: "Q1" },
    { role: "assistant", content: "A1" },
    { role: "user", content: "Q2" },
    { role: "assistant", content: "A2" },
  ]);
});

test("windows to last N turns", () => {
  const turns = Array.from({ length: 10 }, (_, i) => ({ query: `Q${i}`, answerText: `A${i}` }));
  const msgs = toModelHistory(turns, 2);
  expect(msgs).toHaveLength(4);
  expect(msgs[0]).toEqual({ role: "user", content: "Q8" });
});

test("skips empty answers (in-flight/failed turns)", () => {
  const msgs = toModelHistory([{ query: "Q1", answerText: "" }, { query: "Q2", answerText: "A2" }], 8);
  expect(msgs).toEqual([{ role: "user", content: "Q2" }, { role: "assistant", content: "A2" }]);
});
