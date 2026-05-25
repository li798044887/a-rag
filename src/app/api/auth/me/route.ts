import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { verifyAccessToken, authCookieName } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { toAppUser } from "@/lib/users";

export async function GET() {
  const jar = await cookies();
  const token = jar.get(authCookieName)?.value;
  if (!token) return NextResponse.json({ user: null });

  const claims = await verifyAccessToken(token);
  if (!claims) return NextResponse.json({ user: null });

  const [row] = await db.select().from(users).where(eq(users.id, claims.sub));
  if (!row) return NextResponse.json({ user: null });

  return NextResponse.json({ user: toAppUser(row), claims });
}
