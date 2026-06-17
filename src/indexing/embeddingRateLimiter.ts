import { createHash } from "node:crypto";
import type { Pool } from "pg";

/**
 * Serializes bulk embedding requests across worker processes using Postgres advisory
 * locks keyed by API key hash. Docker compose runs one worker today; in multi-worker
 * prod each worker competes for the same lock so only EMBEDDING_MAX_CONCURRENT bulk
 * embedding operations run per API key at once.
 */
export async function withEmbeddingConcurrencyLimit<T>(
  pool: Pool,
  apiKey: string,
  fn: () => Promise<T>
): Promise<T> {
  const maxConcurrent = Math.max(1, Number(process.env.EMBEDDING_MAX_CONCURRENT ?? "1") || 1);
  if (maxConcurrent <= 1) {
    return withAdvisoryLock(pool, advisoryLockKey(apiKey), fn);
  }

  const slots = Array.from({ length: maxConcurrent }, (_entry, index) =>
    advisoryLockKey(`${apiKey}:${index}`)
  );
  for (const slot of slots) {
    const acquired = await tryAdvisoryLock(pool, slot);
    if (acquired) {
      try {
        return await fn();
      } finally {
        await releaseAdvisoryLock(pool, slot);
      }
    }
  }

  return withAdvisoryLock(pool, advisoryLockKey(apiKey), fn);
}

function advisoryLockKey(material: string): bigint {
  const digest = createHash("sha256").update(material).digest();
  return digest.readBigInt64BE(0);
}

async function withAdvisoryLock<T>(
  pool: Pool,
  lockKey: bigint,
  fn: () => Promise<T>
): Promise<T> {
  await pool.query(`SELECT pg_advisory_lock($1::bigint)`, [lockKey.toString()]);
  try {
    return await fn();
  } finally {
    await pool.query(`SELECT pg_advisory_unlock($1::bigint)`, [lockKey.toString()]);
  }
}

async function tryAdvisoryLock(pool: Pool, lockKey: bigint): Promise<boolean> {
  const result = await pool.query<{ acquired: boolean }>(
    `SELECT pg_try_advisory_lock($1::bigint) AS acquired`,
    [lockKey.toString()]
  );
  return Boolean(result.rows[0]?.acquired);
}

async function releaseAdvisoryLock(pool: Pool, lockKey: bigint): Promise<void> {
  await pool.query(`SELECT pg_advisory_unlock($1::bigint)`, [lockKey.toString()]);
}
