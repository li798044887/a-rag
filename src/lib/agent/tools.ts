import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { retrieveChunksStream, fetchDocument, type RetrieveStageEvent } from "@/lib/agent/retrieve-client";
import { resolveImageUrls } from "@/lib/agent/image-urls";
import { CitationRegistry } from "@/lib/agent/citations";
import { StepBus } from "@/lib/agent/step-bus";
import type { AgentEvent, ToolName } from "@/lib/types";

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
}

const RETRIEVE_TOP_K = 6;

const STAGE_LABEL: Record<string, string> = {
  embed: "クエリ埋め込み",
  vector_search: "ベクトル検索",
  bm25_search: "キーワード検索",
  rerank: "リランキング",
  expand: "近傍拡張",
};

function stageRunningSummary(stage: string): string {
  switch (stage) {
    case "embed": return "クエリを埋め込み中…";
    case "vector_search": return "密ベクトル検索中…";
    case "bm25_search": return "キーワード検索中…";
    case "rerank": return "再順位付け中…";
    case "expand": return "近傍チャンクを取得中…";
    default: return "実行中…";
  }
}

function stageDoneSummary(stage: string, count?: number): string {
  switch (stage) {
    case "embed": return "クエリを埋め込み";
    case "vector_search": return `密ベクトル ${count ?? 0} 件`;
    case "bm25_search": return `BM25 ${count ?? 0} 件`;
    case "rerank": return `${count ?? 0} 件に再順位付け`;
    case "expand": return "近傍拡張";
    default: return "完了";
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
function stageToEvent(ev: RetrieveStageEvent, parentId: string, query: string): AgentEvent {
  // start と done は同一 id を共有し、reducer が id マージで running→done に更新する（衝突ではなく意図）。
  const base = {
    id: `${parentId}:${ev.stage}`,
    name: ev.stage as ToolName,
    parentId,
    label: STAGE_LABEL[ev.stage] ?? ev.stage,
  };
  if (ev.status === "start") {
    return { type: "step", step: { ...base, status: "running", durationMs: 0, input: {}, output: null, summary: stageRunningSummary(ev.stage) } };
  }
  if (ev.status === "error") {
    return { type: "step", step: { ...base, status: "error", durationMs: ev.ms ?? 0, input: {}, output: { error: ev.message ?? "失敗" }, summary: "段階に失敗" } };
  }
  return { type: "step", step: { ...base, status: "done", durationMs: ev.ms ?? 0, input: stageInput(ev, query), output: stageOutput(ev), summary: stageDoneSummary(ev.stage, ev.count) } };
}

export function buildTools({ registry, ownerUserId, meta, bus }: BuildToolsInput): ToolSet {
  return {
    retrieve: tool({
      description:
        "社内ナレッジから関連箇所を検索する。ユーザーの質問に答えるために必要な事実を集めるとき、" +
        "また会話の文脈を踏まえた具体的なクエリで何度でも呼べる。" +
        "各ヒットの先頭に付く [n] が出典番号で、深掘りしたいときはその番号を fetch_document に渡す。",
      inputSchema: z.object({
        query: z.string().describe("検索クエリ（会話文脈を解決した自己完結な日本語）"),
      }),
      execute: async ({ query }, { toolCallId }) => {
        const chunks = await retrieveChunksStream({
          query, ownerUserId, topK: RETRIEVE_TOP_K,
          onStage: (ev) => bus.push(stageToEvent(ev, toolCallId, query)),
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
          summary: `「${query}」→ ${chunks.length} 件` });
        return lines.length ? lines.join("\n\n") : "該当する資料は見つかりませんでした。";
      },
    }),
    fetch_document: tool({
      description:
        "retrieve でヒットした文書の周辺本文を取得して深掘りする。" +
        "retrieve 結果に付いた出典番号 [n] の数値だけを ref に渡す（UUID は不要）。",
      inputSchema: z.object({
        ref: z.number().int().describe("retrieve 結果の出典番号 [n] の数値（例: 1）"),
      }),
      execute: async ({ ref }, { toolCallId }) => {
        const hit = registry.resolve(ref);
        if (!hit) {
          meta.set(toolCallId, { name: "fetch_document", input: { ref },
            summary: `出典 [${ref}] は未取得` });
          return `出典 [${ref}] はまだ取得していません。先に retrieve を実行し、結果に付いた番号を指定してください。`;
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
          summary: `${doc.documentTitle} → ${doc.chunks.length} 段` });
        return lines.length ? lines.join("\n\n") : "文書の本文が取得できませんでした。";
      },
    }),
  };
}
