import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "./route";

test("operator Google start binds the signed state to a browser cookie", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, {
    status: 302,
    headers: { location: "https://accounts.google.com/o/oauth2/v2/auth?state=signed-state" }
  });
  try {
    const response = await GET(new Request("http://localhost:3003/api/auth/google/start"));
    assert.equal(new URL(response.headers.get("location")!).searchParams.get("state"), "signed-state");
    assert.match(response.headers.get("set-cookie") ?? "", /coop_ops_oauth_state=signed-state/);
    assert.match(response.headers.get("set-cookie") ?? "", /HttpOnly/i);
    assert.match(response.headers.get("set-cookie") ?? "", /SameSite=lax/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("operator Google start refuses non-Google authorization redirects", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, {
    status: 302,
    headers: { location: "https://evil.example/o/oauth2/v2/auth?state=wrong" }
  });
  try {
    const response = await GET(new Request("http://localhost:3003/api/auth/google/start"));
    assert.equal(new URL(response.headers.get("location")!).searchParams.get("error"), "invalid_authorize_response");
    assert.doesNotMatch(response.headers.get("set-cookie") ?? "", /coop_ops_oauth_state=/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
