import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { signAccessToken, setSessionCookie } from "@/lib/auth";
import { findUserByEmail, verifyPassword, toAppUser } from "@/lib/users";
import { getLocale } from "@/i18n/server";
import { getDictionary } from "@/i18n/dictionary";
import { isLocale, LOCALE_COOKIE } from "@/i18n/config";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export async function POST(req: Request) {
  const { email, password, remember } = (await req.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
    remember?: boolean;
  };

  const t = getDictionary(await getLocale());

  if (!email || !password) {
    return NextResponse.json({ error: t.api.emailPasswordRequired }, { status: 400 });
  }

  const user = await findUserByEmail(email);
  if (!user || !(await verifyPassword(user, password))) {
    return NextResponse.json({ error: t.api.invalidCredentials }, { status: 401 });
  }

  const rememberMe = Boolean(remember);
  const token = await signAccessToken({ id: user.id, email: user.email, org: user.org, remember: rememberMe });
  await setSessionCookie(token, rememberMe);

  // ユーザーの保存済み言語設定を Cookie へ同期し、別端末でもログイン時に反映する。
  if (isLocale(user.locale)) {
    (await cookies()).set(LOCALE_COOKIE, user.locale, { path: "/", maxAge: ONE_YEAR_SECONDS, sameSite: "lax" });
  }

  return NextResponse.json({ user: toAppUser(user) });
}
