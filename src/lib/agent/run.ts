/** Server-side agentic orchestrator (real backend).
 *
 * 1つのモデルに retrieve / fetch_document を渡し stopWhen でループ。
 * fullStream のパーツを AgentEvent へマッピングする。引用は CitationRegistry で番号統合。 */

import { streamText, stepCountIs, type ModelMessage } from "ai";
import { resolveModels, DEFAULT_MODEL_ID } from "@/lib/agent/models";
import { buildTools, type ToolCallMeta } from "@/lib/agent/tools";
import { CitationRegistry } from "@/lib/agent/citations";
import type { AgentEvent, ToolCall, ToolName } from "@/lib/types";

export interface RunInput {
  query: string;
  ownerUserId: string;
  threadId: string;
  /** 過去ターンの履歴（user/assistant のメッセージ列、窓掛け済み）。 */
  history?: ModelMessage[];
  attachments?: string[];
  modelId?: string;
}

const SYSTEM =
  "あなたは社内ナレッジ検索アシスタントです。必要に応じて retrieve / fetch_document ツールを使い、" +
  "会話の文脈を踏まえて自己完結した検索クエリを組み立ててください。" +
  "回答は提供された一次資料のみに基づき日本語で簡潔に行い、重要な事実には必ずツール結果に付いた [1] [2] の出典番号を付け、" +
  "Markdown の見出し(**太字**)と箇条書き(-)で構造化してください。資料に無いことは推測しないでください。";

const MAX_STEPS = 6;

export async function* runAgent({ query, ownerUserId, threadId, history, modelId }: RunInput): AsyncGenerator<AgentEvent> {
  const started = Date.now();
  const resolution = resolveModels(modelId);

  // キー未設定: 検索も生成もできないため理由を返して終了。
  if (!resolution.ok) {
    yield { type: "answer-start" };
    yield { type: "answer-delta", text: resolution.reason };
    yield { type: "done", tokens: 0, durationMs: Date.now() - started,
            citationMap: {}, sourceIds: [], sources: [], threadId };
    return;
  }

  const registry = new CitationRegistry();
  const meta = new Map<string, ToolCallMeta>();
  const tools = buildTools({ registry, ownerUserId, meta });

  const messages: ModelMessage[] = [...(history ?? []), { role: "user", content: query }];

  const result = streamText({
    model: resolution.models.chat,
    system: SYSTEM,
    messages,
    tools,
    stopWhen: stepCountIs(MAX_STEPS),
  });

  // toolCallId -> step / 開始時刻。tool-call で running、tool-result で done。
  const stepStart = new Map<string, number>();
  const stepById = new Map<string, ToolCall>();
  let answerStarted = false;
  let answer = "";
  let answerStepEmitted = false;
  const answerStart = { t: 0 };

  const emitAnswerStep = (status: "running" | "done"): AgentEvent => ({
    type: "step",
    step: {
      id: "answer", name: "answer" as ToolName, label: "回答生成", status,
      durationMs: status === "done" ? Date.now() - answerStart.t : 0,
      input: {}, output: null, summary: status === "done" ? "回答を生成" : "回答を生成中…",
    },
  });

  try {
    for await (const part of result.fullStream) {
      if (part.type === "tool-call") {
        stepStart.set(part.toolCallId, Date.now());
        const step: ToolCall = {
          id: part.toolCallId, name: part.toolName as ToolName, label: toolLabel(part.toolName),
          status: "running", durationMs: 0,
          input: (part.input ?? {}) as Record<string, unknown>, output: null,
          summary: runningSummary(part.toolName),
        };
        stepById.set(part.toolCallId, step);
        yield { type: "step", step };
      } else if (part.type === "tool-result") {
        const t0 = stepStart.get(part.toolCallId) ?? Date.now();
        const m = meta.get(part.toolCallId);
        const prev = stepById.get(part.toolCallId);
        const step: ToolCall = {
          id: part.toolCallId, name: part.toolName as ToolName, label: toolLabel(part.toolName),
          status: "done", durationMs: Date.now() - t0,
          input: prev?.input ?? (m?.input ?? {}),
          output: { result: String(part.output).slice(0, 2000) },
          summary: m?.summary ?? "完了",
        };
        yield { type: "step", step };
      } else if (part.type === "tool-error") {
        const t0 = stepStart.get(part.toolCallId) ?? Date.now();
        yield {
          type: "step",
          step: {
            id: part.toolCallId, name: part.toolName as ToolName, label: toolLabel(part.toolName),
            status: "error", durationMs: Date.now() - t0,
            input: (part.input ?? {}) as Record<string, unknown>,
            output: { error: String(part.error).slice(0, 500) }, summary: "ツール実行に失敗",
          },
        };
      } else if (part.type === "text-delta") {
        if (!answerStarted) {
          answerStarted = true;
          answerStart.t = Date.now();
          yield emitAnswerStep("running");
          answerStepEmitted = true;
          yield { type: "answer-start" };
        }
        answer += part.text;
        yield { type: "answer-delta", text: part.text };
      }
    }
  } catch {
    if (!answer) {
      if (!answerStarted) yield { type: "answer-start" };
      answer = "回答の生成に失敗しました。時間をおいて再度お試しください。";
      yield { type: "answer-delta", text: answer };
    }
  }

  // ツールを一度も呼ばず本文も無い場合のフォールバック。
  if (!answer) {
    if (!answerStarted) yield { type: "answer-start" };
    answer = registry.size === 0
      ? "該当する資料が見つかりませんでした。別の言い回しで質問するか、関連ファイルをアップロードしてください。"
      : "回答を生成できませんでした。時間をおいて再度お試しください。";
    yield { type: "answer-delta", text: answer };
  }

  if (answerStepEmitted) yield emitAnswerStep("done");

  const tokens = Math.max(1, Math.round(answer.length / 1.8));
  yield {
    type: "done",
    tokens,
    durationMs: Date.now() - started,
    citationMap: registry.toCitationMap(),
    sourceIds: registry.toSources().map((s) => s.id),
    sources: registry.toSources(),
    threadId,
  };
}

function toolLabel(name: string): string {
  if (name === "retrieve") return "知識ベース検索";
  if (name === "fetch_document") return "文書取得";
  return name;
}

function runningSummary(name: string): string {
  if (name === "retrieve") return "知識ベースを検索中…";
  if (name === "fetch_document") return "文書を取得中…";
  return "実行中…";
}

export { DEFAULT_MODEL_ID };
