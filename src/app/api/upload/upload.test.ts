import { expect, test, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  getSessionClaims: vi.fn(() => Promise.resolve({ sub: "u1" })),
}));

const ragFetch = vi.fn();
vi.mock("@/lib/rag-client", () => ({
  ragFetch: (...args: unknown[]) => ragFetch(...args),
}));

import { POST } from "@/app/api/upload/route";

function uploadRequest() {
  const form = new FormData();
  form.append("file", new File([new Uint8Array([1, 2, 3])], "a.pdf", { type: "application/pdf" }));
  return new Request("http://x/api/upload", { method: "POST", body: form });
}

beforeEach(() => ragFetch.mockReset());

test("maps rag 409 to 409 with Japanese duplicate message", async () => {
  ragFetch.mockResolvedValue(new Response("dup", { status: 409 }));
  const res = await POST(uploadRequest());
  expect(res.status).toBe(409);
  const body = await res.json();
  expect(body.error).toContain("同じ内容のファイル");
});

test("maps other rag failure to 502", async () => {
  ragFetch.mockResolvedValue(new Response("err", { status: 500 }));
  const res = await POST(uploadRequest());
  expect(res.status).toBe(502);
});

test("returns ids on success", async () => {
  ragFetch.mockResolvedValue(
    new Response(JSON.stringify({ document_id: "d1", job_id: "j1" }), { status: 200 }),
  );
  const res = await POST(uploadRequest());
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ documentId: "d1", jobId: "j1" });
});
