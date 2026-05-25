import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { verifyAccessToken, authCookieName } from "@/lib/auth";
import { createThread, listThreads } from "@/lib/threads";

export const runtime = "nodejs";

async function userId(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(authCookieName)?.value;
  const claims = token ? await verifyAccessToken(token) : null;
  return claims?.sub ?? null;
}

export async function GET(_req: Request) {
  const uid = await userId();
  if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ threads: await listThreads(uid) });
}

export async function POST(req: Request) {
  const uid = await userId();
  if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { title } = (await req.json().catch(() => ({}))) as { title?: string };
  const t = await createThread(uid, title || "新しいスレッド");
  return NextResponse.json({ thread: { id: t.id, title: t.title, updated: "たった今" } });
}
