import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { signAccessToken, authCookieName } from "@/lib/auth";
import { DEFAULT_USER } from "@/lib/data";
import type { AppUser } from "@/lib/types";

/** Issue a JWT and set it as an httpOnly cookie.
 * Demo accepts any credentials; swap in a real password check here. */
export async function POST(req: Request) {
  const { email, remember } = (await req.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
    remember?: boolean;
  };

  if (!email) {
    return NextResponse.json({ error: "メールアドレスが必要です" }, { status: 400 });
  }

  const token = await signAccessToken({ email });
  const user: AppUser = { ...DEFAULT_USER, email };

  const jar = await cookies();
  jar.set(authCookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    // "Remember me" keeps the cookie for 30 days, otherwise session-only.
    ...(remember ? { maxAge: 60 * 60 * 24 * 30 } : {}),
  });

  return NextResponse.json({ user });
}
