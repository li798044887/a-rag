import { generateText, tool, type LanguageModel, type ToolSet } from "ai";
import { z } from "zod";
import { retrieveChunksStream, fetchDocument, type RetrieveStageEvent } from "@/lib/agent/retrieve-client";
import { resolveImageUrls } from "@/lib/agent/image-urls";
import { CitationRegistry } from "@/lib/agent/citations";
import { StepBus } from "@/lib/agent/step-bus";
import type { AgentEvent, ToolName } from "@/lib/types";
import type { AgentPrompts } from "@/lib/agent/prompts";
import { Semaphore } from "@/lib/agent/semaphore";
import { AGENT_CFG_DEFAULTS } from "@/lib/agent/config";
import { gradeChunks } from "@/lib/agent/grade";

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
  /** ツール execute の同時実行上限。未指定なら既定の並列数。 */
  concurrency?: number;
  /** リランク後の最終件数。未指定なら既定値。 */
  topK?: number;
  /** ベクトル/BM25 検索の候補プール件数。未指定なら既定値。 */
  candidateK?: number;
  /** grade / 再検索クエリ生成に使う安価モデル。未指定なら CRAG を行わない（従来挙動）。 */
  gradeModel?: LanguageModel;
  /** grade のスコア閾値。未指定なら既定値。 */
  gradeThreshold?: number;
  /** 関連不足時の再検索の最大回数。未指定なら 0（再検索しない）。 */
  maxRetrieveRetries?: number;
}

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

export function buildTools({ registry, ownerUserId, meta, bus, attachmentDocIds, prompts, concurrency, topK, candidateK, gradeModel, gradeThreshold, maxRetrieveRetries }: BuildToolsInput): ToolSet {
  const sema = new Semaphore(concurrency ?? AGENT_CFG_DEFAULTS.parallelTools);
  const resolvedTopK = topK ?? AGENT_CFG_DEFAULTS.topK;
  const resolvedCandidateK = candidateK ?? AGENT_CFG_DEFAULTS.candidateK;
  const resolvedGradeThreshold = gradeThreshold ?? AGENT_CFG_DEFAULTS.gradeThreshold;
  const resolvedMaxRetries = maxRetrieveRetries ?? 0;
  return {
    retrieve: tool({
      description: prompts.toolDescriptions.retrieve,
      inputSchema: z.object({
        query: z.string().describe(prompts.retrieveQueryDescribe),
      }),
      execute: ({ query }, { toolCallId }) => sema.run(async () => {
        let q = query;
        let chunks = await retrieveChunksStream({
          query: q, ownerUserId, topK: resolvedTopK, candidateK: resolvedCandidateK,
          documentIds: attachmentDocIds && attachmentDocIds.length ? attachmentDocIds : undefined,
          onStage: (ev) => bus.push(stageToEvent(ev, toolCallId, q, prompts)),
        });

        // gradeModel が指定されたときのみ CRAG（grade→不足なら rewrite して再検索）。
        if (gradeModel) {
          for (let retry = 0; retry <= resolvedMaxRetries; retry++) {
            const grade = await gradeChunks({
              query: q, threshold: resolvedGradeThreshold, model: gradeModel, prompts,
              chunks: chunks.map((c) => ({
                chunkId: c.chunkId, score: c.score, documentTitle: c.documentTitle,
                headingPath: c.headingPath, text: c.expandedText || c.text,
              })),
            });
            bus.push({ type: "step", step: {
              id: `${toolCallId}:grade`, name: "grade", parentId: toolCallId, label: prompts.grade.label,
              status: "done", durationMs: 0, input: {}, output: { kept: grade.keptIds.length, total: grade.total },
              summary: prompts.grade.done(grade.keptIds.length, grade.total),
            } });
            if (!grade.needRetry || retry >= resolvedMaxRetries) break;

            // 再検索クエリを生成（失敗したら再検索を打ち切る）。
            let rewritten = q;
            try {
              const { text } = await generateText({ model: gradeModel, system: prompts.queryRewrite.system, prompt: q });
              rewritten = text.trim() || q;
            } catch {
              break;
            }
            if (rewritten === q) break;
            bus.push({ type: "step", step: {
              id: `${toolCallId}:rewrite-retry-${retry}`, name: "rewrite_query", parentId: toolCallId,
              label: prompts.rewriteLabel, status: "done", durationMs: 0,
              input: { original: q, rewritten }, output: null, summary: prompts.rewriteSummary(rewritten),
            } });
            q = rewritten;
            chunks = await retrieveChunksStream({
              query: q, rewritten: q, ownerUserId, topK: resolvedTopK, candidateK: resolvedCandidateK,
              documentIds: attachmentDocIds && attachmentDocIds.length ? attachmentDocIds : undefined,
              onStage: (ev) => bus.push(stageToEvent(ev, toolCallId, q, prompts)),
            });
          }
        }

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
        meta.set(toolCallId, { name: "retrieve", input: { query: q },
          summary: prompts.retrieveMetaSummary(q, chunks.length) });
        return lines.length ? lines.join("\n\n") : prompts.fallback.retrieveNoHits;
      }),
    }),
    fetch_document: tool({
      description: prompts.toolDescriptions.fetch_document,
      inputSchema: z.object({
        ref: z.number().int().describe(prompts.fetchRefDescribe),
      }),
      execute: ({ ref }, { toolCallId }) => sema.run(async () => {
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
      }),
    }),
  };
}
