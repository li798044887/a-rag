/** エージェント挙動設定の既定値・境界・正規化・システムプロンプト生成。
 *  client（フック）と server（chat route / runAgent）で共用するため、
 *  "use client" 依存を一切持たない純モジュールにする。 */
import type { AgentCfg } from "@/lib/types";
import type { Locale } from "@/i18n/config";
import { getAgentPrompts } from "@/lib/agent/prompts";

export const AGENT_CFG_DEFAULTS: AgentCfg = {
  maxSteps: 12,
  parallelTools: 3,
  requireCitations: true,
  admitUnknown: true,
  topK: 6,
  candidateK: 10,
};

export const MAX_STEPS_MIN = 1;
export const MAX_STEPS_MAX = 20;
export const PARALLEL_MIN = 1;
export const PARALLEL_MAX = 8;
export const TOP_K_MIN = 1;
export const TOP_K_MAX = 20;
export const CANDIDATE_K_MIN = 1;
export const CANDIDATE_K_MAX = 50;

function clampInt(raw: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function asBool(raw: unknown, fallback: boolean): boolean {
  return typeof raw === "boolean" ? raw : fallback;
}

/** localStorage / リクエスト由来の任意の値を、常に有効な AgentCfg へ正規化する。 */
export function clampAgentCfg(raw: unknown): AgentCfg {
  const o =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const topK = clampInt(o.topK, TOP_K_MIN, TOP_K_MAX, AGENT_CFG_DEFAULTS.topK);
  // candidate_k は最終件数 top_k 以上でなければ意味をなさないため引き上げる。
  const candidateK = Math.max(
    clampInt(o.candidateK, CANDIDATE_K_MIN, CANDIDATE_K_MAX, AGENT_CFG_DEFAULTS.candidateK),
    topK,
  );
  return {
    maxSteps: clampInt(o.maxSteps, MAX_STEPS_MIN, MAX_STEPS_MAX, AGENT_CFG_DEFAULTS.maxSteps),
    parallelTools: clampInt(o.parallelTools, PARALLEL_MIN, PARALLEL_MAX, AGENT_CFG_DEFAULTS.parallelTools),
    requireCitations: asBool(o.requireCitations, AGENT_CFG_DEFAULTS.requireCitations),
    admitUnknown: asBool(o.admitUnknown, AGENT_CFG_DEFAULTS.admitUnknown),
    topK,
    candidateK,
  };
}

/** 設定と言語に応じてエージェントのシステムプロンプトを組み立てる。
 *  プロンプト断片は言語別に prompts.ts が保持する（zh は RAG 専門家視点で最適化）。 */
export function buildSystemPrompt(cfg: AgentCfg, locale: Locale): string {
  const p = getAgentPrompts(locale);
  const citation = cfg.requireCitations ? p.citationRequired : p.citationOptional;
  const unknown = cfg.admitUnknown ? p.unknownAdmit : p.unknownFill;
  return p.systemIntro + citation + unknown;
}
