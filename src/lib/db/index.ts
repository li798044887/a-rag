import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/lib/db/schema";

const connectionString =
  process.env.DATABASE_URL || "postgres://arag:arag@localhost:5432/arag";

export const pool = new Pool({ connectionString });

export const db = drizzle(pool, { schema });
