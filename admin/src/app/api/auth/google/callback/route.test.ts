import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "./route";

test("admin production callback keeps invitation errors on the canonical origin", async () => {
  const previous = Object.getOwnPropertyDescriptor(process.env, "NODE_ENV");
  Object.defineProperty(process.env, "NODE_ENV", { configurable: true, enumerable: true, writable: true, value: "production" });
  try {
    const response = await GET(new Request("https://attacker.example/api/auth/google/callback?error=access_denied", {
      headers: { cookie: "coop_oauth_invite=invite-123" }
    }));
    const target = new URL(response.headers.get("location")!);
    assert.equal(target.origin, "https://admin.coop-ai.dev");
    assert.equal(target.pathname, "/accept-invite");
    assert.equal(target.searchParams.get("token"), "invite-123");
  } finally {
    if (previous === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
    else Object.defineProperty(process.env, "NODE_ENV", previous);
  }
});

test("admin callback rejects mismatched browser state before exchange", async () => {
  const originalFetch = globalThis.fetch;
  let backendCalls = 0;
  globalThis.fetch = async () => {
    backendCalls++;
    throw new Error("Backend must not be called");
  };
  try {
    const response = await GET(new Request("http://localhost:3002/api/auth/google/callback?code=synthetic&state=from-google", {
      headers: { cookie: "coop_admin_oauth_state=other-browser; coop_oauth_invite=invite-123" }
    }));
    const target = new URL(response.headers.get("location")!);
    assert.equal(target.pathname, "/accept-invite");
    assert.equal(target.searchParams.get("error"), "invalid_state");
    assert.equal(backendCalls, 0);
    assert.match(response.headers.get("set-cookie") ?? "", /coop_admin_oauth_state=;/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("admin callback forwards matching state to backend exchange", async () => {
  const originalFetch = globalThis.fetch;
  let receivedState: string | undefined;
  globalThis.fetch = async (_input, init) => {
    receivedState = JSON.parse(String(init?.body)).state;
    return new Response(JSON.stringify({ error: "synthetic_failure" }), {
      status: 400,
      headers: { "content-type": "application/json" }
    });
  };
  try {
    const response = await GET(new Request("http://localhost:3002/api/auth/google/callback?code=synthetic&state=signed-state", {
      headers: { cookie: "coop_admin_oauth_state=signed-state" }
    }));
    assert.equal(receivedState, "signed-state");
    assert.equal(new URL(response.headers.get("location")!).searchParams.get("error"), "synthetic_failure");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
