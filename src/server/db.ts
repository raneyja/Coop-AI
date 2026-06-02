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
  sharedPool = new PoolCtor({ connectionString: url });
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
