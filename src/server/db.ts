import type { Pool } from "pg";
import databasePoolOptions from "./databasePoolOptions.cjs";

let sharedPool: Pool | null = null;

export async function getDbPool(connectionString?: string): Promise<Pool | null> {
  const url = connectionString ?? process.env.DATABASE_URL;
  if (!url) {
    return null;
  }
  if (sharedPool) {
    return sharedPool;
  }
  const pg = await import("pg");
  const PoolCtor = pg.Pool ?? (pg as { default?: { Pool: typeof Pool } }).default?.Pool;
  if (!PoolCtor) {
    throw new Error("pg module did not export Pool");
  }
  sharedPool = new PoolCtor(databasePoolOptions(url));
  return sharedPool;
}

export async function closeDbPool(): Promise<void> {
  if (sharedPool) {
    await sharedPool.end();
    sharedPool = null;
  }
}

export function requireDbPool(pool: Pool | null): Pool {
  if (!pool) {
    throw new Error("DATABASE_URL is required but not configured");
  }
  return pool;
}

export type ChatThreadsSchemaStatus = "ok" | "missing" | "unavailable";

export async function getChatThreadsSchemaStatus(pool: Pool | null): Promise<ChatThreadsSchemaStatus> {
  if (!pool) {
    return "unavailable";
  }
  const result = await pool.query(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'chat_threads'
    ) AS ok
  `);
  return result.rows[0]?.ok ? "ok" : "missing";
}
