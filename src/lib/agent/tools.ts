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
        "各ヒットの先頭に付く [n] が出典番号で、深掘りしたいときはその番号を fetch_document に渡す。",
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
          return `[${n}] ${c.documentTitle} — ${c.headingPath}\n${c.expandedText || c.text}`;
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
        // [n] をサーバ側で実 ID へ解決する。モデルに UUID を書かせない（誤コピー防止）。
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
            headingPath: c.headingPath, snippet: c.text,
          });
          return `[${n}] ${doc.documentTitle} — ${c.headingPath}\n${c.text}`;
        });
        meta.set(toolCallId, { name: "fetch_document",
          input: { ref, document: doc.documentTitle },
          summary: `${doc.documentTitle} → ${doc.chunks.length} 段` });
        return lines.length ? lines.join("\n\n") : "文書の本文が取得できませんでした。";
      },
    }),
  };
}
