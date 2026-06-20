import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { getEnv } from "@/server/env";

let _sql: ReturnType<typeof postgres> | null = null;
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

/** Lazy singleton drizzle client. Safe to import from server code only. */
export function getDb() {
  if (_db) return _db;
  const env = getEnv();
  _sql = postgres(env.databaseUrl, { max: 5, idle_timeout: 20 });
  _db = drizzle(_sql, { schema });
  return _db;
}

export { schema };
