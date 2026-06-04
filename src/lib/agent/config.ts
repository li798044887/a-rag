/** エージェント挙動設定の既定値・境界・正規化・システムプロンプト生成。
 *  client（フック）と server（chat route / runAgent）で共用するため、
 *  "use client" 依存を一切持たない純モジュールにする。 */
import type { AgentCfg } from "@/lib/types";
import type { Locale } from "@/i18n/config";
import { getAgentPrompts, type TemporalPromptContext } from "@/lib/agent/prompts";

export const AGENT_CFG_DEFAULTS: AgentCfg = {
  maxSteps: 12,
  parallelTools: 3,
  requireCitations: true,
  admitUnknown: true,
  topK: 6,
  candidateK: 10,
  maxRetrieveRetries: 1,
  gradeThreshold: 0.5,
  maxRevisions: 1,
  verify: true,
};

export const MAX_STEPS_MIN = 1;
export const MAX_STEPS_MAX = 20;
export const PARALLEL_MIN = 1;
export const PARALLEL_MAX = 8;
export const TOP_K_MIN = 1;
export const TOP_K_MAX = 20;
export const CANDIDATE_K_MIN = 1;
export const CANDIDATE_K_MAX = 50;
export const RETRIEVE_RETRIES_MIN = 0;
export const RETRIEVE_RETRIES_MAX = 2;
export const REVISIONS_MIN = 0;
export const REVISIONS_MAX = 1;
export const GRADE_THRESHOLD_MIN = 0;
export const GRADE_THRESHOLD_MAX = 1;

function clampInt(raw: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function clampFloat(raw: unknown, min: number, max: number, fallback: number): number {
  const n = Number(raw);
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
    maxRetrieveRetries: clampInt(o.maxRetrieveRetries, RETRIEVE_RETRIES_MIN, RETRIEVE_RETRIES_MAX, AGENT_CFG_DEFAULTS.maxRetrieveRetries),
    gradeThreshold: clampFloat(o.gradeThreshold, GRADE_THRESHOLD_MIN, GRADE_THRESHOLD_MAX, AGENT_CFG_DEFAULTS.gradeThreshold),
    maxRevisions: clampInt(o.maxRevisions, REVISIONS_MIN, REVISIONS_MAX, AGENT_CFG_DEFAULTS.maxRevisions),
    verify: asBool(o.verify, AGENT_CFG_DEFAULTS.verify),
  };
}

/** 設定と言語に応じてエージェントのシステムプロンプトを組み立てる。
 *  プロンプト断片は言語別に prompts.ts が保持する（zh は RAG 専門家視点で最適化）。 */
export function buildSystemPrompt(cfg: AgentCfg, locale: Locale, now = new Date(), timeZone = resolveTimeZone()): string {
  const p = getAgentPrompts(locale);
  const citation = cfg.requireCitations ? p.citationRequired : p.citationOptional;
  const unknown = cfg.admitUnknown ? p.unknownAdmit : p.unknownFill;
  return p.systemIntro + p.temporalContext(buildTemporalPromptContext(now, timeZone)) + citation + unknown;
}

export function buildTemporalPromptContext(now: Date, timeZone = resolveTimeZone()): TemporalPromptContext {
  const today = calendarDateInTimeZone(now, timeZone);
  const yesterday = addCalendarDays(today, -1);
  const tomorrow = addCalendarDays(today, 1);
  return {
    nowDate: formatCalendarDate(today),
    nowTime: timeInTimeZone(now, timeZone),
    today: formatCalendarDate(today),
    yesterday: formatCalendarDate(yesterday),
    tomorrow: formatCalendarDate(tomorrow),
    timeZone,
  };
}

function resolveTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function calendarDateInTimeZone(date: Date, timeZone: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  return {
    year: Number(parts.find((p) => p.type === "year")?.value),
    month: Number(parts.find((p) => p.type === "month")?.value),
    day: Number(parts.find((p) => p.type === "day")?.value),
  };
}

function timeInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return ["hour", "minute", "second"]
    .map((type) => parts.find((p) => p.type === type)?.value ?? "00")
    .join(":");
}

function addCalendarDays(date: { year: number; month: number; day: number }, days: number): { year: number; month: number; day: number } {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function formatCalendarDate(date: { year: number; month: number; day: number }): string {
  const month = String(date.month).padStart(2, "0");
  const day = String(date.day).padStart(2, "0");
  return `${date.year}-${month}-${day}`;
}
