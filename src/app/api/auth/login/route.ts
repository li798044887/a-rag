import { NextResponse } from "next/server";
import { signAccessToken, setSessionCookie } from "@/lib/auth";
import { findUserByEmail, verifyPassword, toAppUser } from "@/lib/users";
import { getLocale } from "@/i18n/server";
import { getDictionary } from "@/i18n/dictionary";

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

  return NextResponse.json({ user: toAppUser(user) });
}
