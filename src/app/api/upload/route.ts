import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { verifyAccessToken, authCookieName } from "@/lib/auth";
import { ragFetch } from "@/lib/rag-client";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const jar = await cookies();
  const token = jar.get(authCookieName)?.value;
  const claims = token ? await verifyAccessToken(token) : null;
  if (!claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file required" }, { status: 400 });
  }

  const MAX_BYTES = 50 * 1024 * 1024; // 50MB
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "ファイルサイズが上限(50MB)を超えています" }, { status: 413 });
  }

  const fwd = new FormData();
  fwd.append("file", file);
  fwd.append("owner_user_id", claims.sub);

  const res = await ragFetch("/documents", { method: "POST", body: fwd });
  if (!res.ok) {
    return NextResponse.json({ error: "索引化の開始に失敗しました" }, { status: 502 });
  }
  const data = (await res.json()) as { document_id: string; job_id: string };
  return NextResponse.json({ documentId: data.document_id, jobId: data.job_id });
}
