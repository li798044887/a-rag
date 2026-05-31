import { expect, test, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: vi.fn(() =>
    Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
  ),
}));

import { GET } from "@/app/api/documents/stats/route";

test("documents stats requires auth", async () => {
  const res = await GET();
  expect(res.status).toBe(401);
});
