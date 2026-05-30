import { NextResponse } from "next/server";
import { getSessionClaims } from "@/lib/auth";
import { resolveImageUrls } from "@/lib/agent/image-urls";
import { ragFetch } from "@/lib/rag-client";
import type { DocumentPreview } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const claims = await getSessionClaims();
  if (!claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const res = await ragFetch(
    `/documents/${encodeURIComponent(id)}/preview?owner_user_id=${encodeURIComponent(claims.sub)}`,
  );
  if (!res.ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  const data = (await res.json()) as DocumentPreview;
  data.chunks = data.chunks.map((c) => ({ ...c, text: resolveImageUrls(c.text, id) }));
  return NextResponse.json(data);
}
