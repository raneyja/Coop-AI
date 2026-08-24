import test from "node:test";
import assert from "node:assert/strict";
import {
  isUnauthenticatedApiError,
  verifyStoredSession,
  type SessionVerifierApi
} from "./verifyStoredSession";
import type { MeResponse } from "../api/CoopBackendClient";

const paidMe: MeResponse = {
  orgId: "org-paid",
  orgName: "Coop",
  plan: "pro",
  canUseLightning: true,
  email: "jon@coop-ai.dev"
};

function authError(status = 401): Error & { response: { status: number } } {
  const error = new Error("Request failed with status code 401") as Error & {
    response: { status: number };
  };
  error.response = { status };
  return error;
}

function mockApi(overrides: Partial<SessionVerifierApi> & Pick<SessionVerifierApi, "fetchMe">): SessionVerifierApi {
  return {
    hasToken: async () => true,
    getRefreshToken: async () => "refresh",
    refreshSession: async () => ({}),
    clearToken: async () => undefined,
    clearRefreshToken: async () => undefined,
    ...overrides
  };
}

test("isUnauthenticatedApiError detects axios 401", () => {
  assert.equal(isUnauthenticatedApiError(authError()), true);
  assert.equal(isUnauthenticatedApiError(new Error("fetch failed")), false);
});

test("verifyStoredSession returns /v1/me when the token is valid", async () => {
  const me = await verifyStoredSession(
    mockApi({ fetchMe: async () => paidMe }),
    "https://api.coop-ai.dev"
  );
  assert.equal(me?.plan, "pro");
  assert.equal(me?.email, "jon@coop-ai.dev");
});

test("verifyStoredSession refreshes then returns /v1/me after 401", async () => {
  let fetchCalls = 0;
  let refreshed = false;
  const me = await verifyStoredSession(
    mockApi({
      fetchMe: async () => {
        fetchCalls += 1;
        if (fetchCalls === 1) {
          throw authError();
        }
        return paidMe;
      },
      refreshSession: async () => {
        refreshed = true;
      }
    }),
    "https://api.coop-ai.dev"
  );
  assert.equal(refreshed, true);
  assert.equal(me?.plan, "pro");
});

test("verifyStoredSession signs out when the session cannot be refreshed", async () => {
  let clearedToken = false;
  let clearedRefresh = false;
  const me = await verifyStoredSession(
    mockApi({
      fetchMe: async () => {
        throw authError();
      },
      refreshSession: async () => {
        throw authError();
      },
      clearToken: async () => {
        clearedToken = true;
      },
      clearRefreshToken: async () => {
        clearedRefresh = true;
      }
    }),
    "https://api.coop-ai.dev"
  );
  assert.equal(me, undefined);
  assert.equal(clearedToken, true);
  assert.equal(clearedRefresh, true);
});

test("verifyStoredSession does not clear tokens on a network failure", async () => {
  let cleared = false;
  const me = await verifyStoredSession(
    mockApi({
      fetchMe: async () => {
        throw new Error("fetch failed");
      },
      clearToken: async () => {
        cleared = true;
      },
      clearRefreshToken: async () => {
        cleared = true;
      }
    }),
    "https://api.coop-ai.dev"
  );
  assert.equal(me, undefined);
  assert.equal(cleared, false);
});

test("verifyStoredSession returns undefined when no token is stored", async () => {
  const me = await verifyStoredSession(
    mockApi({
      hasToken: async () => false,
      fetchMe: async () => {
        throw new Error("should not fetch");
      }
    }),
    "https://api.coop-ai.dev"
  );
  assert.equal(me, undefined);
});
