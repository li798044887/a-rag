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

export interface RunInput {
  query: string;
  ownerUserId: string;
  threadId: string;
  history?: ModelMessage[];
  attachments?: string[];
  attachmentDocIds?: string[];
  modelId?: string;
}

/** 添付ありターンでは、添付ファイルが知識ベースへ取り込み済みで retrieve で検索できる旨を
 *  明示し、必ず retrieve を使うよう指示する。これがないとモデルは「ファイルを直接読めない」と
 *  誤解して retrieve を呼ばずに拒否する。 */
export function buildUserContent(query: string, attachments: string[], attachmentDocIds: string[]): string {
  if (attachmentDocIds.length && attachments.length) {
    return (
      `ユーザーは次のファイルを添付しました（既に知識ベースへ取り込み済み）: ${attachments.join("、")}。\n` +
      `これらのファイルの内容は retrieve ツールで検索できます。必ず retrieve を使ってファイルの内容を調べてから回答してください。` +
      `「ファイルを直接読めない」などと答えてはいけません。\n\n` +
      `質問: ${query}`
    );
  }
  return query;
}

const SYSTEM =
  "あなたは社内ナレッジ検索アシスタントです。必要に応じて retrieve / fetch_document ツールを使い、" +
  "会話の文脈を踏まえて自己完結した検索クエリを組み立ててください。" +
  "回答は提供された一次資料のみに基づき日本語で簡潔に行い、重要な事実には必ずツール結果に付いた [1] [2] の出典番号を付け、" +
  "Markdown の見出し(**太字**)と箇条書き(-)で構造化してください。資料に無いことは推測しないでください。";

const MAX_STEPS = 6;

export async function* runAgent(input: RunInput): AsyncGenerator<AgentEvent> {
  const bus = new StepBus();
  // pump は drain と並行に走らせる（await しない）。完了時に必ず bus.close()。
  void pump(input, bus);
  for await (const ev of bus) yield ev;
}

async function pump(
  { query, ownerUserId, threadId, history, modelId, attachments, attachmentDocIds }: RunInput,
  bus: StepBus,
): Promise<void> {
  // pump の本体は何が throw しても必ず bus.close() する。これを欠くと runAgent の
  // drain が永久にハングする（pump は fire-and-forget なので reject も握り潰される）。
  try {
    const started = Date.now();
    const modelLabel = modelId ?? DEFAULT_MODEL_ID;
    const resolution = resolveModels(modelId);

    // キー未設定: 検索も生成もできないため理由を返して終了（finally で close）。
    if (!resolution.ok) {
      bus.push({ type: "answer-start" });
      bus.push({ type: "answer-delta", text: resolution.reason });
      bus.push({ type: "done", tokens: 0, durationMs: Date.now() - started,
                citationMap: {}, sourceIds: [], sources: [], threadId });
      return;
    }

    const registry = new CitationRegistry();
    const meta = new Map<string, ToolCallMeta>();
    const tools = buildTools({ registry, ownerUserId, meta, bus, attachmentDocIds });

    const userContent = buildUserContent(query, attachments ?? [], attachmentDocIds ?? []);
    const messages: ModelMessage[] = [...(history ?? []), { role: "user", content: userContent }];

    const result = streamText({
      model: resolution.models.chat,
      system: SYSTEM,
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
        id: "answer", name: "answer" as ToolName, label: "回答生成", status,
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
        summary: status === "done" ? "回答を生成" : "回答を生成中…",
      },
    });

    try {
      for await (const part of result.fullStream) {
        if (part.type === "tool-call") {
          // retrieve の直前に rewrite_query をトップレベル兄弟として出す（モデルが送ったクエリの可視化）。
          if (part.toolName === "retrieve") {
            const rewritten = (part.input as { query?: string } | undefined)?.query ?? query;
            bus.push({ type: "step", step: {
              id: `${part.toolCallId}:rewrite`, name: "rewrite_query", label: "クエリ正規化",
              status: "done", durationMs: 0,
              input: { original: query, rewritten },
              output: null, summary: `「${rewritten}」に書き換え`,
            } });
          }
          stepStart.set(part.toolCallId, Date.now());
          const step: ToolCall = {
            id: part.toolCallId, name: part.toolName as ToolName, label: toolLabel(part.toolName),
            status: "running", durationMs: 0,
            input: (part.input ?? {}) as Record<string, unknown>, output: null,
            summary: runningSummary(part.toolName),
          };
          stepById.set(part.toolCallId, step);
          bus.push({ type: "step", step });
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
          bus.push({ type: "step", step });
        } else if (part.type === "tool-error") {
          const t0 = stepStart.get(part.toolCallId) ?? Date.now();
          bus.push({
            type: "step",
            step: {
              id: part.toolCallId, name: part.toolName as ToolName, label: toolLabel(part.toolName),
              status: "error", durationMs: Date.now() - t0,
              input: (part.input ?? {}) as Record<string, unknown>,
              output: { error: String(part.error).slice(0, 500) }, summary: "ツール実行に失敗",
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
        answer = "回答の生成に失敗しました。時間をおいて再度お試しください。";
        bus.push({ type: "answer-delta", text: answer });
      }
    }

    if (!answer) {
      if (!answerStarted) bus.push({ type: "answer-start" });
      answer = registry.size === 0
        ? "該当する資料が見つかりませんでした。別の言い回しで質問するか、関連ファイルをアップロードしてください。"
        : "回答を生成できませんでした。時間をおいて再度お試しください。";
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
