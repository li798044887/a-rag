import { NextResponse } from "next/server";
import { getSessionClaims } from "@/lib/auth";
import { updateUserName, toAppUser } from "@/lib/users";

export const runtime = "nodejs";

/** 表示名の最大長（文字数）。アバター頭文字や挨拶の派生もここから行う。 */
const MAX_NAME_LENGTH = 80;

/** ユーザーの表示名を永続化する。DB(users.name)が永続源で、firstName/initials も再計算される。 */
export async function POST(req: Request) {
  const claims = await getSessionClaims();
  if (!claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { name } = (await req.json().catch(() => ({}))) as { name?: unknown };
  if (typeof name !== "string" || name.trim().length === 0 || name.trim().length > MAX_NAME_LENGTH) {
    return NextResponse.json({ error: "invalid name" }, { status: 400 });
  }

  const row = await updateUserName(claims.sub, name);
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json({ ok: true, user: toAppUser(row) });
}
