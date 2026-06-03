import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { getSessionClaims } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { isLocale, LOCALE_COOKIE } from "@/i18n/config";

export const runtime = "nodejs";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/** ユーザーの言語設定を永続化する。
 *  DB(users.locale)が永続源、Cookie は SSR 用の高速キャッシュとして同期する。 */
export async function POST(req: Request) {
  const claims = await getSessionClaims();
  if (!claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { locale } = (await req.json().catch(() => ({}))) as { locale?: unknown };
  if (!isLocale(locale)) {
    return NextResponse.json({ error: "invalid locale" }, { status: 400 });
  }

  await db.update(users).set({ locale }).where(eq(users.id, claims.sub));

  const jar = await cookies();
  jar.set(LOCALE_COOKIE, locale, { path: "/", maxAge: ONE_YEAR_SECONDS, sameSite: "lax" });

  return NextResponse.json({ ok: true, locale });
}
