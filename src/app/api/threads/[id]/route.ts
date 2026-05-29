import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { getSessionClaims } from "@/lib/auth";
import { db } from "@/lib/db";
import { threads } from "@/lib/db/schema";
import { getThreadMessages } from "@/lib/threads";

export const runtime = "nodejs";

async function userId(): Promise<string | null> {
  return (await getSessionClaims())?.sub ?? null;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const uid = await userId();
  if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const turns = await getThreadMessages(id, uid);
  if (!turns) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ turns });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const uid = await userId();
  if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  await db.delete(threads).where(and(eq(threads.id, id), eq(threads.userId, uid)));
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const uid = await userId();
  if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { title?: string; pinned?: boolean };
  const updates: { title?: string; pinned?: boolean } = {};
  if (typeof body.title === "string") {
    const title = body.title.trim().slice(0, 80);
    if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });
    updates.title = title;
  }
  if (typeof body.pinned === "boolean") updates.pinned = body.pinned;
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "no updates" }, { status: 400 });
  }
  const [row] = await db.update(threads)
    .set(updates)
    .where(and(eq(threads.id, id), eq(threads.userId, uid)))
    .returning();
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true, thread: { id: row.id, title: row.title, pinned: row.pinned } });
}
