import { afterEach, expect, test, vi } from "vitest";
import { ragFetch, setRagTransport } from "@/lib/rag-client";

afterEach(() => { vi.restoreAllMocks(); setRagTransport(null); });

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

test("transport 設定時はそちらを使い x-internal-token を付ける", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  setRagTransport(async (url, init) => { calls.push({ url: String(url), init }); return new Response("ok"); });
  await ragFetch("/retrieve", { method: "POST" });
  expect(calls).toHaveLength(1);
  expect(calls[0].url).toContain("/retrieve");
  expect((calls[0].init?.headers as Record<string, string>)["x-internal-token"]).toBeTruthy();
});

test("transport 未設定時は素の fetch にフォールバックする", async () => {
  const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
  setRagTransport(null);
  await ragFetch("/retrieve", { method: "POST" });
  expect(spy).toHaveBeenCalledOnce();
});

test("本番では transport 差し替えを拒否する", () => {
  vi.stubEnv("NODE_ENV", "production");
  try {
    expect(() => setRagTransport(async () => new Response(""))).toThrow(/dev-only/);
  } finally { vi.unstubAllEnvs(); }
});
