import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/lib/db/schema";

const connectionString =
  process.env.DATABASE_URL || "postgres://arag:arag@localhost:5432/arag";

export const pool = new Pool({ connectionString });

// アイドル中のクライアントが切断された場合（例: Postgres 再起動）にプロセスがクラッシュしないよう error を握る
pool.on("error", (err) => {
  console.error("[db pool] idle client error:", err.message);
});

export const db = drizzle(pool, { schema });
