import { NextResponse } from "next/server";
import { getSessionClaims } from "@/lib/auth";
import { ragFetch } from "@/lib/rag-client";

export const runtime = "nodejs";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const claims = await getSessionClaims();
  if (!claims) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const res = await ragFetch(
    `/jobs/${id}/cancel?owner_user_id=${encodeURIComponent(claims.sub)}`,
    { method: "POST" },
  );
  if (res.status === 404) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (res.status === 409) return NextResponse.json({ error: "not cancellable" }, { status: 409 });
  if (!res.ok) return NextResponse.json({ error: "cancel failed" }, { status: 502 });
  return new NextResponse(null, { status: 204 });
}
