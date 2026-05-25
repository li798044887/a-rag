import { hash, verify } from "@node-rs/argon2";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, type UserRow } from "@/lib/db/schema";
import type { AppUser } from "@/lib/types";

/** 「山田 太郎」→「山太」/「Hiroshi Tanaka」→「HT」。1語なら先頭2文字。 */
function deriveInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.trim().slice(0, 2).toUpperCase();
}

function deriveFirstName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2 ? parts[1] : parts[0];
}

export async function createUser(input: {
  email: string;
  password: string;
  name: string;
  org?: string;
}): Promise<UserRow> {
  const passwordHash = await hash(input.password);
  const [row] = await db
    .insert(users)
    .values({
      email: input.email.toLowerCase(),
      passwordHash,
      name: input.name,
      firstName: deriveFirstName(input.name),
      org: input.org ?? "ARag, Inc.",
      initials: deriveInitials(input.name),
    })
    .returning();
  return row;
}

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const [row] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
  return row ?? null;
}

export async function verifyPassword(user: UserRow, password: string): Promise<boolean> {
  return verify(user.passwordHash, password);
}

export function toAppUser(user: UserRow): AppUser {
  return {
    name: user.name,
    firstName: user.firstName,
    org: user.org,
    initials: user.initials,
    email: user.email,
  };
}
