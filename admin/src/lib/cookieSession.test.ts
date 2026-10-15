/** Run: cd admin && npx tsx --tsconfig tsconfig.json src/lib/cookieSession.test.ts */
import assert from "node:assert/strict";
import { clearSession, getStoredMe, restoreSessionFromCookie, saveSession } from "./auth";

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
  const originalFetch = globalThis.fetch;
  try {
    store.set("coop_admin_api_token", "legacy-access");
    store.set("coop_admin_refresh_token", "legacy-refresh");
    store.set("coop_admin_me", JSON.stringify({ email: "old@example.test" }));
    globalThis.fetch = (async (input) => {
      assert.equal(input, "/api/auth/session");
      return Response.json({ orgId: "o1", orgName: "Acme", plan: "pro", email: "new@example.test" });
    }) as typeof fetch;

    const restored = await restoreSessionFromCookie();
    assert.equal(restored?.email, "new@example.test");
    assert.equal(getStoredMe()?.orgId, "o1");
    assert.equal(store.has("coop_admin_api_token"), false);
    assert.equal(store.has("coop_admin_refresh_token"), false);
    assert.equal(store.has("coop_admin_me"), false);

    saveSession({ orgId: "o2", orgName: "Beta", plan: "free" });
    assert.equal(getStoredMe()?.orgId, "o2");
    assert.equal(store.size, 0);

    globalThis.fetch = (async () => Response.json({ error: "unauthorized" }, { status: 401 })) as typeof fetch;
    assert.equal(await restoreSessionFromCookie(), null);
    assert.equal(getStoredMe(), null);

    clearSession();
  } finally {
    globalThis.fetch = originalFetch;
  }
  console.log("cookieSession.test.ts: ok");
})();
