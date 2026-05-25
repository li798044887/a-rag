import { expect, test, vi } from "vitest";

// ── cookies() モック（next/headers は request scope 外では動かないため） ──────
vi.mock("next/headers", () => ({
  cookies: vi.fn(() =>
    Promise.resolve({
      get: () => undefined,
      set: () => {},
      delete: () => {},
    }),
  ),
}));

import { GET } from "@/app/api/threads/route";

test("threads list requires auth", async () => {
  const res = await GET();
  expect(res.status).toBe(401);
});
