import { NextResponse } from "next/server";
import { getSessionClaims } from "@/lib/auth";
import { ragFetch } from "@/lib/rag-client";
import { getLocale } from "@/i18n/server";
import { getDictionary } from "@/i18n/dictionary";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const claims = await getSessionClaims();
  if (!claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const t = getDictionary(await getLocale());

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file required" }, { status: 400 });
  }

  const MAX_BYTES = 50 * 1024 * 1024; // 50MB
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: t.api.fileTooLarge }, { status: 413 });
  }

  const fwd = new FormData();
  fwd.append("file", file);
  fwd.append("owner_user_id", claims.sub);

  const res = await ragFetch("/documents", { method: "POST", body: fwd });
  if (res.status === 409) {
    return NextResponse.json(
      { error: t.api.duplicateFile },
      { status: 409 },
    );
  }
  if (!res.ok) {
    return NextResponse.json({ error: t.api.indexingFailed }, { status: 502 });
  }
  const data = (await res.json()) as { document_id: string; job_id: string };
  return NextResponse.json({ documentId: data.document_id, jobId: data.job_id });
}
