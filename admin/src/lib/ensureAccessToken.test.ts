/**
 * ensureAccessToken must hydrate from the session cookie before failing closed.
 * Run: cd admin && npx tsx --tsconfig tsconfig.json src/lib/ensureAccessToken.test.ts
 */
import assert from "node:assert/strict";
import { clearSession, ensureAccessToken, saveSession } from "./auth";

const TOKEN_KEY = "coop_admin_api_token";

type StorageMap = Map<string, string>;

function installSessionStorage(store: StorageMap): void {
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    }
  };
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: storage
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: globalThis
  });
}

void (async () => {
  const store: StorageMap = new Map();
  installSessionStorage(store);

  // Already has a tab token — no network.
  saveSession(
    "tab-token",
    { orgId: "o1", orgName: "Acme", plan: "pro", role: "admin" },
    undefined,
    "refresh"
  );
  const existing = await ensureAccessToken();
  assert.equal(existing, "tab-token");

  // Missing tab token — restore from cookie endpoint.
  clearSession();
  assert.equal(store.get(TOKEN_KEY), undefined);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        accessToken: "cookie-token",
        refreshToken: "cookie-refresh",
        orgId: "o1",
        orgName: "Acme",
        plan: "pro",
        role: "admin"
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )) as typeof fetch;

  const restored = await ensureAccessToken();
  assert.equal(restored, "cookie-token");
  assert.equal(store.get(TOKEN_KEY), "cookie-token");

  // Cookie restore fails — stay signed out (no false success).
  clearSession();
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: "unauthorized", message: "Not signed in." }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    })) as typeof fetch;
  const missing = await ensureAccessToken();
  assert.equal(missing, null);

  globalThis.fetch = originalFetch;
  console.log("ensureAccessToken.test.ts: ok");
})();
