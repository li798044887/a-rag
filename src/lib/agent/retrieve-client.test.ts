import { afterEach, expect, test, vi } from "vitest";
import { retrieveChunks, fetchDocument } from "@/lib/agent/retrieve-client";

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
