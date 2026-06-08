import { expect, test } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aggregate, evaluateGate, buildReport, writeReport } from "./report.ts";
import type { CaseResult } from "./harness.ts";

const cases: CaseResult[] = [
  { id: "a", citation_recall: 1, citation_precision: 1, answer_fact_coverage: 1,
    cited_documents: ["A.pdf"], relevant_documents: ["A.pdf"], fact_groups: [], answer_excerpt: "", duration_ms: 1, tokens: 1 },
  { id: "b", citation_recall: 0, citation_precision: 0.5, answer_fact_coverage: 0.5,
    cited_documents: ["X.pdf"], relevant_documents: ["B.pdf"], fact_groups: [], answer_excerpt: "", duration_ms: 1, tokens: 1 },
];

test("aggregate は case 平均を返す", () => {
  const m = aggregate(cases);
  expect(m.citation_recall).toBe(0.5);
  expect(m.citation_precision).toBe(0.75);
  expect(m.answer_fact_coverage).toBe(0.75);
});

test("evaluateGate は全指標が閾値以上のとき true", () => {
  const m = { citation_recall: 0.8, citation_precision: 0.8, answer_fact_coverage: 0.8 };
  expect(evaluateGate(m, { citation_recall: 0.8, citation_precision: 0.75, answer_fact_coverage: 0.8 })).toBe(true);
  expect(evaluateGate(m, { citation_recall: 0.9, citation_precision: 0.75, answer_fact_coverage: 0.8 })).toBe(false);
});

test("buildReport は gate モデルで passed を判定し、writeReport が JSON を書く", () => {
  const report = buildReport({
    suite: "agentic_rag_demo", model: "gpt-4.1", rewriteModel: "gpt-4.1-mini",
    ownerUserId: "__eval_agentic_rag_demo__", gate: true,
    thresholds: { citation_recall: 0.4, citation_precision: 0.4, answer_fact_coverage: 0.4 },
    cases,
  });
  expect(report.gate).toBe(true);
  expect(report.passed).toBe(true);
  expect(report.metrics.citation_recall).toBe(0.5);

  const dir = mkdtempSync(join(tmpdir(), "answer-eval-"));
  const path = writeReport(dir, report);
  expect(path.endsWith("agentic_rag_demo__gpt-4.1.json")).toBe(true);
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  expect(parsed.model).toBe("gpt-4.1");
  expect(parsed.cases.length).toBe(2);
});

test("buildReport は非 gate モデルで passed=null", () => {
  const report = buildReport({
    suite: "s", model: "gpt-4o", rewriteModel: "gpt-4.1-mini",
    ownerUserId: "o", gate: false,
    thresholds: { citation_recall: 1, citation_precision: 1, answer_fact_coverage: 1 },
    cases,
  });
  expect(report.gate).toBe(false);
  expect(report.passed).toBeNull();
});
