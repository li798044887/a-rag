import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { verifyAccessToken, authCookieName } from "@/lib/auth";
import { ragFetch } from "@/lib/rag-client";

export const runtime = "nodejs";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const jar = await cookies();
  const token = jar.get(authCookieName)?.value;
  const claims = token ? await verifyAccessToken(token) : null;
  if (!claims) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const res = await ragFetch(
    `/jobs/${id}/retry?owner_user_id=${encodeURIComponent(claims.sub)}`,
    { method: "POST" },
  );
  if (!res.ok) return NextResponse.json({ error: "retry failed" }, { status: 502 });
  return NextResponse.json(await res.json());
}
