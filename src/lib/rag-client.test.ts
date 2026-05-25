import { afterEach, expect, test, vi } from "vitest";
import { ragFetch } from "@/lib/rag-client";

afterEach(() => vi.restoreAllMocks());

test("ragFetch attaches internal token header and base url", async () => {
  const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ ok: true }), { status: 200 }),
  );
  process.env.RAG_SERVICE_URL = "http://rag:8000";
  process.env.RAG_INTERNAL_TOKEN = "tok";

  await ragFetch("/jobs/abc");
  const [url, init] = spy.mock.calls[0];
  expect(url).toBe("http://rag:8000/jobs/abc");
  expect((init?.headers as Record<string, string>)["x-internal-token"]).toBe("tok");
});
