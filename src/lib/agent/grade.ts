/** 取得チャンクの関連度判定（ハイブリッド）。
 *  まず rerank スコア閾値で安価にゲートし、閾値近傍の曖昧帯のみ LLM 判定する。
 *  関連が一件も残らなければ needRetry=true を返し、呼び出し側が再検索する。 */
import { generateObject, type LanguageModel } from "ai";
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

  if (ambiguous.length > 0) {
    try {
      const { object } = await generateObject({
        model,
        schema: z.object({ relevantIds: z.array(z.string()) }),
        system: prompts.grade.system,
        prompt: JSON.stringify({
          query,
          candidates: ambiguous.map((c) => ({
            chunkId: c.chunkId, title: c.documentTitle, heading: c.headingPath,
            text: c.text.slice(0, 600),
          })),
        }),
      });
      const valid = new Set(ambiguous.map((c) => c.chunkId));
      for (const id of object.relevantIds) if (valid.has(id)) kept.add(id);
    } catch {
      // LLM 失敗時は強スコアのみで続行（回答は必ず出す方針）。
    }
  }

  const keptIds = chunks.map((c) => c.chunkId).filter((id) => kept.has(id));
  return { keptIds, needRetry: keptIds.length < MIN_KEPT, total };
}
