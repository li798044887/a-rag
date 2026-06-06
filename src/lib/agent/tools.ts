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
  /** 決定論的テキスト PRF 多ホップ検索を有効にするか。未指定なら無効（従来挙動）。 */
  multiHop?: boolean;
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
    case "expand": return { count: ev.count ?? 0, expanded: ev.expanded ?? [] };
    default: return ev.count != null ? { count: ev.count } : null;
  }
}

function attemptLabel(label: string, attempt: number): string {
  return attempt > 0 ? `${label} #${attempt + 1}` : label;
}

/** retrieve の段階イベントを parentId 付きサブステップへ変換して bus に流す。 */
function stageToEvent(ev: RetrieveStageEvent, parentId: string, query: string, prompts: AgentPrompts, attempt: number, showAttemptLabel = true): AgentEvent {
  // start と done は同一 id を共有し、reducer が id マージで running→done に更新する（衝突ではなく意図）。
  // ただし CRAG の再検索では同じ stage が複数回流れるため、検索試行ごとに id を分ける。
  // 多ホップでは hop-2 以降の同名 stage が hop-1 と衝突するため、hop で id を分け、ラベルに hop を付す。
  const stageKey = ev.stage as keyof AgentPrompts["stageLabels"];
  const hop = ev.hop ?? 1;
  const hopIdSuffix = hop > 1 ? `:hop${hop}` : "";
  const baseLabel = prompts.stageLabels[stageKey] ?? ev.stage;
  const labelWithHop = hop > 1 ? `${baseLabel}${prompts.stageHopSuffix(hop)}` : baseLabel;
  const base = {
    id: `${parentId}:retrieve-${attempt}:${ev.stage}${hopIdSuffix}`,
    name: ev.stage as ToolName,
    parentId,
    label: showAttemptLabel ? attemptLabel(labelWithHop, attempt) : labelWithHop,
  };
  if (ev.status === "start") {
    return { type: "step", step: { ...base, status: "running", durationMs: 0, input: {}, output: null, summary: prompts.stageRunning[stageKey] ?? prompts.stageDefaultRunning } };
  }
  if (ev.status === "error") {
    return { type: "step", step: { ...base, status: "error", durationMs: ev.ms ?? 0, input: {}, output: { error: ev.message ?? prompts.stageErrorSummary }, summary: prompts.stageErrorSummary } };
  }
  return { type: "step", step: { ...base, status: "done", durationMs: ev.ms ?? 0, input: stageInput(ev, query), output: stageOutput(ev), summary: stageDoneSummaryOf(prompts, ev.stage, ev.count) } };
}

export function buildTools({ registry, ownerUserId, meta, bus, attachmentDocIds, prompts, concurrency, topK, candidateK, gradeModel, gradeThreshold, maxRetrieveRetries, multiHop }: BuildToolsInput): ToolSet {
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
        const originalQuery = query;
        let q = query;
        let activeParentId = toolCallId;
        let activeParentStarted: number | null = null;
        const runRetrieveAttempt = (attempt: number, parentId: string, showAttemptLabel = true) => retrieveChunksStream({
          query: q, rewritten: attempt > 0 ? q : undefined, ownerUserId, topK: resolvedTopK, candidateK: resolvedCandidateK,
          documentIds: attachmentDocIds && attachmentDocIds.length ? attachmentDocIds : undefined,
          multiHop: multiHop ? true : undefined,
          onStage: (ev) => bus.push(stageToEvent(ev, parentId, q, prompts, attempt, showAttemptLabel)),
        });
        let chunks = await runRetrieveAttempt(0, activeParentId);
        let displayCount = chunks.length;

        // gradeModel が指定されたときのみ CRAG（grade→不足なら rewrite して再検索）。
        // 設計上、grade は「再検索の要否」と関連度サマリの算出のみに使い、取得チャンクの
        // 間引きはしない（keptIds でのフィルタはしない）。根拠の担保は生成後の verify と、
        // 回答本文に実際に出た [n] だけを出典パネルへ採用する引用抽出が担う多層防御とし、
        // ここでの早すぎる間引きで本来有用な文脈を落とす取りこぼしを避ける（recall 優先）。
        if (gradeModel) {
          for (let retry = 0; retry <= resolvedMaxRetries; retry++) {
            const grade = await gradeChunks({
              query: q, threshold: resolvedGradeThreshold, model: gradeModel, prompts,
              chunks: chunks.map((c) => ({
                chunkId: c.chunkId, score: c.score, documentTitle: c.documentTitle,
                headingPath: c.headingPath, text: c.expandedText || c.text,
              })),
            });
            const kept = new Set(grade.keptIds);
            displayCount = grade.keptIds.length;
            const gradeCandidates = chunks.map((c) => ({
              chunkId: c.chunkId,
              title: c.documentTitle,
              heading: c.headingPath,
              score: c.score,
              kept: kept.has(c.chunkId),
            }));
            bus.push({ type: "step", step: {
              id: `${activeParentId}:grade-${retry}`, name: "grade", parentId: activeParentId,
              label: activeParentId === toolCallId ? attemptLabel(prompts.grade.label, retry) : prompts.grade.label,
              status: "done", durationMs: 0, input: {},
              output: { kept: grade.keptIds.length, total: grade.total, needRetry: grade.needRetry, candidates: gradeCandidates },
              summary: prompts.grade.done(grade.keptIds.length, grade.total),
            } });
            if (activeParentId !== toolCallId && activeParentStarted != null) {
              bus.push({ type: "step", step: {
                id: activeParentId, name: "retrieve", label: prompts.grade.retryLabel,
                status: "done", durationMs: Date.now() - activeParentStarted,
                input: { query: q, retryReason: prompts.grade.retry },
                output: null,
                summary: `${prompts.grade.retry}: ${prompts.retrieveMetaSummary(q, displayCount)}`,
              } });
              activeParentStarted = null;
            }
            if (!grade.needRetry || retry >= resolvedMaxRetries) break;

            // 再検索クエリを生成（失敗したら再検索を打ち切る）。
            let rewritten = q;
            try {
              const { text } = await generateText({ model: gradeModel, system: prompts.queryRewrite.system, prompt: q });
              // 冗長なモデル出力が検索クエリとして渡るのを防ぐため長さを上限で切る。
              rewritten = text.trim().slice(0, 200) || q;
            } catch {
              break;
            }
            if (rewritten === q) break;
            bus.push({ type: "step", step: {
              id: `${toolCallId}:rewrite-retry-${retry}`, name: "rewrite_query",
              label: prompts.rewriteLabel, status: "done", durationMs: 0,
              input: { original: q, rewritten }, output: null, summary: prompts.rewriteSummary(rewritten),
            } });
            q = rewritten;
            activeParentId = `${toolCallId}:retry-${retry + 1}:retrieve`;
            activeParentStarted = Date.now();
            bus.push({ type: "step", step: {
              id: activeParentId, name: "retrieve", label: prompts.grade.retryLabel,
              status: "running", durationMs: 0,
              input: { query: q, retryReason: prompts.grade.retry },
              output: null,
              summary: prompts.grade.retry,
            } });
            chunks = await runRetrieveAttempt(retry + 1, activeParentId, false);
            displayCount = chunks.length;
          }
        }

        const lines = chunks.map((c) => {
          const body = resolveImageUrls(c.expandedText || c.text, c.documentId);
          const n = registry.register({
            documentId: c.documentId, documentTitle: c.documentTitle, chunkId: c.chunkId,
            // LLM に渡した本文と右パネルの引用箇所を一致させる。
            // 表チャンクでも expandedText を優先することで、表だけでなく周辺の説明文も引用表示できる。
            headingPath: c.headingPath,
            snippet: body,
            blockType: c.blockType, page: c.pageStart, score: c.score,
          });
          // LLM 向け本文も画像URLを絶対化する。回答にインライン表示された画像が
          // そのまま描画可能（相対パスのままだと描画されない／壊れる）になるため。
          return `[${n}] ${c.documentTitle} — ${c.headingPath}\n${body}`;
        });
        meta.set(toolCallId, { name: "retrieve", input: { query: originalQuery },
          summary: prompts.retrieveMetaSummary(originalQuery, displayCount) });
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
