import { NextResponse } from "next/server";
import { getSessionClaims } from "@/lib/auth";
import { ragFetch } from "@/lib/rag-client";

export const runtime = "nodejs";

// rag の解析エンジン情報（device: cuda/cpu, models_loaded）を返す。
// フロントの GPU/CPU バッジ表示用。rag が応答しない場合は device:"unknown" を返す。
export async function GET() {
  const claims = await getSessionClaims();
  if (!claims) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const res = await ragFetch("/health");
    if (!res.ok) throw new Error(`rag health ${res.status}`);
    const body = (await res.json()) as { device?: string; models_loaded?: boolean };
    return NextResponse.json({
      device: body.device ?? "unknown",
      modelsLoaded: Boolean(body.models_loaded),
    });
  } catch {
    return NextResponse.json({ device: "unknown", modelsLoaded: false });
  }
}
