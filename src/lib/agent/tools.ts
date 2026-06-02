import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { retrieveChunksStream, fetchDocument, type RetrieveStageEvent } from "@/lib/agent/retrieve-client";
import { resolveImageUrls } from "@/lib/agent/image-urls";
import { CitationRegistry } from "@/lib/agent/citations";
import { StepBus } from "@/lib/agent/step-bus";
import type { AgentEvent, ToolName } from "@/lib/types";
import type { AgentPrompts } from "@/lib/agent/prompts";

/** toolCallId -> UI 用メタ。fullStream の tool-call/tool-result に対応付ける。 */
export interface ToolCallMeta {
  name: "retrieve" | "fetch_document";
  input: Record<string, unknown>;
  summary: string;
}

export interface BuildToolsInput {
  registry: CitationRegistry;
  ownerUserId: string;
  meta: Map<string, ToolCallMeta>;
  bus: StepBus;
  /** 添付ありターンでは retrieve をこの文書群に排他スコープする。空/未指定なら全体検索。 */
  attachmentDocIds?: string[];
  prompts: AgentPrompts;
}

const RETRIEVE_TOP_K = 6;
const RETRIEVE_CANDIDATE_K = 10;

/** done 時の段階別 summary を prompts から組み立てる。 */
function stageDoneSummaryOf(prompts: AgentPrompts, stage: string, count?: number): string {
  const c = count ?? 0;
  switch (stage) {
    case "embed": return prompts.stageDone.embed;
    case "vector_search": return prompts.stageDone.vector_search(c);
    case "bm25_search": return prompts.stageDone.bm25_search(c);
    case "rerank": return prompts.stageDone.rerank(c);
    case "expand": return prompts.stageDone.expand;
    default: return prompts.stageDone.default;
  }
}

/** done 時の段階別 input を組み立てる。 */
function stageInput(ev: RetrieveStageEvent, query: string): Record<string, unknown> {
  switch (ev.stage) {
    case "embed": return ev.model ? { model: ev.model } : {};
    case "vector_search": return { mode: "dense", query };
    case "bm25_search": return { mode: "sparse", query };
    case "rerank": return { model: ev.model ?? null, top_n: ev.top_n ?? null };
    default: return {};
  }
}

/** done 時の段階別 output を組み立てる。 */
function stageOutput(ev: RetrieveStageEvent): Record<string, unknown> | null {
  switch (ev.stage) {
    case "embed": return ev.dims != null ? { dims: ev.dims } : null;
    case "vector_search":
    case "bm25_search": return { count: ev.count ?? 0, hits: ev.hits ?? [] };
    case "rerank": return { count: ev.count ?? 0, selected: ev.selected ?? [] };
    case "expand": return { count: ev.count ?? 0 };
    default: return ev.count != null ? { count: ev.count } : null;
  }
}

/** retrieve の段階イベントを parentId 付きサブステップへ変換して bus に流す。 */
function stageToEvent(ev: RetrieveStageEvent, parentId: string, query: string, prompts: AgentPrompts): AgentEvent {
  // start と done は同一 id を共有し、reducer が id マージで running→done に更新する（衝突ではなく意図）。
  const stageKey = ev.stage as keyof AgentPrompts["stageLabels"];
  const base = {
    id: `${parentId}:${ev.stage}`,
    name: ev.stage as ToolName,
    parentId,
    label: prompts.stageLabels[stageKey] ?? ev.stage,
  };
  if (ev.status === "start") {
    return { type: "step", step: { ...base, status: "running", durationMs: 0, input: {}, output: null, summary: prompts.stageRunning[stageKey] ?? prompts.stageDefaultRunning } };
  }
  if (ev.status === "error") {
    return { type: "step", step: { ...base, status: "error", durationMs: ev.ms ?? 0, input: {}, output: { error: ev.message ?? prompts.stageErrorSummary }, summary: prompts.stageErrorSummary } };
  }
  return { type: "step", step: { ...base, status: "done", durationMs: ev.ms ?? 0, input: stageInput(ev, query), output: stageOutput(ev), summary: stageDoneSummaryOf(prompts, ev.stage, ev.count) } };
}

export function buildTools({ registry, ownerUserId, meta, bus, attachmentDocIds, prompts }: BuildToolsInput): ToolSet {
  return {
    retrieve: tool({
      description: prompts.toolDescriptions.retrieve,
      inputSchema: z.object({
        query: z.string().describe(prompts.retrieveQueryDescribe),
      }),
      execute: async ({ query }, { toolCallId }) => {
        const chunks = await retrieveChunksStream({
          query, ownerUserId, topK: RETRIEVE_TOP_K, candidateK: RETRIEVE_CANDIDATE_K,
          documentIds: attachmentDocIds && attachmentDocIds.length ? attachmentDocIds : undefined,
          onStage: (ev) => bus.push(stageToEvent(ev, toolCallId, query, prompts)),
        });
        const lines = chunks.map((c) => {
          const n = registry.register({
            documentId: c.documentId, documentTitle: c.documentTitle, chunkId: c.chunkId,
            // 表は HTML をそのまま描画するため text を維持。文章は前後文脈込みの
            // expandedText を優先する（見出しだけのチャンクが引用箇所になる問題への対策）。
            headingPath: c.headingPath,
            snippet: resolveImageUrls(
              c.blockType === "table" ? c.text : (c.expandedText || c.text),
              c.documentId,
            ),
            blockType: c.blockType, page: c.pageStart, score: c.score,
          });
          // LLM 向け本文も画像URLを絶対化する。回答にインライン表示された画像が
          // そのまま描画可能（相対パスのままだと描画されない／壊れる）になるため。
          const body = resolveImageUrls(c.expandedText || c.text, c.documentId);
          return `[${n}] ${c.documentTitle} — ${c.headingPath}\n${body}`;
        });
        meta.set(toolCallId, { name: "retrieve", input: { query },
          summary: prompts.retrieveMetaSummary(query, chunks.length) });
        return lines.length ? lines.join("\n\n") : prompts.fallback.retrieveNoHits;
      },
    }),
    fetch_document: tool({
      description: prompts.toolDescriptions.fetch_document,
      inputSchema: z.object({
        ref: z.number().int().describe(prompts.fetchRefDescribe),
      }),
      execute: async ({ ref }, { toolCallId }) => {
        const hit = registry.resolve(ref);
        if (!hit) {
          meta.set(toolCallId, { name: "fetch_document", input: { ref },
            summary: prompts.fetchUnresolvedSummary(ref) });
          return prompts.fallback.fetchUnresolved(ref);
        }
        const doc = await fetchDocument({
          documentId: hit.documentId, ownerUserId, aroundChunkId: hit.chunkId });
        const lines = doc.chunks.map((c) => {
          const n = registry.register({
            documentId: doc.documentId, documentTitle: doc.documentTitle, chunkId: c.chunkId,
            headingPath: c.headingPath, snippet: resolveImageUrls(c.text, doc.documentId),
            blockType: c.blockType, page: c.pageStart,
          });
          // LLM 向け本文も画像URLを絶対化（インライン表示の画像を描画可能にする）。
          const body = resolveImageUrls(c.text, doc.documentId);
          return `[${n}] ${doc.documentTitle} — ${c.headingPath}\n${body}`;
        });
        meta.set(toolCallId, { name: "fetch_document",
          input: { ref, document: doc.documentTitle },
          summary: prompts.fetchMetaSummary(doc.documentTitle, doc.chunks.length) });
        return lines.length ? lines.join("\n\n") : prompts.fallback.fetchEmpty;
      },
    }),
  };
}
