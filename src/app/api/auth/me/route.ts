import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { verifyAccessToken, authCookieName } from "@/lib/auth";
import { DEFAULT_USER } from "@/lib/data";

/** Returns the current user (from the JWT cookie) or 401. */
export async function GET() {
  const jar = await cookies();
  const token = jar.get(authCookieName)?.value;
  // 200 with a null user (rather than 401) keeps the client session check quiet.
  if (!token) return NextResponse.json({ user: null });

  const claims = await verifyAccessToken(token);
  if (!claims) return NextResponse.json({ user: null });

  return NextResponse.json({
    user: { ...DEFAULT_USER, email: claims.email },
    claims,
  });
}
