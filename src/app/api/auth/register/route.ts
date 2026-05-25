import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { signAccessToken, authCookieName } from "@/lib/auth";
import { createUser, findUserByEmail, toAppUser } from "@/lib/users";

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

  const row = await createUser({ email, password, name: name || email.split("@")[0] });
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
