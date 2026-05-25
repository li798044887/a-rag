import { ragFetch } from "@/lib/rag-client";

export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  headingPath: string;
  pageStart: number;
  pageEnd: number;
  blockType: string;
  text: string;
  expandedText: string;
  score: number;
}

export async function retrieveChunks(input: {
  query: string;
  rewritten?: string;
  ownerUserId: string;
  topK?: number;
}): Promise<RetrievedChunk[]> {
  const res = await ragFetch("/retrieve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: input.query,
      rewritten: input.rewritten ?? null,
      owner_user_id: input.ownerUserId,
      top_k: input.topK ?? 6,
    }),
  });
  if (!res.ok) throw new Error(`retrieve failed: ${res.status}`);
  const data = (await res.json()) as { chunks: Array<Record<string, unknown>> };
  return data.chunks.map((c) => ({
    chunkId: c.chunk_id as string,
    documentId: c.document_id as string,
    documentTitle: c.document_title as string,
    headingPath: c.heading_path as string,
    pageStart: c.page_start as number,
    pageEnd: c.page_end as number,
    blockType: c.block_type as string,
    text: c.text as string,
    expandedText: c.expanded_text as string,
    score: c.score as number,
  }));
}
