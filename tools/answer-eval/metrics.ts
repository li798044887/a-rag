/** 回答品質評価の純粋な指標関数。LLM 非依存。
 *
 * fact_coverage は Python eval（rag/eval）と同一の部分一致セマンティクスを踏襲する:
 * Python eval の `normalize_text`（NFKC 正規化＋連続空白の単一空白化＋trim＋小文字化）と
 * 同一の正規化を回答・alias の双方に適用した上での部分一致。 */

import type { FactGroup, CaseMetrics } from "./golden.ts";

export type { CaseMetrics };

/** Python eval の normalize_text と同一: NFKC 正規化 → 連続空白を単一空白化 → trim → 小文字化。 */
function normalizeText(s: string): string {
  return s.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

/** グループの any のいずれかが、正規化後の回答テキストに（部分一致として）含まれるか。
 *  回答・alias の双方に Python eval と同一の normalizeText を適用する。 */
export function factGroupMatched(answer: string, group: FactGroup): boolean {
  const corpus = normalizeText(answer);
  return group.any.some((s) => corpus.includes(normalizeText(s)));
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

function intersectionSize(cited: Set<string>, relevant: Set<string>): number {
  let n = 0;
  for (const r of relevant) if (cited.has(r)) n++;
  return n;
}

/** 関連文書のうち引用できた比率。relevant 空なら 1。 */
export function citationRecall(cited: Set<string>, relevant: string[]): number {
  const rel = new Set(relevant);
  if (rel.size === 0) return 1;
  return intersectionSize(cited, rel) / rel.size;
}

/** 引用のうち関連文書だった比率。引用ゼロは 0。 */
export function citationPrecision(cited: Set<string>, relevant: string[]): number {
  if (cited.size === 0) return 0;
  return intersectionSize(cited, new Set(relevant)) / cited.size;
}
