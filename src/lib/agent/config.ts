/** エージェント挙動設定の既定値・境界・正規化・システムプロンプト生成。
 *  client（フック）と server（chat route / runAgent）で共用するため、
 *  "use client" 依存を一切持たない純モジュールにする。 */
import type { AgentCfg } from "@/lib/types";

export const AGENT_CFG_DEFAULTS: AgentCfg = {
  maxSteps: 12,
  parallelTools: 3,
  requireCitations: true,
  admitUnknown: true,
};

export const MAX_STEPS_MIN = 1;
export const MAX_STEPS_MAX = 20;
export const PARALLEL_MIN = 1;
export const PARALLEL_MAX = 8;

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
  return {
    maxSteps: clampInt(o.maxSteps, MAX_STEPS_MIN, MAX_STEPS_MAX, AGENT_CFG_DEFAULTS.maxSteps),
    parallelTools: clampInt(o.parallelTools, PARALLEL_MIN, PARALLEL_MAX, AGENT_CFG_DEFAULTS.parallelTools),
    requireCitations: asBool(o.requireCitations, AGENT_CFG_DEFAULTS.requireCitations),
    admitUnknown: asBool(o.admitUnknown, AGENT_CFG_DEFAULTS.admitUnknown),
  };
}

/** 設定に応じてエージェントのシステムプロンプトを組み立てる。 */
export function buildSystemPrompt(cfg: AgentCfg): string {
  const citation = cfg.requireCitations
    ? "重要な事実には必ずツール結果に付いた [1] [2] の出典番号を付けてください。"
    : "可能であればツール結果に付いた [1] [2] の出典番号を付けてください（必須ではありません）。";
  const unknown = cfg.admitUnknown
    ? "資料に無いことは推測せず、判断できない場合は「わからない」と明確に答えてください。"
    : "資料に直接の記載が無い場合は、一般的な知識で補って回答してもかまいません。";
  return (
    "あなたは社内ナレッジ検索アシスタントです。必要に応じて retrieve / fetch_document ツールを使い、" +
    "会話の文脈を踏まえて自己完結した検索クエリを組み立ててください。" +
    "回答は提供された一次資料に基づき日本語で簡潔に行い、" +
    "Markdown の見出し(**太字**)と箇条書き(-)で構造化してください。" +
    citation +
    unknown
  );
}
