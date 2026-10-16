import test from "node:test";
import assert from "node:assert/strict";
import { AUTH_RATE_LIMIT_MAX, AuthRateLimitStore, authClientKey, consumeAuthRateLimit, consumeAuthRequest, resetAuthRateLimitForTests } from "./authRateLimit";
import type { ServerConfig } from "../serverConfig";
import type { Pool } from "pg";
import type { ServerResponse } from "node:http";
import { handleUserAuthApiRequest, type UserAuthApiDeps } from "./userAuthApi";
import { loadAuthConfig } from "./authConfig";

const config = (nodeEnv: string): ServerConfig => ({ nodeEnv, requireApiAuth: true, devMode: true, jobsWorkersEnabled: false });
test("explicit local limiter exhausts then resets the fixed window", () => {
  resetAuthRateLimitForTests();
  for (let i = 0; i < AUTH_RATE_LIMIT_MAX; i++) assert.equal(consumeAuthRateLimit("peer", undefined, undefined, 100), true);
  assert.equal(consumeAuthRateLimit("peer", undefined, undefined, 101), false);
  assert.equal(consumeAuthRateLimit("peer", undefined, undefined, 900100), true);
});
test("untrusted forwarded and real IP headers never expand a socket peer budget", () => {
  for (let i = 1; i <= 30; i++) {
    assert.equal(authClientKey({ "x-forwarded-for": `198.51.100.${i}`, "x-real-ip": `203.0.113.${i}` }, "192.0.2.1"), "192.0.2.1");
  }
});
test("configured trusted proxies walk the forwarding chain from the socket toward the first untrusted peer", () => {
  assert.equal(authClientKey({ "x-forwarded-for": "198.51.100.9, 192.0.2.1, 10.0.0.2" }, "10.0.0.1", ["10.0.0.1", "10.0.0.2"]), "192.0.2.1");
  assert.equal(authClientKey({ "x-forwarded-for": "198.51.100.9" }, "::ffff:127.0.0.1", ["127.0.0.1"]), "198.51.100.9");
});
test("invalid, oversized or malformed forwarding chains fall back to the known socket, missing sockets cannot identify clients", () => {
  for (const raw of ["unknown", "1.2.3.4, garbage", "1.2.3.4:443", "1.2.3.4," , Array(22).fill("1.2.3.4").join(",")]) {
    assert.equal(authClientKey({ "x-forwarded-for": raw }, "10.0.0.1", ["10.0.0.1"]), "10.0.0.1");
  }
  assert.equal(authClientKey({ "x-forwarded-for": "1.2.3.4" }), undefined);
  assert.equal(authClientKey({}, "2001:0db8:0:0:0:0:0:1"), "2001:db8::1");
});
test("production cannot use memory fallback even with devMode, development requires explicit dev mode", async () => {
  await assert.rejects(consumeAuthRequest({ headers: {}, peerAddress: "127.0.0.1", serverConfig: config("production") }), /unavailable/);
  await assert.rejects(consumeAuthRequest({ headers: {}, peerAddress: "127.0.0.1", serverConfig: { ...config("development"), devMode: false } }), /unavailable/);
  assert.equal(await consumeAuthRequest({ headers: {}, peerAddress: "127.0.0.1", serverConfig: config("test") }), true);
});
test("memory state is bounded and expired peer slots are reclaimed", () => {
  resetAuthRateLimitForTests();
  for (let i = 0; i < 10_000; i++) assert.equal(consumeAuthRateLimit(`bounded-peer-${i}`, 1, 1, 100), true);
  assert.equal(consumeAuthRateLimit("another-peer", 1, 1, 100), false);
  assert.equal(consumeAuthRateLimit("another-peer", 1, 1, 102), true);
});

// Only the store outcome is controlled here. The actual request handler and
// consumeAuthRequest boundary run unchanged; PostgreSQL behavior has its own suite.
class ControlledRateStore extends AuthRateLimitStore {
  readonly keys: string[] = [];
  constructor(private readonly outcome: "allowed" | "denied" | "failed") {
    super(new Proxy({} as Pool, { get() { throw new Error("Route controls must not access PostgreSQL"); } }));
  }
  override async consume(key: string): Promise<boolean> {
    this.keys.push(key);
    if (this.outcome === "failed") throw new Error("synthetic private store failure");
    return this.outcome === "allowed";
  }
}

function routeFixture(outcome: "allowed" | "denied" | "failed", withStore = true) {
  const effects = { domainCalls: 0, passwordChecks: 0, sessions: 0, refreshTokens: 0 };
  const user = { id: "fixture-user", orgId: "fixture-org", role: "member", email: "user@fixture.invalid" };
  function domain<T extends object>(methods: Record<string, (...args: unknown[]) => unknown>): T {
    return new Proxy(methods, {
      get(target, property) {
        return (...args: unknown[]) => {
          effects.domainCalls++;
          const method = target[String(property)];
          assert.ok(method, `Unexpected domain operation: ${String(property)}`);
          return method(...args);
        };
      }
    }) as T;
  }
  const store = new ControlledRateStore(outcome);
  const deps: UserAuthApiDeps = {
    orgStore: domain<NonNullable<UserAuthApiDeps["orgStore"]>>({
      getOrganization: async () => ({ id: user.orgId, plan: "free", name: "Fixture" }),
      isOrgSuspended: async () => false
    }),
    userStore: domain<NonNullable<UserAuthApiDeps["userStore"]>>({
      findActiveUserByEmail: async () => user,
      createSession: async (userId, orgId) => {
        assert.equal(userId, user.id); assert.equal(orgId, user.orgId);
        effects.sessions++;
        return { token: "fixture-access", expiresAt: new Date("2030-01-01T00:00:00Z") };
      }
    }),
    authIdentityStore: domain<NonNullable<UserAuthApiDeps["authIdentityStore"]>>({ verifyPassword: async (userId, password) => {
      assert.equal(userId, user.id); assert.equal(password, "fixture-password");
      effects.passwordChecks++; return true;
    } }),
    authTokenStore: domain<NonNullable<UserAuthApiDeps["authTokenStore"]>>({ createToken: async (userId, purpose) => {
      assert.equal(userId, user.id); assert.equal(purpose, "refresh");
      effects.refreshTokens++; return "fixture-refresh";
    } }),
    authConfig: loadAuthConfig({}), serverConfig: config("production"),
    authRateLimitStore: withStore ? store : undefined
  };
  let status = 0;
  let body: Record<string, unknown> = {};
  const response = {
    writeHead(code: number) { status = code; return this; },
    end(value: string) { body = JSON.parse(value) as Record<string, unknown>; return this; }
  } as unknown as ServerResponse;
  const request = (pathname: string, peerAddress: string | undefined = "192.0.2.1"): Parameters<typeof handleUserAuthApiRequest>[0] => ({
    method: "POST", pathname, peerAddress,
    headers: { "x-forwarded-for": "198.51.100.9", "x-real-ip": "203.0.113.9" },
    body: { email: user.email, password: "fixture-password", token: "fixture-reset", orgName: "Fixture" }
  });
  return { deps, store, effects, response, request, result: () => ({ status, body }) };
}

const guardedRoutes = ["/v1/auth/login", "/v1/auth/register", "/v1/auth/forgot-password", "/v1/auth/reset-password"];

for (const scenario of ["exhausted", "failed store", "missing store", "missing peer"] as const) {
  test(`actual auth routes reject ${scenario} before any account or session operation`, async () => {
    for (const pathname of guardedRoutes) {
      const fixture = routeFixture(scenario === "exhausted" ? "denied" : scenario === "failed store" ? "failed" : "allowed", scenario !== "missing store");
      const request = fixture.request(pathname);
      if (scenario === "missing peer") request.peerAddress = undefined;
      assert.equal(await handleUserAuthApiRequest(request, fixture.response, fixture.deps), true);
      const result = fixture.result();
      assert.equal(result.status, scenario === "exhausted" ? 429 : 503, pathname);
      assert.equal(result.body.error, scenario === "exhausted" ? "rate_limited" : "auth_unavailable");
      assert.deepEqual(fixture.effects, { domainCalls: 0, passwordChecks: 0, sessions: 0, refreshTokens: 0 });
      assert.deepEqual(fixture.store.keys, scenario === "missing store" || scenario === "missing peer" ? [] : ["192.0.2.1"]);
      assert.doesNotMatch(JSON.stringify(result.body), /synthetic private store failure|fixture-access|fixture-refresh/);
    }
  });
}

test("actual production login with admitted socket peer reaches password verification and creates one session", async () => {
  const fixture = routeFixture("allowed");
  assert.equal(await handleUserAuthApiRequest(fixture.request("/v1/auth/login"), fixture.response, fixture.deps), true);
  assert.deepEqual(fixture.store.keys, ["192.0.2.1"]);
  assert.equal(fixture.effects.passwordChecks, 1);
  assert.equal(fixture.effects.sessions, 1);
  assert.equal(fixture.effects.refreshTokens, 1);
  const result = fixture.result();
  assert.equal(result.status, 200);
  assert.equal(result.body.accessToken, "fixture-access");
  assert.equal(result.body.refreshToken, "fixture-refresh");
  assert.equal(result.body.userId, "fixture-user");
});
