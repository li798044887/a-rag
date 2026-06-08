import { expect, test } from "vitest";
import { fileURLToPath } from "node:url";
import { loadGolden, loadAnswerConfig, suiteDir } from "./golden.ts";

const REPO = fileURLToPath(new URL("../..", import.meta.url));

test("loadGolden は agentic_rag_demo の golden を読む", () => {
  const g = loadGolden(suiteDir(REPO, "agentic_rag_demo"));
  expect(g.owner_user_id).toBe("__eval_agentic_rag_demo__");
  expect(g.cases.length).toBeGreaterThan(0);
  const c1 = g.cases.find((c) => c.id === "case1-cross-page-table");
  expect(c1).toBeDefined();
  expect(c1!.relevant_documents).toContain("04-cross-page-table-semantic-loss.pdf");
  // key_facts は { any: string[] } の配列としてパースされる。
  expect(Array.isArray(c1!.key_facts)).toBe(true);
  expect(c1!.key_facts[0].any.length).toBeGreaterThan(0);
});

test("loadAnswerConfig は matrix と thresholds を読む", () => {
  const cfg = loadAnswerConfig(suiteDir(REPO, "agentic_rag_demo"));
  expect(cfg.primary).toBe("gpt-4.1");
  expect(cfg.models).toContain("gpt-4o");
  expect(cfg.thresholds.citation_recall).toBeGreaterThan(0);
});
