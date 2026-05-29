import { NextResponse } from "next/server";
import { getSessionClaims } from "@/lib/auth";
import { ragFetch } from "@/lib/rag-client";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const claims = await getSessionClaims();
  if (!claims) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const res = await ragFetch(
    `/documents/${encodeURIComponent(id)}/raw?owner_user_id=${encodeURIComponent(claims.sub)}`,
  );
  if (!res.ok || !res.body) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const headers = new Headers();
  headers.set("content-type", res.headers.get("content-type") || "application/octet-stream");
  headers.set("content-disposition", res.headers.get("content-disposition") || "inline");
  const len = res.headers.get("content-length");
  if (len) headers.set("content-length", len);
  return new NextResponse(res.body, { status: 200, headers });
}
