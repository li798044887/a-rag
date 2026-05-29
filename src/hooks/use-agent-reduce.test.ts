import { expect, test } from "vitest";
import { emptyTurn, reduceTurn } from "@/hooks/use-agent";
import type { AgentEvent } from "@/lib/types";

test("reduceTurn appends unknown steps and updates known ones", () => {
  let turn = emptyTurn("Q", []);
  const running: AgentEvent = { type: "step", step: { id: "call-1", name: "retrieve",
    label: "検索", status: "running", durationMs: 0, input: {}, output: null, summary: "検索中…" } };
  turn = reduceTurn(turn, running);
  expect(turn.steps).toHaveLength(1);

  const done: AgentEvent = { type: "step", step: { ...running.step, status: "done", summary: "6件" } };
  turn = reduceTurn(turn, done);
  expect(turn.steps).toHaveLength(1);
  expect(turn.steps[0].status).toBe("done");
});

test("reduceTurn streams answer and finalizes on done", () => {
  let turn = emptyTurn("Q", []);
  turn = reduceTurn(turn, { type: "answer-start" });
  turn = reduceTurn(turn, { type: "answer-delta", text: "失効" });
  turn = reduceTurn(turn, { type: "answer-delta", text: "します。" });
  expect(turn.answer).toBe("失効します。");
  expect(turn.streaming).toBe(true);

  turn = reduceTurn(turn, { type: "done", tokens: 12, durationMs: 800,
    citationMap: { 1: { sourceId: "d1", sectionId: "c1" } }, sourceIds: ["d1"],
    sources: [{ id: "d1", type: "doc", title: "A", path: "A", author: "", date: "", sections: [] }],
    threadId: "t1" });
  expect(turn.streaming).toBe(false);
  expect(turn.status).toBe("done");
  expect(turn.tokens).toBe(12);
  expect(turn.citationMap[1]).toMatchObject({ sourceId: "d1" });
});
