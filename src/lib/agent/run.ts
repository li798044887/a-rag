/** Server-side agentic orchestrator (real backend).
 *
 * 1つのモデルに retrieve / fetch_document を渡し stopWhen でループ。
 * fullStream のパーツと、retrieve ツールが StepBus に流すサブステップを
 * 統合して AgentEvent として yield する。引用は CitationRegistry で番号統合。 */

import { streamText, stepCountIs, type LanguageModelUsage, type ModelMessage } from "ai";
import { resolveModels, DEFAULT_MODEL_ID } from "@/lib/agent/models";
import { buildTools, type ToolCallMeta } from "@/lib/agent/tools";
import { CitationRegistry } from "@/lib/agent/citations";
import { StepBus } from "@/lib/agent/step-bus";
import type { AgentEvent, ToolCall, ToolName } from "@/lib/types";
import { getAgentPrompts, type AgentPrompts } from "@/lib/agent/prompts";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/config";

export interface RunInput {
  query: string;
  ownerUserId: string;
  threadId: string;
  history?: ModelMessage[];
  attachments?: string[];
  attachmentDocIds?: string[];
  modelId?: string;
  locale?: Locale;
}

const MAX_STEPS = 6;

export async function* runAgent(input: RunInput): AsyncGenerator<AgentEvent> {
  const bus = new StepBus();
  // pump は drain と並行に走らせる（await しない）。完了時に必ず bus.close()。
  void pump(input, bus);
  for await (const ev of bus) yield ev;
}

async function pump(
  { query, ownerUserId, threadId, history, modelId, attachments, attachmentDocIds, locale }: RunInput,
  bus: StepBus,
): Promise<void> {
  // pump の本体は何が throw しても必ず bus.close() する。これを欠くと runAgent の
  // drain が永久にハングする（pump は fire-and-forget なので reject も握り潰される）。
  try {
    const started = Date.now();
    const modelLabel = modelId ?? DEFAULT_MODEL_ID;
    const resolution = resolveModels(modelId);
    const prompts = getAgentPrompts(locale ?? DEFAULT_LOCALE);

    // キー未設定: 検索も生成もできないため理由を返して終了（finally で close）。
    if (!resolution.ok) {
      bus.push({ type: "answer-start" });
      bus.push({ type: "answer-delta", text: prompts.fallback.modelUnavailable });
      bus.push({ type: "done", tokens: 0, durationMs: Date.now() - started,
                citationMap: {}, sourceIds: [], sources: [], threadId });
      return;
    }

    const registry = new CitationRegistry();
    const meta = new Map<string, ToolCallMeta>();
    const tools = buildTools({ registry, ownerUserId, meta, bus, attachmentDocIds, prompts });

    const userContent = prompts.buildUserContent(query, attachments ?? [], attachmentDocIds ?? []);
    const messages: ModelMessage[] = [...(history ?? []), { role: "user", content: userContent }];

    const result = streamText({
      model: resolution.models.chat,
      system: prompts.system,
      messages,
      tools,
      stopWhen: stepCountIs(MAX_STEPS),
    });

    const stepStart = new Map<string, number>();
    const stepById = new Map<string, ToolCall>();
    let answerStarted = false;
    let answer = "";
    let answerStepEmitted = false;
    let answerStartT = 0;
    let totalUsage: LanguageModelUsage | undefined;

    const emitAnswerStep = (status: "running" | "done", t: number, usage?: LanguageModelUsage): AgentEvent => ({
      type: "step",
      step: {
        id: "answer", name: "answer" as ToolName, label: prompts.answerStep.label, status,
        durationMs: status === "done" ? Date.now() - t : 0,
        input: { model: modelLabel },
        output: status === "done"
          ? {
              inputTokens: usage?.inputTokens ?? null,
              outputTokens: usage?.outputTokens ?? null,
              totalTokens: usage?.totalTokens ?? null,
              cachedInputTokens: usage?.inputTokenDetails?.cacheReadTokens ?? null,
            }
          : null,
        summary: status === "done" ? prompts.answerStep.done : prompts.answerStep.running,
      },
    });

    try {
      for await (const part of result.fullStream) {
        if (part.type === "tool-call") {
          // retrieve の直前に rewrite_query をトップレベル兄弟として出す（モデルが送ったクエリの可視化）。
          if (part.toolName === "retrieve") {
            const rewritten = (part.input as { query?: string } | undefined)?.query ?? query;
            bus.push({ type: "step", step: {
              id: `${part.toolCallId}:rewrite`, name: "rewrite_query", label: prompts.rewriteLabel,
              status: "done", durationMs: 0,
              input: { original: query, rewritten },
              output: null, summary: prompts.rewriteSummary(rewritten),
            } });
          }
          stepStart.set(part.toolCallId, Date.now());
          const step: ToolCall = {
            id: part.toolCallId, name: part.toolName as ToolName, label: toolLabelOf(prompts, part.toolName),
            status: "running", durationMs: 0,
            input: (part.input ?? {}) as Record<string, unknown>, output: null,
            summary: runningSummaryOf(prompts, part.toolName),
          };
          stepById.set(part.toolCallId, step);
          bus.push({ type: "step", step });
        } else if (part.type === "tool-result") {
          const t0 = stepStart.get(part.toolCallId) ?? Date.now();
          const m = meta.get(part.toolCallId);
          const prev = stepById.get(part.toolCallId);
          const step: ToolCall = {
            id: part.toolCallId, name: part.toolName as ToolName, label: toolLabelOf(prompts, part.toolName),
            status: "done", durationMs: Date.now() - t0,
            input: prev?.input ?? (m?.input ?? {}),
            output: { result: String(part.output).slice(0, 2000) },
            summary: m?.summary ?? prompts.stageDone.default,
          };
          bus.push({ type: "step", step });
        } else if (part.type === "tool-error") {
          const t0 = stepStart.get(part.toolCallId) ?? Date.now();
          bus.push({
            type: "step",
            step: {
              id: part.toolCallId, name: part.toolName as ToolName, label: toolLabelOf(prompts, part.toolName),
              status: "error", durationMs: Date.now() - t0,
              input: (part.input ?? {}) as Record<string, unknown>,
              output: { error: String(part.error).slice(0, 500) }, summary: prompts.toolErrorSummary,
            },
          });
        } else if (part.type === "text-delta") {
          if (!answerStarted) {
            answerStarted = true;
            answerStartT = Date.now();
            bus.push(emitAnswerStep("running", answerStartT));
            answerStepEmitted = true;
            bus.push({ type: "answer-start" });
          }
          answer += part.text;
          bus.push({ type: "answer-delta", text: part.text });
        } else if (part.type === "finish") {
          totalUsage = part.totalUsage;
        }
      }
    } catch {
      if (!answer) {
        if (!answerStarted) bus.push({ type: "answer-start" });
        answer = prompts.fallback.genFailed;
        bus.push({ type: "answer-delta", text: answer });
      }
    }

    if (!answer) {
      if (!answerStarted) bus.push({ type: "answer-start" });
      answer = registry.size === 0 ? prompts.fallback.noSources : prompts.fallback.genUnavailable;
      bus.push({ type: "answer-delta", text: answer });
    }

    if (answerStepEmitted) bus.push(emitAnswerStep("done", answerStartT, totalUsage));

    const tokens = totalUsage?.totalTokens ?? totalUsage?.outputTokens ?? Math.max(1, Math.round(answer.length / 1.8));
    // 回答本文に実際に出現した出典番号 [n] だけをパネル/引用へ採用する。
    // 1件も引用が無い回答（要約のみ・エラー時など）は従来どおり全件にフォールバック。
    const citedNums = new Set([...answer.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])));
    // 引用文書の図版（画像チャンク）は本文で [n] 参照されにくいので、文書単位で取り込む。
    const filter = citedNums.size > 0 ? registry.withDocumentImages(citedNums) : undefined;
    const sources = registry.toSources(filter);
    bus.push({
      type: "done",
      tokens,
      durationMs: Date.now() - started,
      citationMap: registry.toCitationMap(filter),
      sourceIds: sources.map((s) => s.id),
      sources,
      threadId,
    });
  } finally {
    bus.close();
  }
}

function toolLabelOf(prompts: AgentPrompts, name: string): string {
  if (name === "retrieve") return prompts.toolLabels.retrieve;
  if (name === "fetch_document") return prompts.toolLabels.fetch_document;
  return name;
}

function runningSummaryOf(prompts: AgentPrompts, name: string): string {
  if (name === "retrieve") return prompts.runningSummaries.retrieve;
  if (name === "fetch_document") return prompts.runningSummaries.fetch_document;
  return prompts.runningSummaries.default;
}

export { DEFAULT_MODEL_ID };
