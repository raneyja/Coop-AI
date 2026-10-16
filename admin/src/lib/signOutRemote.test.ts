/**
 * A failed sign-out request must leave the local session available for retry.
 * Run: cd admin && npx tsx --tsconfig tsconfig.json src/lib/signOutRemote.test.ts
 */
import assert from "node:assert/strict";
import { getStoredMe, saveSession, signOutRemote } from "./auth";

const store = new Map<string, string>();
Object.defineProperty(globalThis, "window", { configurable: true, value: globalThis });
Object.defineProperty(globalThis, "sessionStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key)
  }
});

void (async () => {
  saveSession({ orgId: "o1", orgName: "Acme", plan: "pro" });
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; body: string }> = [];

  try {
    globalThis.fetch = (async (input, init) => {
      requests.push({ url: String(input), body: String(init?.body ?? "") });
      return new Response(null, { status: 503 });
    }) as typeof fetch;
    assert.equal(await signOutRemote(), false);
    assert.equal(getStoredMe()?.orgId, "o1");
    assert.deepEqual(requests, [
      { url: "/api/auth/logout", body: "" }
    ]);

    globalThis.fetch = (async () => {
      throw new Error("network unavailable");
    }) as typeof fetch;
    assert.equal(await signOutRemote(), false);
    assert.equal(getStoredMe()?.orgId, "o1");

    globalThis.fetch = (async () => new Response(null, { status: 200 })) as typeof fetch;
    assert.equal(await signOutRemote(), true);
    assert.equal(getStoredMe()?.orgId, "o1");
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log("signOutRemote.test.ts: ok");
})();
