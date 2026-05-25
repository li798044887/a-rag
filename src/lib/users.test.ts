import { afterAll, expect, test } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { createUser, findUserByEmail, verifyPassword, toAppUser } from "@/lib/users";

const email = `t_${Date.now()}@example.com`;

afterAll(async () => {
  await db.execute(sql`delete from users where email = ${email}`);
});

test("createUser then findUserByEmail roundtrips and hashes password", async () => {
  const created = await createUser({ email, password: "pw-secret-123", name: "山田 太郎" });
  expect(created.email).toBe(email);
  expect(created.passwordHash).not.toContain("pw-secret-123");

  const found = await findUserByEmail(email);
  expect(found?.id).toBe(created.id);
  expect(await verifyPassword(found!, "pw-secret-123")).toBe(true);
  expect(await verifyPassword(found!, "wrong")).toBe(false);
});

test("toAppUser derives initials and firstName", async () => {
  const found = await findUserByEmail(email);
  const app = toAppUser(found!);
  expect(app.email).toBe(email);
  expect(app.name).toBe("山田 太郎");
});
