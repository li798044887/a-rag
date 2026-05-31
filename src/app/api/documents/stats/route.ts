import { NextResponse } from "next/server";
import { getSessionClaims } from "@/lib/auth";
import { ragFetch } from "@/lib/rag-client";

export const runtime = "nodejs";

export async function GET() {
  const claims = await getSessionClaims();
  if (!claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const qs = new URLSearchParams({ owner_user_id: claims.sub });
  const res = await ragFetch(`/documents/stats?${qs.toString()}`);
  if (!res.ok) return NextResponse.json({ error: "stats failed" }, { status: 502 });
  return NextResponse.json(await res.json());
}
