/** 生成回答の根拠検証（groundedness）と訂正再生成。
 *  回答中の主張を出典 snippet と突合し、未裏付けがあれば（上限内で）出典のみに基づき書き直す。 */
import { generateText, Output, type LanguageModel, type LanguageModelUsage } from "ai";
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
  /** 検証対象になった事実主張数。不足表明だけの回答では 0。 */
  checkableClaims: number;
  /** 訂正再生成した本文（行わなかった場合は null）。 */
  revised: string | null;
  /** 根拠検証に実際に使ったトークン量。 */
  verifyUsage: LanguageModelUsage | null;
  /** 訂正再生成に実際に使ったトークン量（行わなかった場合は null）。 */
  reviseUsage: LanguageModelUsage | null;
}

type VerifyVerdict = "supported" | "unsupported" | "not_a_claim";

interface VerifiedClaim {
  text: string;
  citedNums: number[];
  verdict: VerifyVerdict;
  reason?: string;
}

const VerifiedClaimSchema = z.object({
  text: z.string(),
  citedNums: z.array(z.number().int()).default([]),
  verdict: z.enum(["supported", "unsupported", "not_a_claim"]),
  reason: z.string().optional(),
});

const VerifyOutputSchema = z.object({
  claims: z.array(VerifiedClaimSchema),
});

const INSUFFICIENT_EVIDENCE_PATTERNS = [
  /无法(?:从|根据|基于)?(?:现有|已有|提供的|检索到的|给定)?(?:资料|信息|内容|出处|文档|材料)?(?:中)?(?:判断|确定|确认|得出|评估|比较|说明|推断)/,
  /(?:现有|已有|提供的|检索到的|给定)?(?:资料|信息|内容|出处|文档|材料)(?:不足|不够|有限|中没有|未提供|未显示|未提及|未记载|没有明确)/,
  /没有(?:足够|相关|明确).{0,16}(?:资料|信息|依据|出处|证据)/,
  /没有(?:相关|对应|匹配).{0,16}(?:记录|资料|信息|内容|结果)/,
  /无法提供(?:具体|相关|明确)?(?:信息|内容|答案|回答)/,
  /(?:わかりません|分かりません|わからない|分からない|判断できません|判断できない|確認できません|確認できない|特定できません|特定できない|不明です)/,
  /資料(?:が|では|からは).{0,16}(?:不足|確認でき|判断でき|わかり|分かり)/,
  /(?:資料|社内資料|出典|文書|情報|データ)(?:には|では|からは|中には|中に)?.{0,80}(?:具体的な)?(?:情報|記載|データ)?.{0,24}(?:含まれていない|含まれていません|記載されていない|記載がない|見当たらない|ありません|ない)/,
  /(?:明確な回答|具体的な回答|回答|比較|判断).{0,24}(?:難しい|できない|しかありません)/,
  /cannot (?:determine|confirm|verify|assess)|insufficient (?:information|evidence|data)|not enough (?:information|evidence|data)/i,
];

const ADVICE_PATTERNS = [
  /建议(?:您)?(?:查看|查询|参考|查阅|确认)/,
  /如果(?:您|你)?能?(?:提供|补充).{0,40}(?:我|我们)?(?:可|可以|会|将)?(?:尝试|帮(?:您|你)?|为(?:您|你)?|查找|查询|检索|确认|分析)/,
  /(?:確認|参照)(?:してください|ください|することをおすすめ)/,
  /(?:ご確認|ご参照)ください/,
  /(?:追加|具体的な).{0,24}(?:情報|資料|データ|会社名).{0,24}(?:提供|共有).{0,24}(?:いただければ|ください)/,
  /如果.{0,40}(?:还有其他问题|需要帮助).{0,40}(?:告诉|联系|咨询)/,
  /(?:please )?(?:check|review|refer to|consult)/i,
  /if you (?:can|could) provide.{0,80}(?:i|we) (?:can|could|will)/i,
];

const NON_CLAIM_FRAGMENT_PATTERNS = [
  /(?:どの|どれ|何|どんな|いくら|どれくらい|どの程度).{0,80}(?:か|かどうか)の(?:具体的な)?(?:情報|データ|記載|資料|内容|比較|状況)$/,
  /(?:具体的な)?(?:情報|データ|記載|資料|内容|比較|状況)$/,
  /(?:企业|公司|收入|营收|收益).{0,80}(?:水平|情况|信息|数据|资料)$/,
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

function isNonClaimFragment(claim: string): boolean {
  const trimmed = claim.trim();
  return matchesAny(trimmed, NON_CLAIM_FRAGMENT_PATTERNS);
}

function isInsufficientEvidenceClaim(claim: string, answer: string): boolean {
  if (
    isNonClaimFragment(claim) ||
    matchesAny(claim, INSUFFICIENT_EVIDENCE_PATTERNS) ||
    matchesAny(claim, ADVICE_PATTERNS)
  ) {
    return true;
  }

  const claimText = normalizeText(claim);
  if (!claimText) return true;

  return splitSentences(answer)
    .filter((sentence) => matchesAny(sentence, INSUFFICIENT_EVIDENCE_PATTERNS))
    .some((sentence) => normalizeText(sentence).includes(claimText));
}

function isCautiousFallbackSentence(sentence: string): boolean {
  return matchesAny(sentence, INSUFFICIENT_EVIDENCE_PATTERNS) || matchesAny(sentence, ADVICE_PATTERNS);
}

function isCautiousFallbackAnswer(answer: string): boolean {
  const sentences = splitSentences(answer);
  return sentences.length > 0 && sentences.every(isCautiousFallbackSentence);
}

function filterUnsupportedClaims(claims: string[], answer: string): string[] {
  if (isCautiousFallbackAnswer(answer)) return [];
  return claims.filter((claim) => !isInsufficientEvidenceClaim(claim, answer));
}

function analyzeVerifiedClaims(
  claims: VerifiedClaim[],
  answer: string,
  sources: VerifySource[],
): { unsupported: string[]; checkableClaims: number } {
  if (isCautiousFallbackAnswer(answer)) return { unsupported: [], checkableClaims: 0 };
  const validNums = new Set(sources.map((source) => source.n));
  const checkableClaims = claims.filter(
    (claim) => claim.verdict !== "not_a_claim" && !isInsufficientEvidenceClaim(claim.text, answer),
  ).length;
  const unsupported = claims
    .filter((claim) => claim.verdict === "unsupported" || claim.citedNums.some((n) => !validNums.has(n)))
    .map((claim) => claim.text.trim())
    .filter(Boolean);
  return { unsupported: filterUnsupportedClaims(unsupported, answer), checkableClaims };
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
  let checkableClaims = 0;
  let verifyUsage: LanguageModelUsage | null = null;
  try {
    const { output, totalUsage } = await generateText({
      model,
      output: Output.object({ schema: VerifyOutputSchema }),
      system: prompts.verify.system,
      prompt: JSON.stringify({ query, answer, sources }),
    });
    const raw = output as { claims?: VerifiedClaim[]; unsupported?: string[] };
    if (raw.claims) {
      const analyzed = analyzeVerifiedClaims(raw.claims, answer, sources);
      unsupported = analyzed.unsupported;
      checkableClaims = analyzed.checkableClaims;
    } else {
      unsupported = filterUnsupportedClaims(raw.unsupported ?? [], answer);
      checkableClaims = isCautiousFallbackAnswer(answer) ? 0 : Math.max(unsupported.length, 1);
    }
    verifyUsage = totalUsage;
  } catch {
    // 検証失敗時は素通し（回答は必ず出す方針）。
    return { unsupported: [], checkableClaims: 0, revised: null, verifyUsage: null, reviseUsage: null };
  }

  if (unsupported.length === 0 || maxRevisions <= 0) {
    return { unsupported, checkableClaims, revised: null, verifyUsage, reviseUsage: null };
  }

  try {
    const { text, totalUsage } = await generateText({
      model,
      system: prompts.revise.system,
      prompt: JSON.stringify({ query, answer, unsupported, sources }),
    });
    return { unsupported, checkableClaims, revised: text.trim() || null, verifyUsage, reviseUsage: totalUsage };
  } catch {
    return { unsupported, checkableClaims, revised: null, verifyUsage, reviseUsage: null };
  }
}
