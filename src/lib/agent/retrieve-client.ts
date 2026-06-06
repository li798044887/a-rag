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

function mapChunk(c: Record<string, unknown>): RetrievedChunk {
  return {
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
  };
}

export async function retrieveChunks(input: {
  query: string;
  rewritten?: string;
  ownerUserId: string;
  topK?: number;
  candidateK?: number;
  documentIds?: string[];
  multiHop?: boolean;
}): Promise<RetrievedChunk[]> {
  const res = await ragFetch("/retrieve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: input.query,
      rewritten: input.rewritten ?? null,
      owner_user_id: input.ownerUserId,
      top_k: input.topK ?? 6,
      candidate_k: input.candidateK ?? undefined,
      document_ids: input.documentIds ?? null,
      multi_hop: input.multiHop ?? undefined,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`retrieve failed: ${res.status} ${body}`);
  }
  const data = (await res.json()) as { chunks: Array<Record<string, unknown>> };
  return data.chunks.map(mapChunk);
}

export interface RetrieveStageEvent {
  stage: string;
  status: "start" | "done" | "error";
  /** 多ホップ検索の hop 番号。hop-1 には付かず、hop-2 以降のみ付与される。 */
  hop?: number;
  /** hop-2 以降で実際に検索した PRF 展開クエリ。元クエリと異なることを UI で示すため。 */
  query?: string;
  ms?: number;
  count?: number;
  message?: string;
  model?: string;
  dims?: number;
  top_n?: number;
  hits?: { title: string; heading: string; score: number }[];
  selected?: { id: string; score: number; title: string }[];
  expanded?: {
    id: string;
    title: string;
    heading: string;
    score: number;
    page: number;
    blockType: string;
    expandedChars: number;
    preview: string;
  }[];
}

/** /retrieve/stream を読み、段階イベントを onStage に流し、最終 result の chunks を返す。 */
export async function retrieveChunksStream(input: {
  query: string;
  rewritten?: string;
  ownerUserId: string;
  topK?: number;
  candidateK?: number;
  documentIds?: string[];
  multiHop?: boolean;
  onStage: (ev: RetrieveStageEvent) => void;
}): Promise<RetrievedChunk[]> {
  const res = await ragFetch("/retrieve/stream", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: input.query,
      rewritten: input.rewritten ?? null,
      owner_user_id: input.ownerUserId,
      top_k: input.topK ?? 6,
      candidate_k: input.candidateK ?? undefined,
      document_ids: input.documentIds ?? null,
      multi_hop: input.multiHop ?? undefined,
    }),
  });
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    throw new Error(`retrieve stream failed: ${res.status} ${body}`);
  }

  let chunks: RetrievedChunk[] = [];
  const handleLine = (raw: string) => {
    const s = raw.trim();
    if (!s) return;
    const ev = JSON.parse(s) as Record<string, unknown>;
    if (ev.stage === "result") {
      chunks = (ev.chunks as Array<Record<string, unknown>>).map(mapChunk);
    } else {
      input.onStage(ev as unknown as RetrieveStageEvent);
    }
  };

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) handleLine(line);
  }
  if (buffer.trim()) handleLine(buffer);
  return chunks;
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
