import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { Pool, PoolClient } from "pg";

/** Pin the PostgreSQL session through acquisition, callback and unlock. Waiting
 * callers release unsuccessful checkouts so heartbeats can still use the pool.
 * All workers sharing a key must use the same configured slot count. Session
 * loss cancels the callback; already-dispatched remote work can remain uncertain
 * after disconnect, so this bounds connected-session admission, not remote work. */
export async function withEmbeddingConcurrencyLimit<T>(
  pool: Pool,
  apiKey: string,
  fn: (signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  const maxConcurrent = Number(process.env.EMBEDDING_MAX_CONCURRENT ?? "1");
  if (!Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 64) {
    throw new Error("EMBEDDING_MAX_CONCURRENT must be an integer from 1 through 64");
  }
  signal?.throwIfAborted();
  for (;;) {
    const client = await checkout(pool, signal);
    let held: string | undefined, destroy: Error | undefined;
    let callbackFailed = false, callbackFailure: unknown;
    const operation = new AbortController();
    let sessionFailure: Error | undefined;
    const onSessionError = (error: Error) => {
      sessionFailure ??= error;
      operation.abort(sessionFailure);
    };
    const onAbort = () => operation.abort(signal?.reason);
    client.on("error", onSessionError);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
    try {
      signal?.throwIfAborted();
      for (let index = 0; index < maxConcurrent; index++) {
        // Slot zero retains the existing single-slot key. There is no extra
        // unslotted fallback that can increase the configured capacity.
        const slot = advisoryLockKey(index === 0 ? apiKey : `${apiKey}:${index}`);
        let acquired: boolean;
        try {
          acquired = (await client.query<{ acquired: boolean }>(
            "SELECT pg_try_advisory_lock($1::bigint) AS acquired", [slot]
          )).rows[0]?.acquired === true;
        } catch (error) {
          // A failed acknowledgement may have acquired a session lock.
          destroy = error instanceof Error ? error : new Error("Embedding lock acquisition failed");
          throw error;
        }
        if (acquired) { held = slot; break; }
      }
      if (held !== undefined) {
        signal?.throwIfAborted();
        try {
          operation.signal.throwIfAborted();
          const value = await fn(operation.signal);
          // A disconnected session has already released its lock. Never report
          // success from a callback that ignored cancellation or won that race.
          operation.signal.throwIfAborted();
          return value;
        }
        catch (error) { callbackFailed = true; callbackFailure = error; throw error; }
      }
    } finally {
      destroy ??= sessionFailure;
      if (held !== undefined && !sessionFailure) {
        try {
          const result = await client.query<{ released: boolean }>(
            "SELECT pg_advisory_unlock($1::bigint) AS released", [held]
          );
          if (result.rows[0]?.released !== true) throw new Error("Embedding lock session ownership was lost");
        } catch (error) {
          destroy = error instanceof Error ? error : new Error("Embedding lock release failed");
        }
      }
      destroy ??= sessionFailure;
      signal?.removeEventListener("abort", onAbort);
      client.release(destroy);
      client.removeListener("error", onSessionError);
      if (destroy && held !== undefined) {
        if (callbackFailed && callbackFailure !== destroy) throw new AggregateError([callbackFailure, destroy], "Embedding callback and lock release failed");
        throw destroy;
      }
    }
    await delay(25, undefined, { signal });
  }
}

function advisoryLockKey(material: string): string {
  return createHash("sha256").update(material).digest().readBigInt64BE(0).toString();
}

/** pg does not cancel queued pool checkouts. Reject an aborted caller promptly,
 * and return any eventual checkout without ever entering its callback. */
function checkout(pool: Pool, signal?: AbortSignal): Promise<PoolClient> {
  signal?.throwIfAborted();
  if (!signal) return pool.connect();
  return new Promise((resolve, reject) => {
    let settled = false;
    const abort = () => { settled = true; signal.removeEventListener("abort", abort); reject(signal.reason); };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) { abort(); return; }
    void pool.connect().then(client => {
      signal.removeEventListener("abort", abort);
      if (settled) { client.release(); return; }
      settled = true; resolve(client);
    }, error => {
      signal.removeEventListener("abort", abort);
      if (!settled) { settled = true; reject(error); }
    });
  });
}
