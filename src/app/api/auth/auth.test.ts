import { afterAll, beforeEach, expect, test, vi } from "vitest";
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
import { POST as remember } from "@/app/api/auth/remember/route";
import { POST as revokeAll } from "@/app/api/auth/revoke-all/route";
import { GET as me } from "@/app/api/auth/me/route";
import { AUTH_COOKIE } from "@/lib/constants";

const email = `auth_${Date.now()}@example.com`;
const password = "pw-secret-123";

beforeEach(() => {
  cookieStore.clear();
});

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

test("/api/auth/me returns decoded claims for an authenticated session", async () => {
  await login(jsonReq({ email, password }));
  const res = await me();
  expect(res.status).toBe(200);
  const data = await res.json();
  expect(data.user?.email).toBe(email);
  expect(data.claims).toBeTruthy();
  expect(data.claims.email).toBe(email);
  expect(Array.isArray(data.claims.scopes)).toBe(true);
  expect(typeof data.claims.exp).toBe("number");
  expect(data.claims.rem).toBe(false);
});

test("/api/auth/remember flips the rem claim and re-issues the cookie", async () => {
  await login(jsonReq({ email, password }));
  const before = cookieStore.get(AUTH_COOKIE);
  const res = await remember(jsonReq({ value: true }));
  expect(res.status).toBe(200);
  const after = cookieStore.get(AUTH_COOKIE);
  expect(after).toBeTruthy();
  expect(after).not.toBe(before);

  const meRes = await me();
  const data = await meRes.json();
  expect(data.claims.rem).toBe(true);
});

test("/api/auth/revoke-all invalidates the current session", async () => {
  await login(jsonReq({ email, password }));
  // この時点ではセッション有効
  const before = await me();
  expect((await before.json()).user?.email).toBe(email);

  const res = await revokeAll();
  expect(res.status).toBe(200);
  // 自分の Cookie は破棄され、/me は user: null を返す
  expect(cookieStore.get(AUTH_COOKIE)).toBeUndefined();
  const after = await me();
  expect((await after.json()).user).toBeNull();
});

test("revoke-all rejects pre-revocation tokens even if their cookie is replayed", async () => {
  // 同秒内 iat ≤ revokedAtSec を確実に成立させるため、ログイン後 1.1 秒待ってから失効。
  await login(jsonReq({ email, password }));
  const tokenBeforeRevoke = cookieStore.get(AUTH_COOKIE);
  expect(tokenBeforeRevoke).toBeTruthy();

  await new Promise((r) => setTimeout(r, 1100));
  await revokeAll();

  // 古いトークンを Cookie に戻して再アクセス → 拒否される
  cookieStore.set(AUTH_COOKIE, tokenBeforeRevoke!);
  const replay = await me();
  expect((await replay.json()).user).toBeNull();
});
