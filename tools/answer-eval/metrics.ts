/** 回答品質評価の純粋な指標関数。LLM 非依存。
 *
 * fact_coverage は Python eval（rag/eval）と同一の部分一致セマンティクスを踏襲する:
 * 正規化なしの素の substring。golden が半角/全角を両方列挙しているのはこの前提のため。 */

import type { FactGroup, CaseMetrics } from "./golden.ts";

export type { CaseMetrics };

/** グループの any のいずれかが回答テキストに（素の substring として）含まれるか。 */
export function factGroupMatched(answer: string, group: FactGroup): boolean {
  return group.any.some((s) => answer.includes(s));
}

/** 充足グループ比率と、各グループの真偽配列を返す。グループ空なら coverage=1。 */
export function factCoverage(
  answer: string,
  groups: FactGroup[],
): { coverage: number; matched: boolean[] } {
  const matched = groups.map((g) => factGroupMatched(answer, g));
  const coverage = groups.length === 0 ? 1 : matched.filter(Boolean).length / groups.length;
  return { coverage, matched };
}

function intersectionSize(cited: Set<string>, relevant: string[]): number {
  return relevant.reduce((n, r) => (cited.has(r) ? n + 1 : n), 0);
}

/** 関連文書のうち引用できた比率。relevant 空なら 1。 */
export function citationRecall(cited: Set<string>, relevant: string[]): number {
  if (relevant.length === 0) return 1;
  return intersectionSize(cited, relevant) / relevant.length;
}

/** 引用のうち関連文書だった比率。引用ゼロは 0。 */
export function citationPrecision(cited: Set<string>, relevant: string[]): number {
  if (cited.size === 0) return 0;
  return intersectionSize(cited, relevant) / cited.size;
}
