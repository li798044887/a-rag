import { NextResponse } from "next/server";
import { getSessionClaims } from "@/lib/auth";
import { ragFetch } from "@/lib/rag-client";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const claims = await getSessionClaims();
  if (!claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const qs = new URLSearchParams({ owner_user_id: claims.sub });
  for (const k of ["q", "status", "limit", "cursor"]) {
    const v = url.searchParams.get(k);
    if (v) qs.set(k, v);
  }
  const res = await ragFetch(`/documents?${qs.toString()}`);
  if (!res.ok) return NextResponse.json({ error: "list failed" }, { status: 502 });
  return NextResponse.json(await res.json());
}
