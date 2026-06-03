/** 取得チャンクの関連度判定（ハイブリッド）。
 *  まず rerank スコア閾値で安価にゲートし、閾値近傍の曖昧帯を LLM 判定する。
 *  rerank スコアが未校正で全件が低いケースでは、上位候補も LLM 判定へ回す。
 *  関連が一件も残らなければ needRetry=true を返し、呼び出し側が再検索する。 */
import { generateText, Output, type LanguageModel } from "ai";
import { z } from "zod";
import type { AgentPrompts } from "@/lib/agent/prompts";

export interface GradeChunk {
  chunkId: string;
  score: number;
  documentTitle: string;
  headingPath: string;
  text: string;
}

export interface GradeResult {
  /** 関連と判断したチャンク ID（強スコア＋LLM 採択）。 */
  keptIds: string[];
  /** 関連が不足し再検索すべきか。 */
  needRetry: boolean;
  /** 判定対象の総数（サマリ表示用）。 */
  total: number;
}

/** 閾値からどれだけ下までを「曖昧帯」として LLM に回すか。 */
const AMBIGUOUS_MARGIN = 0.1;
/** スコアが全体に低いときに LLM 判定へ回す上位件数。 */
const LOW_SCORE_REVIEW_LIMIT = 3;
/** これ未満しか関連が残らなければ再検索する。 */
const MIN_KEPT = 1;

export async function gradeChunks(input: {
  query: string;
  chunks: GradeChunk[];
  threshold: number;
  model: LanguageModel;
  prompts: AgentPrompts;
}): Promise<GradeResult> {
  const { query, chunks, threshold, model, prompts } = input;
  const total = chunks.length;

  const strong = chunks.filter((c) => c.score >= threshold);
  const ambiguous = chunks.filter((c) => c.score < threshold && c.score >= threshold - AMBIGUOUS_MARGIN);

  const kept = new Set(strong.map((c) => c.chunkId));
  const llmCandidates = strong.length > 0 || ambiguous.length > 0
    ? ambiguous
    : chunks.slice(0, LOW_SCORE_REVIEW_LIMIT);

  if (llmCandidates.length > 0) {
    try {
      const { output } = await generateText({
        model,
        output: Output.object({ schema: z.object({ relevantIds: z.array(z.string()) }) }),
        system: prompts.grade.system,
        prompt: JSON.stringify({
          query,
          candidates: llmCandidates.map((c) => ({
            chunkId: c.chunkId, title: c.documentTitle, heading: c.headingPath,
            text: c.text.slice(0, 600),
          })),
        }),
      });
      const valid = new Set(llmCandidates.map((c) => c.chunkId));
      for (const id of output.relevantIds) if (valid.has(id)) kept.add(id);
    } catch {
      // LLM 失敗時は強スコアのみで続行（回答は必ず出す方針）。
    }
  }

  const keptIds = chunks.map((c) => c.chunkId).filter((id) => kept.has(id));
  return { keptIds, needRetry: keptIds.length < MIN_KEPT, total };
}
