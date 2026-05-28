import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { AUTH_COOKIE } from "@/lib/constants";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

/** HS256 secret. In production set ARAG_JWT_SECRET; dev falls back to a constant. */
const secret = new TextEncoder().encode(
  process.env.ARAG_JWT_SECRET || "dev-only-insecure-secret-change-me",
);

const ISSUER = "auth.arag.internal";
const AUDIENCE = "rag-api";

/** アクセストークン寿命（秒）。"全デバイスサインアウト" の効力もこの上限まで。 */
export const ACCESS_TOKEN_TTL_SEC = 60 * 60 * 24; // 24h
/** "Refresh Token を保存" を ON にしたときの Cookie 寿命（秒）。 */
export const REMEMBER_COOKIE_TTL_SEC = 60 * 60 * 24 * 30; // 30d

export interface AragClaims extends JWTPayload {
  sub: string;
  email: string;
  org: string;
  role: string;
  scopes: string[];
  /** Remember-me フラグ。Cookie を永続化中かどうか。 */
  rem: boolean;
}

/** Issue a 24h access token for the given user. */
export async function signAccessToken(input: {
  id: string;
  email: string;
  org: string;
  remember?: boolean;
}): Promise<string> {
  return new SignJWT({
    email: input.email,
    org: input.org,
    role: "member",
    scopes: ["read:kb", "chat", "tools:python"],
    rem: Boolean(input.remember),
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(input.id)
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SEC}s`)
    .sign(secret);
}

/** Verify signature/expiry only. Use {@link getSessionClaims} when you also need revocation checks. */
export async function verifyAccessToken(token: string): Promise<AragClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret, {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    return payload as AragClaims;
  } catch {
    return null;
  }
}

/**
 * Cookie 由来のセッションを検証し、`tokenRevokedAt` より古い iat を弾く。
 * 「全デバイスでサインアウト」の即時無効化はここで効く。
 */
export async function getSessionClaims(): Promise<AragClaims | null> {
  const jar = await cookies();
  const token = jar.get(AUTH_COOKIE)?.value;
  if (!token) return null;

  const claims = await verifyAccessToken(token);
  if (!claims) return null;

  const [row] = await db.select({ revokedAt: users.tokenRevokedAt }).from(users).where(eq(users.id, claims.sub));
  if (!row) return null;
  // JWT の iat は秒精度。「失効時点と同秒以前」を全て弾くため <= で比較する。
  // 再ログイン時は新しい iat が確実に大きくなるよう、必要なら呼び出し側で 1 秒待つ。
  if (row.revokedAt && typeof claims.iat === "number") {
    const revokedAtSec = Math.floor(row.revokedAt.getTime() / 1000);
    if (claims.iat <= revokedAtSec) return null;
  }
  return claims;
}

/** Cookie に新しいトークンをセットする共通処理。`remember=true` で 30 日永続化。 */
export async function setSessionCookie(token: string, remember: boolean): Promise<void> {
  const jar = await cookies();
  jar.set(AUTH_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    ...(remember ? { maxAge: REMEMBER_COOKIE_TTL_SEC } : {}),
  });
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(AUTH_COOKIE);
}

export const authCookieName = AUTH_COOKIE;
