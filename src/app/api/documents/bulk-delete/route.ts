import { NextResponse } from "next/server";
import { getSessionClaims } from "@/lib/auth";
import { ragFetch } from "@/lib/rag-client";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const claims = await getSessionClaims();
  if (!claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const ids = Array.isArray(body?.document_ids) ? (body.document_ids as unknown[]) : null;
  if (!ids) return NextResponse.json({ error: "document_ids required" }, { status: 400 });
  const documentIds = ids.filter((x): x is string => typeof x === "string");

  const res = await ragFetch("/documents/bulk-delete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ owner_user_id: claims.sub, document_ids: documentIds }),
  });
  if (!res.ok) return NextResponse.json({ error: "bulk delete failed" }, { status: 502 });
  const json = await res.json();
  return NextResponse.json(json, { status: 200 });
}
