import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { AUTH_COOKIE } from "@/lib/constants";

/** HS256 secret. In production set ARAG_JWT_SECRET; dev falls back to a constant. */
const secret = new TextEncoder().encode(
  process.env.ARAG_JWT_SECRET || "dev-only-insecure-secret-change-me",
);

const ISSUER = "auth.arag.internal";
const AUDIENCE = "rag-api";

export interface AragClaims extends JWTPayload {
  sub: string;
  email: string;
  org: string;
  role: string;
  scopes: string[];
}

/** Issue a 24h access token for the given user. */
export async function signAccessToken(input: {
  id: string;
  email: string;
  org: string;
}): Promise<string> {
  return new SignJWT({
    email: input.email,
    org: input.org,
    role: "member",
    scopes: ["read:kb", "chat", "tools:python"],
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(input.id)
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime("24h")
    .sign(secret);
}

/** Verify a token and return its claims, or null when invalid/expired. */
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

export const authCookieName = AUTH_COOKIE;
