import { NextResponse, type NextRequest } from "next/server";
import { verifyAccessToken, authCookieName } from "@/lib/auth";

/** Route-level auth for the protected API surface (defense in depth — the
 * handlers verify too). Runs at the edge; jose works there. */
export async function proxy(req: NextRequest) {
  const token = req.cookies.get(authCookieName)?.value;
  if (!token || !(await verifyAccessToken(token))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/chat/:path*", "/api/upload/:path*"],
};
