import { expect, test } from "vitest";
import type { AgentEvent } from "@/lib/types";
import { citedDocumentTitles, collect, runCase, type RunAgentFn } from "./harness.ts";
import type { GoldenCase } from "./golden.ts";

// done イベントの最小生成。citationMap の sourceId は sources の id（documentId）と対応する。
function doneEvent(over: Partial<Extract<AgentEvent, { type: "done" }>>): Extract<AgentEvent, { type: "done" }> {
  return {
    type: "done", tokens: 0, durationMs: 0,
    citationMap: {}, sourceIds: [], sources: [], threadId: "t", ...over,
  };
}

test("citedDocumentTitles は citationMap の sourceId を sources の title へ写像する", () => {
  const done = doneEvent({
    citationMap: { 1: { sourceId: "d1", sectionId: "c1" }, 2: { sourceId: "d1", sectionId: "c2" } },
    sources: [
      { id: "d1", type: "doc", title: "A.pdf", path: "A.pdf", author: "", date: "", sections: [] },
      { id: "d2", type: "doc", title: "B.pdf", path: "B.pdf", author: "", date: "", sections: [] },
    ],
  });
  // d1 のみ引用 → 重複排除して ["A.pdf"]。
  expect(citedDocumentTitles(done)).toEqual(["A.pdf"]);
});

test("collect は answer-delta を連結し done を取り出す", async () => {
  async function* gen(): AsyncGenerator<AgentEvent> {
    yield { type: "answer-start" };
    yield { type: "answer-delta", text: "あ" };
    yield { type: "answer-delta", text: "い[1]" };
    yield doneEvent({ tokens: 42 });
  }
  const r = await collect(gen());
  expect(r.answer).toBe("あい[1]");
  expect(r.done?.tokens).toBe(42);
});

test("runCase は注入した runAgent の結果から指標を算出する", async () => {
  const fakeRun: RunAgentFn = async function* () {
    yield { type: "answer-delta", text: "コードN9。翌営業日AM対応。詳細は[1]。" };
    yield doneEvent({
      tokens: 10,
      citationMap: { 1: { sourceId: "d1", sectionId: "c1" } },
      sources: [{ id: "d1", type: "doc", title: "04-cross-page-table-semantic-loss.pdf", path: "", author: "", date: "", sections: [] }],
    });
  };
  const gc: GoldenCase = {
    id: "case1", query: "q",
    relevant_documents: ["04-cross-page-table-semantic-loss.pdf"],
    key_facts: [{ any: ["N9"] }, { any: ["翌営業日AM", "翌営業日"] }, { any: ["0.91"] }],
  };
  const res = await runCase(fakeRun, { ownerUserId: "owner", modelId: "gpt-4.1" }, gc);
  expect(res.id).toBe("case1");
  expect(res.citation_recall).toBe(1);
  expect(res.citation_precision).toBe(1);
  expect(res.answer_fact_coverage).toBeCloseTo(2 / 3);
  expect(res.cited_documents).toEqual(["04-cross-page-table-semantic-loss.pdf"]);
  expect(res.fact_groups.map((g) => g.matched)).toEqual([true, true, false]);
  expect(res.tokens).toBe(10);
});
