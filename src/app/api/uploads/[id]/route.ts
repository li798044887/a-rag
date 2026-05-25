import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { verifyAccessToken, authCookieName } from "@/lib/auth";
import { ragFetch } from "@/lib/rag-client";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const jar = await cookies();
  const token = jar.get(authCookieName)?.value;
  if (!token || !(await verifyAccessToken(token))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const res = await ragFetch(`/jobs/${id}`);
  if (!res.ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(await res.json());
}
