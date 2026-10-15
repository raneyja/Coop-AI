import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "./route";

test("operator callback rejects mismatched browser state before backend exchange", async () => {
  const originalFetch = globalThis.fetch;
  let backendCalls = 0;
  globalThis.fetch = async () => {
    backendCalls++;
    throw new Error("Backend must not be called");
  };
  try {
    const request = new Request("http://localhost:3003/api/auth/google/callback?code=synthetic&state=from-google", {
      headers: { cookie: "coop_ops_oauth_state=other-browser" }
    });
    const response = await GET(request);
    assert.equal(new URL(response.headers.get("location")!).searchParams.get("error"), "invalid_state");
    assert.equal(backendCalls, 0);
    assert.match(response.headers.get("set-cookie") ?? "", /coop_ops_oauth_state=;/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("operator callback forwards matching state to backend exchange", async () => {
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
    const request = new Request("http://localhost:3003/api/auth/google/callback?code=synthetic&state=signed-state", {
      headers: { cookie: "coop_ops_oauth_state=signed-state" }
    });
    const response = await GET(request);
    assert.equal(receivedState, "signed-state");
    assert.equal(new URL(response.headers.get("location")!).searchParams.get("error"), "synthetic_failure");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
