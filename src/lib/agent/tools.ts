import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { retrieveChunks, fetchDocument } from "@/lib/agent/retrieve-client";
import { CitationRegistry } from "@/lib/agent/citations";

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
}

const RETRIEVE_TOP_K = 6;

export function buildTools({ registry, ownerUserId, meta }: BuildToolsInput): ToolSet {
  return {
    retrieve: tool({
      description:
        "社内ナレッジから関連箇所を検索する。ユーザーの質問に答えるために必要な事実を集めるとき、" +
        "また会話の文脈を踏まえた具体的なクエリで何度でも呼べる。" +
        "各ヒットには doc_id / chunk_id が付くので、深掘りしたいときは doc_id を fetch_document に渡す。",
      inputSchema: z.object({
        query: z.string().describe("検索クエリ（会話文脈を解決した自己完結な日本語）"),
      }),
      execute: async ({ query }, { toolCallId }) => {
        const chunks = await retrieveChunks({ query, ownerUserId, topK: RETRIEVE_TOP_K });
        const lines = chunks.map((c) => {
          const n = registry.register({
            documentId: c.documentId, documentTitle: c.documentTitle, chunkId: c.chunkId,
            headingPath: c.headingPath, snippet: c.text,
          });
          return `[${n}] ${c.documentTitle} — ${c.headingPath} (doc_id=${c.documentId} chunk_id=${c.chunkId})\n${c.expandedText || c.text}`;
        });
        meta.set(toolCallId, { name: "retrieve", input: { query },
          summary: `「${query}」→ ${chunks.length} 件` });
        return lines.length ? lines.join("\n\n") : "該当する資料は見つかりませんでした。";
      },
    }),
    fetch_document: tool({
      description:
        "特定の文書の全文（または指定チャンク周辺）を取得して深掘りする。" +
        "retrieve 結果に表示された doc_id をそのまま document_id に渡す（引用番号 [n] ではない）。",
      inputSchema: z.object({
        document_id: z.string().describe("retrieve 結果の doc_id（UUID）。引用番号 [n] ではない"),
        around_chunk_id: z.string().optional().describe("retrieve 結果の chunk_id。その周辺だけ欲しいときに指定"),
      }),
      execute: async ({ document_id, around_chunk_id }, { toolCallId }) => {
        const doc = await fetchDocument({ documentId: document_id, ownerUserId, aroundChunkId: around_chunk_id });
        const lines = doc.chunks.map((c) => {
          const n = registry.register({
            documentId: doc.documentId, documentTitle: doc.documentTitle, chunkId: c.chunkId,
            headingPath: c.headingPath, snippet: c.text,
          });
          return `[${n}] ${doc.documentTitle} — ${c.headingPath}\n${c.text}`;
        });
        meta.set(toolCallId, { name: "fetch_document",
          input: { document_id, ...(around_chunk_id ? { around_chunk_id } : {}) },
          summary: `${doc.documentTitle} → ${doc.chunks.length} 段` });
        return lines.length ? lines.join("\n\n") : "文書の本文が取得できませんでした。";
      },
    }),
  };
}
