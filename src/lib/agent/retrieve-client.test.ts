import { afterEach, expect, test, vi } from "vitest";
import { retrieveChunks, fetchDocument, retrieveChunksStream, type RetrieveStageEvent } from "@/lib/agent/retrieve-client";

afterEach(() => vi.restoreAllMocks());

test("retrieveChunks posts to rag /retrieve and returns chunks", async () => {
  const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ chunks: [{ chunk_id: "c1", document_id: "d1",
      document_title: "t", heading_path: "H", page_start: 0, page_end: 0,
      block_type: "text", text: "b", expanded_text: "e", score: 0.9 }] }),
      { status: 200 }));
  process.env.RAG_SERVICE_URL = "http://rag:8000";

  const chunks = await retrieveChunks({ query: "q", ownerUserId: "u1", topK: 6 });
  expect(chunks[0].chunkId).toBe("c1");
  const [url, init] = spy.mock.calls[0];
  expect(url).toBe("http://rag:8000/retrieve");
  expect(JSON.parse(init!.body as string).owner_user_id).toBe("u1");
  expect((init!.headers as Record<string, string>)["x-internal-token"]).toBe("dev-internal-token");
});

test("retrieveChunks sends candidate_k when provided", async () => {
  const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ chunks: [] }), { status: 200 }));
  process.env.RAG_SERVICE_URL = "http://rag:8000";

  await retrieveChunks({ query: "q", ownerUserId: "u1", topK: 6, candidateK: 10 });

  const [, init] = spy.mock.calls[0];
  expect(JSON.parse(init!.body as string).candidate_k).toBe(10);
});

test("fetchDocument posts to rag /documents/{id}/chunks and maps chunks", async () => {
  const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ document_id: "d1", document_title: "設計.pdf",
      chunks: [{ chunk_id: "c1", ordinal: 0, heading_path: "認証", page_start: 0,
        page_end: 0, block_type: "text", text: "本文" }] }), { status: 200 }));
  process.env.RAG_SERVICE_URL = "http://rag:8000";

  const doc = await fetchDocument({ documentId: "d1", ownerUserId: "u1", aroundChunkId: "c0" });
  expect(doc.documentTitle).toBe("設計.pdf");
  expect(doc.chunks[0].chunkId).toBe("c1");
  const [url, init] = spy.mock.calls[0];
  expect(url).toBe("http://rag:8000/documents/d1/chunks");
  const body = JSON.parse(init!.body as string);
  expect(body.owner_user_id).toBe("u1");
  expect(body.around_chunk_id).toBe("c0");
});

test("retrieveChunksStream parses NDJSON: forwards stages and returns result chunks", async () => {
  const ndjson =
    '{"stage":"embed","status":"done","ms":1}\n' +
    '{"stage":"vector_search","status":"done","ms":2,"count":3}\n' +
    '{"stage":"result","chunks":[{"chunk_id":"c1","document_id":"d1","document_title":"t",' +
    '"heading_path":"H","page_start":0,"page_end":0,"block_type":"text","text":"b",' +
    '"expanded_text":"e","score":0.9}]}\n';
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(ndjson, { status: 200 }));
  process.env.RAG_SERVICE_URL = "http://rag:8000";

  const stages: RetrieveStageEvent[] = [];
  const chunks = await retrieveChunksStream({
    query: "q", ownerUserId: "u1", topK: 6, onStage: (e) => stages.push(e),
  });

  expect(stages.map((s) => s.stage)).toEqual(["embed", "vector_search"]);
  expect(stages[1].count).toBe(3);
  expect(chunks[0].chunkId).toBe("c1");
});

test("retrieveChunksStream sends candidate_k when provided", async () => {
  const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response('{"stage":"result","chunks":[]}\n', { status: 200 }));
  process.env.RAG_SERVICE_URL = "http://rag:8000";

  await retrieveChunksStream({
    query: "q", ownerUserId: "u1", topK: 6, candidateK: 10, onStage: () => {},
  });

  const [, init] = spy.mock.calls[0];
  expect(JSON.parse(init!.body as string).candidate_k).toBe(10);
});

test("retrieveChunksStream forwards detail fields (hits/selected/model/dims)", async () => {
  const ndjson =
    '{"stage":"embed","status":"done","ms":1,"model":"BAAI/bge-m3","dims":1024}\n' +
    '{"stage":"vector_search","status":"done","ms":2,"count":1,"hits":[{"title":"t","heading":"H","score":0.8}]}\n' +
    '{"stage":"rerank","status":"done","ms":3,"count":1,"model":"BAAI/bge-reranker-v2-m3","top_n":6,"selected":[{"id":"c1","score":0.04,"title":"t"}]}\n' +
    '{"stage":"result","chunks":[]}\n';
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(ndjson, { status: 200 }));
  process.env.RAG_SERVICE_URL = "http://rag:8000";

  const stages: RetrieveStageEvent[] = [];
  await retrieveChunksStream({ query: "q", ownerUserId: "u1", onStage: (e) => stages.push(e) });

  const embed = stages.find((s) => s.stage === "embed")!;
  expect(embed.model).toBe("BAAI/bge-m3");
  expect(embed.dims).toBe(1024);
  const vs = stages.find((s) => s.stage === "vector_search")!;
  expect(vs.hits).toEqual([{ title: "t", heading: "H", score: 0.8 }]);
  const rr = stages.find((s) => s.stage === "rerank")!;
  expect(rr.top_n).toBe(6);
  expect(rr.selected).toEqual([{ id: "c1", score: 0.04, title: "t" }]);
});
