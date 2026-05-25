import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { verifyAccessToken, authCookieName } from "@/lib/auth";

export const runtime = "nodejs";

const ACCEPTED = new Set([
  "pdf", "doc", "docx", "xls", "xlsx", "csv", "ppt", "pptx", "txt", "md", "json", "png", "jpg", "jpeg",
]);

/** Accepts a multipart upload and returns chunk/index metadata.
 * Production runs the bytes through a chunker + embedding pipeline; here we
 * derive deterministic counts so the UI shows a real round-trip. */
export async function POST(req: Request) {
  const jar = await cookies();
  const token = jar.get(authCookieName)?.value;
  if (!token || !(await verifyAccessToken(token))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file required" }, { status: 400 });
  }

  const ext = (file.name.split(".").pop() || "").toLowerCase();
  if (!ACCEPTED.has(ext)) {
    return NextResponse.json({ error: `未対応の形式: ${file.name}` }, { status: 415 });
  }

  const pages = ["pdf", "docx", "doc", "pptx", "ppt"].includes(ext)
    ? Math.max(3, Math.floor(file.size / 8000))
    : null;
  const chunks = Math.max(4, Math.floor((file.size || 4000) / 1200));

  return NextResponse.json({ name: file.name, size: file.size, pages, chunks });
}
