import assert from "node:assert/strict";
import type { Pool } from "pg";
import { withEmbeddingConcurrencyLimit } from "./embeddingRateLimiter";

type LockState = {
  held: Set<string>;
  waiters: Array<() => void>;
};

function createMockPool(): { pool: Pool; state: LockState } {
  const state: LockState = { held: new Set(), waiters: [] };

  const pool = {
    query: async (sql: string, params?: unknown[]) => {
      const text = String(sql);
      const key = String(params?.[0] ?? "");

      if (text.includes("pg_try_advisory_lock")) {
        if (state.held.has(key)) {
          return { rows: [{ acquired: false }] };
        }
        state.held.add(key);
        return { rows: [{ acquired: true }] };
      }

      if (text.includes("pg_advisory_lock")) {
        if (!state.held.has(key)) {
          state.held.add(key);
        } else {
          await new Promise<void>((resolve) => state.waiters.push(resolve));
          state.held.add(key);
        }
        return { rows: [] };
      }

      if (text.includes("pg_advisory_unlock")) {
        state.held.delete(key);
        const next = state.waiters.shift();
        next?.();
        return { rows: [] };
      }

      throw new Error(`unexpected query: ${text}`);
    }
  } as unknown as Pool;

  return { pool, state };
}

void (async () => {
  const { pool } = createMockPool();
  const order: number[] = [];

  const first = withEmbeddingConcurrencyLimit(pool, "test-key", async () => {
    order.push(1);
    await new Promise((resolve) => setTimeout(resolve, 30));
    order.push(2);
    return "first";
  });

  const second = withEmbeddingConcurrencyLimit(pool, "test-key", async () => {
    order.push(3);
    return "second";
  });

  const [a, b] = await Promise.all([first, second]);
  assert.equal(a, "first");
  assert.equal(b, "second");
  assert.deepEqual(order, [1, 2, 3]);

  console.log("embeddingRateLimiter: 1/1 tests passed");
})();
