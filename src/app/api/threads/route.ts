import { NextResponse } from "next/server";
import { getSessionClaims } from "@/lib/auth";
import { createThread, listThreads } from "@/lib/threads";
import { getLocale } from "@/i18n/server";

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
  const { title } = (await req.json().catch(() => ({}))) as { title?: string };
  const t = await createThread(uid, title || "新しいスレッド");
  return NextResponse.json({ thread: { id: t.id, title: t.title, updated: "たった今" } });
}
