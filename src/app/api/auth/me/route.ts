import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getSessionClaims } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { toAppUser } from "@/lib/users";

export async function GET() {
  const claims = await getSessionClaims();
  if (!claims) return NextResponse.json({ user: null });

  const [row] = await db.select().from(users).where(eq(users.id, claims.sub));
  if (!row) return NextResponse.json({ user: null });

  return NextResponse.json({
    user: toAppUser(row),
    claims: {
      sub: claims.sub,
      email: claims.email,
      org: claims.org,
      role: claims.role,
      scopes: claims.scopes,
      iat: claims.iat ?? null,
      exp: claims.exp ?? null,
      iss: claims.iss ?? null,
      aud: claims.aud ?? null,
      rem: Boolean(claims.rem),
    },
  });
}
