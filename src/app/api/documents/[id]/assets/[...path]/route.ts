import { NextResponse } from "next/server";
import { getSessionClaims } from "@/lib/auth";
import { ragFetch } from "@/lib/rag-client";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string; path: string[] }> },
) {
  const claims = await getSessionClaims();
  if (!claims) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id, path } = await ctx.params;
  const rel = path.map(encodeURIComponent).join("/");
  const res = await ragFetch(
    `/documents/${encodeURIComponent(id)}/assets/${rel}?owner_user_id=${encodeURIComponent(claims.sub)}`,
  );
  if (!res.ok || !res.body) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const headers = new Headers();
  headers.set("content-type", res.headers.get("content-type") || "application/octet-stream");
  const len = res.headers.get("content-length");
  if (len) headers.set("content-length", len);
  headers.set("cache-control", "private, max-age=3600");
  return new NextResponse(res.body, { status: 200, headers });
}
