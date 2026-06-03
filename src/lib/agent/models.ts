/** モデル選択 → AI SDK プロバイダの解決。
 *
 * UI（設定 > モデル）で選んだ model id を、実際の LLM プロバイダ／モデルに変換する。
 * - deepseek-* … DeepSeek Anthropic 互換 API（要 DEEPSEEK_API_KEY）
 * - claude-*    … @ai-sdk/anthropic（要 ANTHROPIC_API_KEY）
 * - gpt-*       … @ai-sdk/openai（要 OPENAI_API_KEY）
 *                 OPENAI_BASE_URL を設定すれば OpenAI 互換の社内/ローカル LLM も同経路で利用可。
 *
 * 各 id ごとに「回答用（chat）」と「クエリ書き換え用（rewrite, 安価モデル）」を返す。
 * キー未設定時は ok:false と日本語の理由を返し、呼び出し側で案内を表示する。 */

import { anthropic, createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

export interface ResolvedModels {
  /** 最終回答（summarize）用の賢いモデル。 */
  chat: LanguageModel;
  /** クエリ書き換え（rewrite_query）用の安価モデル。 */
  rewrite: LanguageModel;
}

export type ModelResolution =
  | { ok: true; models: ResolvedModels }
  | { ok: false; reason: string };

/** UI 既定（MODELS[0]）と一致させる。route 側で model 未指定のときのフォールバック。 */
export const DEFAULT_MODEL_ID = "deepseek-flash";

const ANTHROPIC_REWRITE = "claude-haiku-4-5";
const OPENAI_REWRITE = "gpt-4o";

/** DeepSeek API モデル名へのマッピング */
const DEEPSEEK_MODEL_MAP: Record<string, string> = {
  "deepseek-flash": "deepseek-chat",
  "deepseek-v4-pro": "deepseek-reasoner",
};

export function resolveModels(modelId: string = DEFAULT_MODEL_ID): ModelResolution {
  // DeepSeek (deepseek-*) — Anthropic 互換 API（tool calling 対応）
  if (modelId.startsWith("deepseek-")) {
    if (!process.env.DEEPSEEK_API_KEY) return { ok: false, reason: missingKey("DEEPSEEK_API_KEY") };
    const apiModel = DEEPSEEK_MODEL_MAP[modelId] || "deepseek-chat";
    const deepseek = createAnthropic({
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/anthropic",
    });
    return { ok: true, models: { chat: deepseek(apiModel), rewrite: deepseek("deepseek-chat") } };
  }

  // Anthropic (claude-*)
  if (modelId.startsWith("claude-")) {
    if (!process.env.ANTHROPIC_API_KEY) return { ok: false, reason: missingKey("ANTHROPIC_API_KEY") };
    return { ok: true, models: { chat: anthropic(modelId), rewrite: anthropic(ANTHROPIC_REWRITE) } };
  }

  // OpenAI (gpt-*)。OPENAI_BASE_URL 設定時は OpenAI 互換エンドポイントへ。
  if (modelId.startsWith("gpt-")) {
    if (!process.env.OPENAI_API_KEY) return { ok: false, reason: missingKey("OPENAI_API_KEY") };
    const openai = createOpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL || undefined,
    });
    return { ok: true, models: { chat: openai(modelId), rewrite: openai(OPENAI_REWRITE) } };
  }

  return { ok: false, reason: `未対応のモデルです (${modelId})。` };
}

function missingKey(envName: string): string {
  return `回答の生成には ${envName} の設定が必要です。検索でヒットした一次資料は右パネルでご確認いただけます。`;
}
