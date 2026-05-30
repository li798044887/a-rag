import { NextResponse } from "next/server";
import { getSessionClaims } from "@/lib/auth";
import { ragFetch } from "@/lib/rag-client";

export const runtime = "nodejs";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const claims = await getSessionClaims();
  if (!claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const res = await ragFetch(
    `/documents/${encodeURIComponent(id)}?owner_user_id=${encodeURIComponent(claims.sub)}`,
    { method: "DELETE" },
  );
  if (res.status === 404) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!res.ok) return NextResponse.json({ error: "delete failed" }, { status: 502 });
  return new NextResponse(null, { status: 204 });
}
