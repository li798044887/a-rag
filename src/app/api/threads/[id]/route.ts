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
