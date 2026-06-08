/** 1 case / 1 model の実行と指標算出。runAgent は依存注入で受け、スタック非依存にテスト可能にする。 */

import type { AgentEvent } from "@/lib/types";
import type { Golden, GoldenCase, CaseMetrics } from "./golden.ts";
import { factCoverage, citationRecall, citationPrecision } from "./metrics.ts";

type DoneEvent = Extract<AgentEvent, { type: "done" }>;

/** runAgent の評価で必要な最小シグネチャ。run.mts が本番 runAgent を渡す。 */
export type RunAgentFn = (input: {
  query: string;
  ownerUserId: string;
  threadId: string;
  modelId: string;
  locale?: string;
}) => AsyncIterable<AgentEvent>;

export interface CaseResult extends CaseMetrics {
  id: string;
  cited_documents: string[];
  relevant_documents: string[];
  fact_groups: { any: string[]; matched: boolean }[];
  answer_excerpt: string;
  duration_ms: number;
  tokens: number;
}

export interface RunOpts { ownerUserId: string; modelId: string; locale?: string; }

/** done.citationMap の sourceId(documentId) を sources の title(documentTitle) へ写像（重複排除）。 */
export function citedDocumentTitles(done: DoneEvent): string[] {
  const idToTitle = new Map(done.sources.map((s) => [s.id, s.title]));
  const ids = new Set(Object.values(done.citationMap).map((c) => c.sourceId));
  return [...ids].map((id) => idToTitle.get(id) ?? id);
}

/** answer-delta を連結し、done を取り出す。 */
export async function collect(
  events: AsyncIterable<AgentEvent>,
): Promise<{ answer: string; done: DoneEvent | null }> {
  let answer = "";
  let done: DoneEvent | null = null;
  for await (const ev of events) {
    if (ev.type === "answer-delta") answer += ev.text;
    else if (ev.type === "done") done = ev;
  }
  return { answer, done };
}

export async function runCase(run: RunAgentFn, opts: RunOpts, gc: GoldenCase): Promise<CaseResult> {
  const started = Date.now();
  const { answer, done } = await collect(
    run({
      query: gc.query,
      ownerUserId: opts.ownerUserId,
      threadId: `answer-eval:${gc.id}`,
      modelId: opts.modelId,
      locale: opts.locale ?? "ja",
    }),
  );
  const cited = done ? citedDocumentTitles(done) : [];
  const citedSet = new Set(cited);
  const { coverage, matched } = factCoverage(answer, gc.key_facts);
  return {
    id: gc.id,
    citation_recall: citationRecall(citedSet, gc.relevant_documents),
    citation_precision: citationPrecision(citedSet, gc.relevant_documents),
    answer_fact_coverage: coverage,
    cited_documents: cited,
    relevant_documents: gc.relevant_documents,
    fact_groups: gc.key_facts.map((g, i) => ({ any: g.any, matched: matched[i] })),
    answer_excerpt: answer.slice(0, 200),
    duration_ms: Date.now() - started,
    tokens: done?.tokens ?? 0,
  };
}

/** golden の全 case を 1 モデルで順次実行する。 */
export async function runModel(
  run: RunAgentFn,
  golden: Golden,
  modelId: string,
  locale = "ja",
): Promise<CaseResult[]> {
  const results: CaseResult[] = [];
  for (const gc of golden.cases) {
    results.push(await runCase(run, { ownerUserId: golden.owner_user_id, modelId, locale }, gc));
  }
  return results;
}
