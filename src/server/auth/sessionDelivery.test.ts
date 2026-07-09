import test from "node:test";
import assert from "node:assert/strict";
import type { ServerResponse } from "node:http";
import {
  deliverAuthError,
  deliverSessionToken,
  sanitizeAuthRedirect
} from "./sessionDelivery";

function mockRedirectResponse(): {
  response: ServerResponse;
  state: { statusCode?: number; location?: string; body?: string };
} {
  const state: { statusCode?: number; location?: string; body?: string } = {};
  const response = {
    writeHead(statusCode: number, headers?: Record<string, string>) {
      state.statusCode = statusCode;
      state.location = headers?.location;
    },
    end(payload?: string) {
      state.body = payload;
    }
  } as ServerResponse;
  return { response, state };
}

test("sanitizeAuthRedirect allows vscode, https, and local http", () => {
  assert.equal(
    sanitizeAuthRedirect("vscode://coop-ai.coop-ai/auth/callback"),
    "vscode://coop-ai.coop-ai/auth/callback"
  );
  assert.equal(
    sanitizeAuthRedirect("vscode-insiders://coop-ai.coop-ai/auth/callback"),
    "vscode-insiders://coop-ai.coop-ai/auth/callback"
  );
  assert.equal(
    sanitizeAuthRedirect("https://admin.coop-ai.dev/auth/callback"),
    "https://admin.coop-ai.dev/auth/callback"
  );
  assert.equal(
    sanitizeAuthRedirect("http://localhost:3000/auth/callback"),
    "http://localhost:3000/auth/callback"
  );
});

test("sanitizeAuthRedirect rejects unsafe schemes", () => {
  assert.equal(sanitizeAuthRedirect("javascript:alert(1)"), undefined);
  assert.equal(sanitizeAuthRedirect("file:///etc/passwd"), undefined);
  assert.equal(sanitizeAuthRedirect(""), undefined);
  assert.equal(sanitizeAuthRedirect("not-a-url"), undefined);
});

test("deliverAuthError redirects vscode URIs to callback fragment", () => {
  const { response, state } = mockRedirectResponse();
  deliverAuthError(
    response,
    "vscode://coop-ai.coop-ai/auth/callback",
    "saml_failed",
    "Assertion was rejected."
  );
  assert.equal(state.statusCode, 302);
  assert.equal(
    state.location,
    "vscode://coop-ai.coop-ai/auth/callback#error=saml_failed&message=Assertion+was+rejected."
  );
});

test("deliverAuthError redirects browser flows to portal login", () => {
  const { response, state } = mockRedirectResponse();
  deliverAuthError(
    response,
    "https://admin.coop-ai.dev/auth/callback",
    "saml_failed",
    "Assertion was rejected."
  );
  assert.equal(state.statusCode, 302);
  const url = new URL(state.location!);
  assert.equal(url.pathname, "/login");
  assert.equal(url.searchParams.get("error"), "saml_failed");
  assert.equal(url.searchParams.get("message"), "Assertion was rejected.");
});

test("deliverSessionToken appends coopToken to redirect fragment", () => {
  const { response, state } = mockRedirectResponse();
  deliverSessionToken(response, "access-token-123", "vscode://coop-ai.coop-ai/auth/callback", "refresh-456");
  assert.equal(state.statusCode, 302);
  assert.equal(
    state.location,
    "vscode://coop-ai.coop-ai/auth/callback#coopToken=access-token-123&coopRefresh=refresh-456"
  );
});

test("deliverAuthError falls back to JSON without redirect", () => {
  const { response, state } = mockRedirectResponse();
  deliverAuthError(response, undefined, "saml_failed", "No redirect configured.", 403);
  assert.equal(state.statusCode, 403);
  assert.deepEqual(JSON.parse(state.body!), {
    error: "saml_failed",
    message: "No redirect configured."
  });
});
