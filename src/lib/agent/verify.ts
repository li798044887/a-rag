/** 生成回答の根拠検証（groundedness）と訂正再生成。
 *  回答中の主張を出典 snippet と突合し、未裏付けがあれば（上限内で）出典のみに基づき書き直す。 */
import { generateText, Output, type LanguageModel } from "ai";
import { z } from "zod";
import type { AgentPrompts } from "@/lib/agent/prompts";

export interface VerifySource {
  n: number;
  title: string;
  heading: string;
  snippet: string;
}

export interface VerifyResult {
  /** 出典で裏付けられない主張。 */
  unsupported: string[];
  /** 訂正再生成した本文（行わなかった場合は null）。 */
  revised: string | null;
}

const INSUFFICIENT_EVIDENCE_PATTERNS = [
  /无法(?:从|根据|基于)?(?:现有|已有|提供的|检索到的|给定)?(?:资料|信息|内容|出处|文档|材料)?(?:中)?(?:判断|确定|确认|得出|评估|比较|说明|推断)/,
  /(?:现有|已有|提供的|检索到的|给定)?(?:资料|信息|内容|出处|文档|材料)(?:不足|不够|有限|中没有|未提供|未显示|未提及|未记载|没有明确)/,
  /没有(?:足够|相关|明确).{0,16}(?:资料|信息|依据|出处|证据)/,
  /(?:わかりません|分かりません|判断できません|判断できない|確認できません|確認できない|特定できません|特定できない|不明です)/,
  /資料(?:が|では|からは).{0,16}(?:不足|確認でき|判断でき|わかり|分かり)/,
  /cannot (?:determine|confirm|verify|assess)|insufficient (?:information|evidence|data)|not enough (?:information|evidence|data)/i,
];

const ADVICE_PATTERNS = [
  /建议(?:您)?(?:查看|查询|参考|查阅|确认)/,
  /(?:確認|参照)(?:してください|ください|することをおすすめ)/,
  /(?:ご確認|ご参照)ください/,
  /(?:please )?(?:check|review|refer to|consult)/i,
];

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
}

function splitSentences(text: string): string[] {
  return text.split(/[。！？.!?\n]+/).map((s) => s.trim()).filter(Boolean);
}

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function isInsufficientEvidenceClaim(claim: string, answer: string): boolean {
  if (matchesAny(claim, INSUFFICIENT_EVIDENCE_PATTERNS) || matchesAny(claim, ADVICE_PATTERNS)) {
    return true;
  }

  const claimText = normalizeText(claim);
  if (!claimText) return true;

  return splitSentences(answer)
    .filter((sentence) => matchesAny(sentence, INSUFFICIENT_EVIDENCE_PATTERNS))
    .some((sentence) => normalizeText(sentence).includes(claimText));
}

function filterUnsupportedClaims(claims: string[], answer: string): string[] {
  return claims.filter((claim) => !isInsufficientEvidenceClaim(claim, answer));
}

export async function verifyAnswer(input: {
  query: string;
  answer: string;
  sources: VerifySource[];
  model: LanguageModel;
  prompts: AgentPrompts;
  maxRevisions: number;
}): Promise<VerifyResult> {
  const { query, answer, sources, model, prompts, maxRevisions } = input;

  let unsupported: string[] = [];
  try {
    const { output } = await generateText({
      model,
      output: Output.object({ schema: z.object({ unsupported: z.array(z.string()) }) }),
      system: prompts.verify.system,
      prompt: JSON.stringify({ query, answer, sources }),
    });
    unsupported = filterUnsupportedClaims(output.unsupported, answer);
  } catch {
    // 検証失敗時は素通し（回答は必ず出す方針）。
    return { unsupported: [], revised: null };
  }

  if (unsupported.length === 0 || maxRevisions <= 0) {
    return { unsupported, revised: null };
  }

  try {
    const { text } = await generateText({
      model,
      system: prompts.revise.system,
      prompt: JSON.stringify({ answer, unsupported, sources }),
    });
    return { unsupported, revised: text.trim() || null };
  } catch {
    return { unsupported, revised: null };
  }
}
