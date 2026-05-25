import { afterAll, expect, test, vi } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

// ── cookies() モック（next/headers は request scope 外では動かないため） ──────
const cookieStore = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: vi.fn(() =>
    Promise.resolve({
      get: (name: string) => (cookieStore.has(name) ? { value: cookieStore.get(name) } : undefined),
      set: (name: string, value: string) => cookieStore.set(name, value),
      delete: (name: string) => cookieStore.delete(name),
    }),
  ),
}));

import { POST as register } from "@/app/api/auth/register/route";
import { POST as login } from "@/app/api/auth/login/route";

const email = `auth_${Date.now()}@example.com`;
const password = "pw-secret-123";

afterAll(async () => {
  await db.execute(sql`delete from users where email = ${email}`);
});

function jsonReq(body: unknown): Request {
  return new Request("http://test/local", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("register creates a user and returns it", async () => {
  const res = await register(jsonReq({ email, password, name: "新規 ユーザー" }));
  expect(res.status).toBe(200);
  const { user } = await res.json();
  expect(user.email).toBe(email);
});

test("login rejects wrong password and accepts correct one", async () => {
  const bad = await login(jsonReq({ email, password: "nope" }));
  expect(bad.status).toBe(401);

  const ok = await login(jsonReq({ email, password }));
  expect(ok.status).toBe(200);
  const { user } = await ok.json();
  expect(user.email).toBe(email);
});
