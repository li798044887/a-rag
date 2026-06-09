import { expect, test } from "vitest";
import type { AgentEvent } from "@/lib/types";
import { citedDocumentTitles, collect, runCase, runModel, type RunAgentFn } from "./harness.ts";
import type { GoldenCase, Golden } from "./golden.ts";

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

test("runCase は done が来なくても全指標0で完走する（生成失敗の防御）", async () => {
  // done を一切 yield しない（モデル失敗・ストリーム異常を模す）。
  const noDoneRun: RunAgentFn = async function* () {
    yield { type: "answer-delta", text: "途中で切れた回答" };
  };
  const gc: GoldenCase = {
    id: "case-x", query: "q",
    relevant_documents: ["A.pdf"],
    key_facts: [{ any: ["存在しない事実"] }],
  };
  const res = await runCase(noDoneRun, { ownerUserId: "owner", modelId: "gpt-4.1" }, gc);
  expect(res.citation_recall).toBe(0);
  expect(res.citation_precision).toBe(0);
  expect(res.answer_fact_coverage).toBe(0);
  expect(res.cited_documents).toEqual([]);
  expect(res.tokens).toBe(0);
});

test("runModel は golden の全 case を回し owner_user_id を引き渡す", async () => {
  const seen: { ownerUserId: string; ids: string[] } = { ownerUserId: "", ids: [] };
  const fakeRun: RunAgentFn = async function* (input) {
    seen.ownerUserId = input.ownerUserId;
    seen.ids.push(input.threadId);
    yield doneEvent({});
  };
  const golden: Golden = {
    suite: "s", owner_user_id: "__owner__",
    cases: [
      { id: "a", query: "qa", relevant_documents: [], key_facts: [] },
      { id: "b", query: "qb", relevant_documents: [], key_facts: [] },
    ],
  };
  const results = await runModel(fakeRun, golden, "gpt-4.1");
  expect(results.map((r) => r.id)).toEqual(["a", "b"]);
  expect(seen.ownerUserId).toBe("__owner__");
  // threadId は answer-eval:<id> で名前空間化される。
  expect(seen.ids).toEqual(["answer-eval:a", "answer-eval:b"]);
});
