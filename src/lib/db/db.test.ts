import { expect, test } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

// 要 `docker compose up -d postgres`
test("db connects to postgres", async () => {
  const res = await db.execute(sql`select 1 as one`);
  expect(res.rows[0]).toMatchObject({ one: 1 });
});
