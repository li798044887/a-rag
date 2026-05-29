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
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`retrieve failed: ${res.status} ${body}`);
  }
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

export interface FetchedDocChunk {
  chunkId: string;
  ordinal: number;
  headingPath: string;
  pageStart: number;
  pageEnd: number;
  blockType: string;
  text: string;
}

export interface FetchedDocument {
  documentId: string;
  documentTitle: string;
  chunks: FetchedDocChunk[];
}

export async function fetchDocument(input: {
  documentId: string;
  ownerUserId: string;
  aroundChunkId?: string;
}): Promise<FetchedDocument> {
  const res = await ragFetch(`/documents/${encodeURIComponent(input.documentId)}/chunks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      owner_user_id: input.ownerUserId,
      around_chunk_id: input.aroundChunkId ?? null,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`fetchDocument failed: ${res.status} ${body}`);
  }
  const data = (await res.json()) as {
    document_id: string; document_title: string; chunks: Array<Record<string, unknown>>;
  };
  return {
    documentId: data.document_id,
    documentTitle: data.document_title,
    chunks: data.chunks.map((c) => ({
      chunkId: c.chunk_id as string,
      ordinal: c.ordinal as number,
      headingPath: c.heading_path as string,
      pageStart: c.page_start as number,
      pageEnd: c.page_end as number,
      blockType: c.block_type as string,
      text: c.text as string,
    })),
  };
}
