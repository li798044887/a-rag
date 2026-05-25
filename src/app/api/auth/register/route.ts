import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { signAccessToken, authCookieName } from "@/lib/auth";
import { createUser, findUserByEmail, toAppUser } from "@/lib/users";
import type { UserRow } from "@/lib/db/schema";

/** Postgres unique violation（重複登録）かどうか。 */
function isUniqueViolation(e: unknown) {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "23505";
}

export async function POST(req: Request) {
  const { email, password, name } = (await req.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
    name?: string;
  };

  if (!email || !password || password.length < 8) {
    return NextResponse.json(
      { error: "メールアドレスと 8 文字以上のパスワードが必要です" },
      { status: 400 },
    );
  }
  if (await findUserByEmail(email)) {
    return NextResponse.json({ error: "このメールアドレスは登録済みです" }, { status: 409 });
  }

  let row: UserRow;
  try {
    row = await createUser({ email, password, name: name || email.toLowerCase().split("@")[0] });
  } catch (e) {
    // 事前チェックをすり抜けた競合（同時登録）でも 409 を返す。
    if (isUniqueViolation(e)) {
      return NextResponse.json({ error: "このメールアドレスは登録済みです" }, { status: 409 });
    }
    throw e;
  }
  const token = await signAccessToken({ id: row.id, email: row.email, org: row.org });

  const jar = await cookies();
  jar.set(authCookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });

  return NextResponse.json({ user: toAppUser(row) });
}
