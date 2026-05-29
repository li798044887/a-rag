import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { clearSessionCookie, getSessionClaims } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

export const runtime = "nodejs";

/**
 * 「全デバイスでサインアウト」: users.token_revoked_at を現在時刻に更新し、
 * これより古い iat の JWT を以後 getSessionClaims が拒否する。
 * 自分のセッション Cookie も削除する。
 */
export async function POST() {
  const claims = await getSessionClaims();
  if (!claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  await db.update(users).set({ tokenRevokedAt: new Date() }).where(eq(users.id, claims.sub));
  await clearSessionCookie();

  return NextResponse.json({ ok: true });
}
