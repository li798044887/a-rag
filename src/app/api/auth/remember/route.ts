import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getSessionClaims, setSessionCookie, signAccessToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

export const runtime = "nodejs";

/**
 * "Refresh Token を保存" トグルの実体。
 * - true  : 30日永続 Cookie + rem=true で再発行
 * - false : セッション Cookie  + rem=false で再発行
 *
 * JWT 寿命自体は変えない。再発行で iat が更新されるため、
 * これより古いトークンは tokenRevokedAt の有無に関わらず置き換わる。
 */
export async function POST(req: Request) {
  const claims = await getSessionClaims();
  if (!claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { value } = (await req.json().catch(() => ({}))) as { value?: boolean };
  const remember = Boolean(value);

  const [row] = await db.select().from(users).where(eq(users.id, claims.sub));
  if (!row) return NextResponse.json({ error: "user not found" }, { status: 404 });

  const token = await signAccessToken({ id: row.id, email: row.email, org: row.org, remember });
  await setSessionCookie(token, remember);

  return NextResponse.json({ ok: true, remember });
}
