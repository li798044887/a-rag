/** case 結果の集計・gate 判定・モデルごとの JSON レポート出力。 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CaseMetrics, Thresholds } from "./golden.ts";
import type { CaseResult } from "./harness.ts";

export function aggregate(cases: CaseResult[]): CaseMetrics {
  const n = cases.length || 1;
  const sum = (k: keyof CaseMetrics) => cases.reduce((a, c) => a + c[k], 0);
  return {
    citation_recall: sum("citation_recall") / n,
    citation_precision: sum("citation_precision") / n,
    answer_fact_coverage: sum("answer_fact_coverage") / n,
  };
}

export function evaluateGate(m: CaseMetrics, t: Thresholds): boolean {
  return (
    m.citation_recall >= t.citation_recall &&
    m.citation_precision >= t.citation_precision &&
    m.answer_fact_coverage >= t.answer_fact_coverage
  );
}

export interface Report {
  suite: string;
  model: string;
  rewrite_model: string;
  owner_user_id: string;
  generated_at: string;
  gate: boolean;
  thresholds: Thresholds;
  metrics: CaseMetrics;
  passed: boolean | null;
  cases: CaseResult[];
}

export function buildReport(args: {
  suite: string;
  model: string;
  rewriteModel: string;
  ownerUserId: string;
  gate: boolean;
  thresholds: Thresholds;
  cases: CaseResult[];
}): Report {
  const metrics = aggregate(args.cases);
  return {
    suite: args.suite,
    model: args.model,
    rewrite_model: args.rewriteModel,
    owner_user_id: args.ownerUserId,
    generated_at: new Date().toISOString(),
    gate: args.gate,
    thresholds: args.thresholds,
    metrics,
    // gate 対象モデルのみ合否を判定する。参考モデルは null。
    passed: args.gate ? evaluateGate(metrics, args.thresholds) : null,
    cases: args.cases,
  };
}

/** `<dir>/<suite>__<model>.json` に書き、書いたパスを返す。 */
export function writeReport(dir: string, report: Report): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${report.suite}__${report.model}.json`);
  writeFileSync(path, JSON.stringify(report, null, 2), "utf8");
  return path;
}
