import { NextResponse } from "next/server";
import { getSessionClaims } from "@/lib/auth";
import { createThread, listThreads } from "@/lib/threads";
import { getLocale } from "@/i18n/server";
import { getDictionary } from "@/i18n/dictionary";

export const runtime = "nodejs";

async function userId(): Promise<string | null> {
  return (await getSessionClaims())?.sub ?? null;
}

export async function GET() {
  const uid = await userId();
  if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const locale = await getLocale();
  return NextResponse.json({ threads: await listThreads(uid, locale) });
}

export async function POST(req: Request) {
  const uid = await userId();
  if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const locale = await getLocale();
  const dict = getDictionary(locale);
  const { title } = (await req.json().catch(() => ({}))) as { title?: string };
  const thread = await createThread(uid, title || dict.api.newThread);
  return NextResponse.json({ thread: { id: thread.id, title: thread.title, updated: dict.api.updatedJustNow } });
}
