import { expect, test, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: vi.fn(() =>
    Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
  ),
}));

import { GET as listGET } from "@/app/api/documents/route";
import { DELETE as docDELETE } from "@/app/api/documents/[id]/route";
import { GET as previewGET } from "@/app/api/documents/[id]/preview/route";
import { GET as layoutGET } from "@/app/api/documents/[id]/layout/route";
import { GET as spanGET } from "@/app/api/documents/[id]/span/route";
import { GET as renderedGET } from "@/app/api/documents/[id]/rendered/route";

const params = (id: string) => ({ params: Promise.resolve({ id }) });

test("documents list requires auth", async () => {
  const res = await listGET(new Request("http://x/api/documents"));
  expect(res.status).toBe(401);
});

test("documents delete requires auth", async () => {
  const res = await docDELETE(new Request("http://x/api/documents/d1"), params("d1"));
  expect(res.status).toBe(401);
});

test("documents preview requires auth", async () => {
  const res = await previewGET(new Request("http://x/api/documents/d1/preview"), params("d1"));
  expect(res.status).toBe(401);
});

test("documents layout requires auth", async () => {
  const res = await layoutGET(new Request("http://x/api/documents/d1/layout"), params("d1"));
  expect(res.status).toBe(401);
});

test("documents span requires auth", async () => {
  const res = await spanGET(new Request("http://x/api/documents/d1/span"), params("d1"));
  expect(res.status).toBe(401);
});

test("documents rendered requires auth", async () => {
  const res = await renderedGET(new Request("http://x/api/documents/d1/rendered"), params("d1"));
  expect(res.status).toBe(401);
});
