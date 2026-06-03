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
import type { AgentCfg, AgentEvent, ToolCall, ToolName } from "@/lib/types";
import { getAgentPrompts, type AgentPrompts } from "@/lib/agent/prompts";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/config";
import { AGENT_CFG_DEFAULTS, buildSystemPrompt } from "@/lib/agent/config";
import { verifyAnswer } from "@/lib/agent/verify";

export interface RunInput {
  query: string;
  ownerUserId: string;
  threadId: string;
  history?: ModelMessage[];
  attachments?: string[];
  attachmentDocIds?: string[];
  modelId?: string;
  locale?: Locale;
  agentCfg?: AgentCfg;
}


export async function* runAgent(input: RunInput): AsyncGenerator<AgentEvent> {
  const bus = new StepBus();
  // pump は drain と並行に走らせる（await しない）。完了時に必ず bus.close()。
  void pump(input, bus);
  for await (const ev of bus) yield ev;
}

async function pump(
  { query, ownerUserId, threadId, history, modelId, attachments, attachmentDocIds, locale, agentCfg }: RunInput,
  bus: StepBus,
): Promise<void> {
  // pump の本体は何が throw しても必ず bus.close() する。これを欠くと runAgent の
  // drain が永久にハングする（pump は fire-and-forget なので reject も握り潰される）。
  try {
    const started = Date.now();
    const cfg = agentCfg ?? AGENT_CFG_DEFAULTS;
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
    const tools = buildTools({
      registry, ownerUserId, meta, bus, attachmentDocIds, prompts,
      concurrency: cfg.parallelTools, topK: cfg.topK, candidateK: cfg.candidateK,
      gradeModel: resolution.models.rewrite, gradeThreshold: cfg.gradeThreshold,
      maxRetrieveRetries: cfg.maxRetrieveRetries,
    });

    const userContent = prompts.buildUserContent(query, attachments ?? [], attachmentDocIds ?? []);
    const messages: ModelMessage[] = [...(history ?? []), { role: "user", content: userContent }];

    const result = streamText({
      model: resolution.models.chat,
      system: buildSystemPrompt(cfg, locale ?? DEFAULT_LOCALE),
      messages,
      tools,
      stopWhen: stepCountIs(cfg.maxSteps),
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
            // バッファ化: answer-start / answer-delta はここでは出さず、検証後に確定ストリームする。
          }
          answer += part.text;
        } else if (part.type === "finish") {
          totalUsage = part.totalUsage;
        } else if (part.type === "error") {
          if (!answer) {
            answer = generationFailureText(prompts, part.error);
          }
          break;
        }
      }
    } catch (err) {
      if (!answer) {
        answer = generationFailureText(prompts, err);
      }
    }

    if (!answer) {
      answer = registry.size === 0 ? prompts.fallback.noSources : prompts.fallback.genUnavailable;
    }

    if (answerStepEmitted) bus.push(emitAnswerStep("done", answerStartT, totalUsage));

    // 根拠検証（バッファ生成→検証→確定）。実際に生成が行われ、出典がある場合のみ。
    // 失敗時は verifyAnswer 内部で素通しするため answer は必ず確定ストリームされる。
    if (cfg.verify && answerStarted && answer && registry.size > 0) {
      const vStart = Date.now();
      bus.push({ type: "step", step: {
        id: "verify", name: "verify" as ToolName, label: prompts.verify.label,
        status: "running", durationMs: 0, input: {}, output: null, summary: prompts.verify.running,
      } });
      const v = await verifyAnswer({
        query, answer, sources: registry.listSources(),
        model: resolution.models.rewrite, prompts, maxRevisions: cfg.maxRevisions,
      });
      // 検証ステップに未裏付け主張の一覧を載せ、検証内容を展開して確認できるようにする。
      bus.push({ type: "step", step: {
        id: "verify", name: "verify" as ToolName, label: prompts.verify.label,
        status: "done", durationMs: Date.now() - vStart,
        input: {}, output: { unsupported: v.unsupported.length, claims: v.unsupported },
        summary: prompts.verify.done(v.unsupported.length),
      } });
      if (v.revised) {
        // 訂正ステップには訂正前→訂正後を載せ、差分を確認できるようにする。
        bus.push({ type: "step", step: {
          id: "revise", name: "revise" as ToolName, label: prompts.revise.label,
          status: "done", durationMs: 0, input: {}, output: { draft: answer, revised: v.revised },
          summary: prompts.revise.done,
        } });
        answer = v.revised;
      }
    }

    // 確定ストリーム: 検証済み本文をここで初めて送出する。
    bus.push({ type: "answer-start" });
    bus.push({ type: "answer-delta", text: answer });

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

function generationFailureText(prompts: AgentPrompts, error: unknown): string {
  const detail = describeError(error);
  return detail ? prompts.fallback.genFailedWithDetail(detail) : prompts.fallback.genFailed;
}

function describeError(error: unknown): string {
  const parts = collectErrorParts(error);
  const deduped = [...new Set(parts.map(sanitizeErrorDetail).filter(Boolean))];
  return deduped.join(" / ").slice(0, 1000);
}

function collectErrorParts(error: unknown): string[] {
  if (typeof error === "string") return [error];
  if (error instanceof Error) {
    return [
      error.message,
      ...collectNestedErrorParts(error as unknown as Record<string, unknown>),
    ];
  }
  if (error && typeof error === "object") {
    return collectNestedErrorParts(error as Record<string, unknown>);
  }
  return [];
}

function collectNestedErrorParts(error: Record<string, unknown>): string[] {
  const parts: string[] = [];
  if (typeof error.message === "string") parts.push(error.message);
  if (typeof error.reason === "string") parts.push(error.reason);
  if (Array.isArray(error.errors) && error.errors.length) {
    parts.push(...collectErrorParts(error.errors[error.errors.length - 1]));
  }
  if (error.cause) parts.push(...collectErrorParts(error.cause));
  return parts;
}

function sanitizeErrorDetail(detail: string): string {
  return detail
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/sk-[A-Za-z0-9_-]{10,}/g, "sk-[redacted]")
    .trim();
}

export { DEFAULT_MODEL_ID };
