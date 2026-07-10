import type { Pool } from "pg";

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
  sharedPool = new PoolCtor(poolOptions(url));
  return sharedPool;
}

function poolOptions(connectionString: string): { connectionString: string; ssl?: { rejectUnauthorized: boolean } } {
  const needsSsl =
    process.env.DATABASE_SSL === "true" ||
    /sslmode=(require|verify-ca|verify-full)/i.test(connectionString);
  return needsSsl
    ? { connectionString, ssl: { rejectUnauthorized: false } }
    : { connectionString };
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
