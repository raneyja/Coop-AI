import test from "node:test";
// Fresh suite-bound actual Docker admission must precede all database constructors.
const {publicationDatabaseFromEnvironment} = require('../../../scripts/publication-test-fixture.mjs');
const releaseDatabase: string = publicationDatabaseFromEnvironment(process.env, 'saml');
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import pg from "pg";
import { OrgStore } from "../orgStore";
import { UserStore } from "../users/userStore";
import { SsoConfigStore } from "./ssoConfigStore";
import { PostgresSamlRequestStore, type SamlLoginRequest } from "./samlRequestStore";
import { SamlService } from "./samlService";
import type { ServerConfig } from "../serverConfig";
import type { AuthConfig } from "../auth/authConfig";
import { TEST_IDP_CERT, TEST_IDP_ENTITY_ID, TEST_IDP_SSO_URL, TEST_SAML_BASE_URL,
  createSignedSamlResponse, startSamlHttpServer, type SignedSamlResponseOptions } from "./samlTestFixtures";

const databaseUrl = releaseDatabase;
test("real SAML library + HTTP handlers + two PostgreSQL replica stores", async t => {
  const pools = [new pg.Pool({ connectionString: databaseUrl }), new pg.Pool({ connectionString: databaseUrl })];
  const identity = await pools[0].query("SELECT current_database() AS db, current_user AS actor");
  assert.deepEqual(identity.rows[0], { db: "eh02_disposable", actor: "eh02" });
  const orgStore = new OrgStore(pools[0]);
  const userStore = new UserStore(pools[0]);
  const configs = new SsoConfigStore(pools[0]);
  const orgA = await orgStore.createOrganization(`EH03 A ${randomUUID()}`, "enterprise");
  const orgB = await orgStore.createOrganization(`EH03 B ${randomUUID()}`, "enterprise");
  for (const org of [orgA, orgB]) await configs.upsertConfig(org.id, {
    provider: "saml", idpEntityId: TEST_IDP_ENTITY_ID, idpSsoUrl: TEST_IDP_SSO_URL, idpX509Cert: TEST_IDP_CERT
  });
  const serverConfig = { requireApiAuth: true, ssoSessionTtlMs: 43200000 } as ServerConfig;
  const authConfig = { adminPortalUrl: "https://admin.coop-ai.dev", marketingBaseUrl: "https://coop-ai.dev" } as AuthConfig;
  const servers = await Promise.all(pools.map(pool => startSamlHttpServer({ orgStore: new OrgStore(pool),
    userStore: new UserStore(pool), ssoConfigStore: new SsoConfigStore(pool),
    samlService: new SamlService({ baseUrl: TEST_SAML_BASE_URL, requestStore: new PostgresSamlRequestStore(pool) }),
    serverConfig, authConfig })));
  type Login = { relay: string; cookie: string; requestId: string; handoff: string };
  async function start(orgId = orgA.id, mode = "login", redirect = "", browser = 1): Promise<Login> {
    const response = await fetch(`${servers[0].base}/v1/auth/saml/start?${new URLSearchParams({ orgId, mode, redirect, format: "json" })}`);
    assert.equal(response.status, 200);
    const handoff = new URL((await response.json() as { redirectUrl: string }).redirectUrl);
    assert.equal(handoff.origin, TEST_SAML_BASE_URL);
    const continued = await fetch(`${servers[browser].base}${handoff.pathname}${handoff.search}`, { redirect: "manual" });
    assert.equal(continued.status, 302);
    assert.match(continued.headers.get("set-cookie")!, /HttpOnly; Secure; SameSite=None/);
    assert.equal(continued.headers.get("referrer-policy"), "no-referrer");
    const url = new URL(continued.headers.get("location")!);
    const xml = inflateRawSync(Buffer.from(url.searchParams.get("SAMLRequest")!, "base64")).toString();
    return { relay: url.searchParams.get("RelayState")!, cookie: continued.headers.get("set-cookie")!.split(";")[0],
      requestId: /ID="([^"]+)"/.exec(xml)![1], handoff: handoff.pathname + handoff.search };
  }
  async function callback(login: Login, options: SignedSamlResponseOptions = {}, replica = 1, raw?: string, base = servers[replica].base) {
    return fetch(`${base}/v1/auth/saml/callback`, { method: "POST", redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: login.cookie },
      body: new URLSearchParams({ RelayState: login.relay,
        SAMLResponse: raw ?? createSignedSamlResponse({ requestId: login.requestId, ...options }) }) });
  }
  async function effects() {
    const result = await pools[0].query(`SELECT
      (SELECT count(*)::int FROM users WHERE org_id=ANY($1::uuid[])) AS users,
      (SELECT count(*)::int FROM user_sessions WHERE org_id=ANY($1::uuid[])) AS sessions`, [[orgA.id, orgB.id]]);
    return result.rows[0];
  }
  async function negative(name: string, options: SignedSamlResponseOptions) {
    await t.test(name, async () => {
      const before = await effects(), login = await start();
      assert.equal((await callback(login, options)).status, 401);
      assert.deepEqual(await effects(), before);
      // Invalid signatures/bindings must not poison the legitimate pending login.
      assert.equal((await callback(login)).status, 200);
    });
  }
  try {
    await t.test("supported SP login on another replica; replay rejected", async () => {
      const login = await start();
      const response = await callback(login);
      assert.equal(response.status, 200);
      const token = (await response.json() as { accessToken: string }).accessToken;
      const session = await userStore.resolveUserSession(token);
      assert.equal(session?.orgId, orgA.id); assert.equal(session?.role, "member");
      const before = await effects();
      assert.equal((await callback(login, {}, 0)).status, 400);
      assert.deepEqual(await effects(), before);
    });
    await negative("wrong response request ID", { requestId: "_never_issued" });
    await negative("wrong signed subject request ID", { subjectRequestId: "_different_request" });
    await negative("missing signed subject request ID", { omitSubjectRequestId: true });
    await negative("wrong signed issuer", { idpEntityId: "https://foreign.example/idp" });
    await negative("wrong signed audience", { spEntityId: "https://foreign.example/sp" });
    await negative("wrong signed recipient", { acsUrl: "https://foreign.example/callback" });
    await negative("expired signed assertion", { notOnOrAfter: new Date(Date.now() - 60000).toISOString() });
    const wrongKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    await negative("assertion signed with a foreign key fails the configured trust anchor", { signingPrivateKey: wrongKey });
    await t.test("invalid signature does not consume valid pending state", async () => {
      const before = await effects(), login = await start();
      const good = createSignedSamlResponse({ requestId: login.requestId });
      const forged = Buffer.from(Buffer.from(good, "base64").toString().replace("sso-test@demo.local", "evil@demo.local")).toString("base64");
      assert.equal((await callback(login, {}, 1, forged)).status, 401);
      assert.deepEqual(await effects(), before);
      assert.equal((await callback(login, {}, 0, good)).status, 200);
    });
    await t.test("missing/bare/JSON/forged RelayState and wrong browser cookie", async () => {
      const before = await effects(), login = await start();
      for (const relay of ["", orgA.id, Buffer.from(JSON.stringify({ orgId: orgA.id, mode: "login" })).toString("base64url"), "x".repeat(43)]) {
        assert.equal((await callback({ ...login, relay })).status, 400);
      }
      assert.equal((await callback({ ...login, cookie: "" })).status, 400);
      assert.equal((await callback({ ...login, cookie: `${login.cookie.split("=")[0]}=${"x".repeat(43)}` })).status, 400);
      assert.deepEqual(await effects(), before);
      assert.equal((await callback(login)).status, 200);
    });
    await t.test("wrong tenant with another issued state cannot accept assertion", async () => {
      const a = await start(orgA.id), b = await start(orgB.id), before = await effects();
      const body = createSignedSamlResponse({ requestId: a.requestId });
      assert.equal((await callback(b, {}, 1, body)).status, 401);
      assert.deepEqual(await effects(), before);
      assert.equal((await callback(a, {}, 0, body)).status, 200);
    });
    await t.test("expired durable request rejected on both replicas", async () => {
      const login = await start(), before = await effects();
      await pools[0].query("UPDATE saml_login_requests SET expires_at=NOW()-INTERVAL '1 minute' WHERE request_id=$1", [login.requestId]);
      assert.equal((await callback(login)).status, 400);
      assert.equal((await callback(login, {}, 0)).status, 400);
      assert.deepEqual(await effects(), before);
    });
    async function waitFor(check: () => Promise<boolean>, message: string) {
      const deadline = Date.now() + 4000;
      while (Date.now() < deadline) {
        if (await check()) return;
        await new Promise(resolve => setTimeout(resolve, 15));
      }
      assert.fail(message);
    }
    for (const lockKind of ["eligibility", "request"] as const) {
    for (const deadline of ["request", "assertion", "unexpired"] as const) {
      await t.test(`${deadline} after actual ${lockKind} lock wait enforces current admission time`, async () => {
        const login = await start(), before = await effects();
        // Zero skew is scoped to this expiry fixture; production retains its 5s allowance.
        const race = await startSamlHttpServer({ orgStore, userStore, ssoConfigStore: configs,
          samlService: new SamlService({ baseUrl: TEST_SAML_BASE_URL, acceptedClockSkewMs: 0,
            requestStore: new PostgresSamlRequestStore(pools[1]) }), serverConfig, authConfig });
        const lock = await pools[0].connect();
        let pending: Promise<Response> | undefined;
        try {
          const expiry = new Date(Date.now() + 1200);
          if (deadline === "request") await pools[0].query(
            "UPDATE saml_login_requests SET expires_at=$2 WHERE request_id=$1", [login.requestId, expiry]);
          await lock.query("BEGIN");
          if (lockKind === "eligibility") await lock.query("SELECT org_id FROM org_sso_config WHERE org_id=$1 FOR UPDATE", [orgA.id]);
          else await lock.query("SELECT request_id FROM saml_login_requests WHERE request_id=$1 FOR UPDATE", [login.requestId]);
          const blocker = (await lock.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
          pending = callback(login, { email: `wait-${randomUUID()}@demo.local`,
            ...(deadline === "assertion" ? { notOnOrAfter: expiry.toISOString() } : {}) }, 1, undefined, race.base);
          await waitFor(async () => (await pools[0].query(
            "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid)) AND query LIKE '%FOR UPDATE%') AS blocked",
            [blocker])).rows[0].blocked, "acceptance must actually wait on the controlled database row lock");
          await waitFor(async () => (await pools[0].query(
            "SELECT clock_timestamp() > $1::timestamptz AS expired", [expiry])).rows[0].expired,
          "controlled deadline must pass before releasing row lock");
          await lock.query("COMMIT");
          const response = await pending;
          if (deadline === "unexpired") {
            assert.equal(response.status, 200);
            assert.ok(await userStore.resolveUserSession((await response.json() as { accessToken: string }).accessToken));
          } else {
            assert.equal(response.status, 401);
            assert.deepEqual(await effects(), before);
            assert.equal((await pools[0].query(
              "SELECT count(*)::int AS n FROM saml_login_requests WHERE request_id=$1", [login.requestId])).rows[0].n, 1);
            if (deadline === "assertion") assert.equal((await callback(login)).status, 200);
          }
        } finally {
          await lock.query("ROLLBACK"); lock.release();
          if (pending) await pending;
          await race.close();
        }
      });
    }
    }
    for (const deadline of ["request", "assertion"] as const) {
      await t.test(`${deadline} expiring after session insert rolls back all durable effects`, async () => {
        const login = await start(), before = await effects(), expiry = new Date(Date.now() + 1200);
        if (deadline === "request") await pools[0].query(
          "UPDATE saml_login_requests SET expires_at=$2 WHERE request_id=$1", [login.requestId, expiry]);
        class DelayingUserStore extends UserStore {
          public override async createSession(...args: Parameters<UserStore["createSession"]>): Promise<Awaited<ReturnType<UserStore["createSession"]>>> {
            const session = await super.createSession(...args);
            await waitFor(async () => (await pools[0].query(
              "SELECT clock_timestamp() > $1::timestamptz AS expired", [expiry])).rows[0].expired,
            "deadline must pass after the real uncommitted session insert");
            return session;
          }
        }
        const race = await startSamlHttpServer({ orgStore, userStore: new DelayingUserStore(pools[0]), ssoConfigStore: configs,
          samlService: new SamlService({ baseUrl: TEST_SAML_BASE_URL, acceptedClockSkewMs: 0,
            requestStore: new PostgresSamlRequestStore(pools[1]) }), serverConfig, authConfig });
        try {
          assert.equal((await callback(login, { email: `late-${randomUUID()}@demo.local`,
            ...(deadline === "assertion" ? { notOnOrAfter: expiry.toISOString() } : {}) }, 1, undefined, race.base)).status, 401);
          assert.deepEqual(await effects(), before);
          assert.equal((await pools[0].query(
            "SELECT count(*)::int AS n FROM saml_login_requests WHERE request_id=$1", [login.requestId])).rows[0].n, 1);
          if (deadline === "assertion") assert.equal((await callback(login)).status, 200);
        } finally { await race.close(); }
      });
    }
    await t.test("concurrent valid callbacks accept exactly one session", async () => {
      const login = await start(), before = await effects();
      const responses = await Promise.all([callback(login, {}, 0), callback(login, {}, 1)]);
      assert.equal(responses.filter(r => r.status === 200).length, 1);
      const after = await effects(); assert.equal(after.sessions, before.sessions + 1);
    });
    await t.test("parallel browser tabs preserve independent cookies and request bindings", async () => {
      const a = await start(), b = await start();
      assert.notEqual(a.cookie.split("=")[0], b.cookie.split("=")[0]);
      const cookie = `${a.cookie}; ${b.cookie}`;
      assert.equal((await callback({ ...a, cookie }, {}, 0)).status, 200);
      assert.equal((await callback({ ...b, cookie }, {}, 1)).status, 200);
    });
    await t.test("continue can bind only once and cannot replace browser nonce", async () => {
      const login = await start();
      const second = await fetch(`${servers[0].base}${login.handoff}`, { redirect: "manual" });
      assert.equal(second.status, 400); assert.equal(second.headers.get("set-cookie"), null);
      assert.equal((await callback(login)).status, 200);
    });
    await t.test("unsafe redirects rejected and exact approved return preserved", async () => {
      for (const redirect of ["https://evil.example/", "vscode://evil.extension/auth/callback", "vscode://coop-ai.coop-ai/wrong", "https://user:pass@admin.coop-ai.dev/auth/callback", "https://admin.coop-ai.dev/auth/callback#injected"]) {
        const response = await fetch(`${servers[0].base}/v1/auth/saml/start?${new URLSearchParams({ orgId: orgA.id, redirect, format: "json" })}`);
        assert.equal(response.status, 400);
      }
      const redirect = "https://admin.coop-ai.dev/auth/callback?fixture=preserved";
      const response = await callback(await start(orgA.id, "login", redirect));
      assert.equal(response.status, 302);
      assert.equal(response.headers.get("location")!.split("#")[0], redirect);
    });
    await t.test("stored test mode cannot be promoted to login by unsigned form fields", async () => {
      const login = await start(orgA.id, "test"), before = await effects();
      const response = await fetch(`${servers[0].base}/v1/auth/saml/callback`, { method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", cookie: login.cookie },
        body: new URLSearchParams({ RelayState: login.relay, SAMLResponse: createSignedSamlResponse({ requestId: login.requestId }), mode: "login", orgId: orgB.id, redirect: "https://evil.example/" }) });
      assert.equal(response.status, 200); assert.equal((await response.json() as { result: string }).result, "passed");
      assert.deepEqual(await effects(), before);
    });
    await t.test("config rotation revokes pending request without identity effects", async () => {
      const login = await start(), before = await effects();
      await configs.upsertConfig(orgA.id, { provider: "saml", idpEntityId: TEST_IDP_ENTITY_ID,
        idpSsoUrl: TEST_IDP_SSO_URL, idpX509Cert: TEST_IDP_CERT });
      assert.equal((await callback(login)).status, 401);
      assert.deepEqual(await effects(), before);
    });
    await t.test("same subject in another tenant does not inherit admin or membership", async () => {
      const admin = await userStore.findOrgUserByEmail(orgA.id, "sso-test@demo.local");
      await userStore.setUserRole(admin!.id, "admin");
      const login = await start(orgB.id);
      const response = await callback(login);
      assert.equal(response.status, 200);
      const token = (await response.json() as { accessToken: string }).accessToken;
      const other = await userStore.resolveUserSession(token);
      assert.equal(other?.orgId, orgB.id); assert.equal(other?.role, "member"); assert.notEqual(other?.userId, admin!.id);
      const memberships = await pools[0].query("SELECT org_id FROM org_memberships WHERE user_id=$1", [admin!.id]);
      assert.deepEqual(memberships.rows.map(row => row.org_id), [orgA.id]);
      assert.equal((await userStore.getUser(admin!.id))?.role, "admin");
    });
    for (const change of ["disable", "rotate", "plan", "suspend"]) {
      await t.test(`current ${change} at verified admission boundary prevents all identity/session effects`, async () => {
        const login = await start(), before = await effects();
        class RevokingStore extends PostgresSamlRequestStore {
          public override async accept<T>(state: SamlLoginRequest, work: (client?: pg.PoolClient) => Promise<T>): Promise<T> {
            if (change === "disable") await configs.setEnabled(orgA.id, false);
            else if (change === "rotate") await configs.upsertConfig(orgA.id, { provider: "saml",
              idpEntityId: TEST_IDP_ENTITY_ID, idpSsoUrl: TEST_IDP_SSO_URL, idpX509Cert: TEST_IDP_CERT });
            else if (change === "plan") await orgStore.setOrganizationPlan(orgA.id, "free");
            else await pools[0].query("UPDATE organizations SET operator_status='suspended' WHERE id=$1", [orgA.id]);
            return super.accept(state, work);
          }
        }
        const race = await startSamlHttpServer({ orgStore, userStore, ssoConfigStore: configs,
          samlService: new SamlService({ baseUrl: TEST_SAML_BASE_URL, requestStore: new RevokingStore(pools[1]) }), serverConfig, authConfig });
        try {
          assert.equal((await callback(login, {}, 1, undefined, race.base)).status, 401);
          assert.deepEqual(await effects(), before);
        } finally {
          await race.close();
          await configs.setEnabled(orgA.id, true);
          await orgStore.setOrganizationPlan(orgA.id, "enterprise");
          await pools[0].query("UPDATE organizations SET operator_status='active' WHERE id=$1", [orgA.id]);
        }
      });
    }
    await t.test("disable waits for atomic session effects; completed disable invalidates accepted session", async () => {
      const login = await start();
      let admit!: () => void, resume!: () => void;
      const admitted = new Promise<void>(resolve => { admit = resolve; });
      const resumed = new Promise<void>(resolve => { resume = resolve; });
      class BlockingStore extends PostgresSamlRequestStore {
        public override async accept<T>(state: SamlLoginRequest, work: (client?: pg.PoolClient) => Promise<T>): Promise<T> {
          return super.accept(state, async client => { admit(); await resumed; return work(client); });
        }
      }
      const race = await startSamlHttpServer({ orgStore, userStore, ssoConfigStore: configs,
        samlService: new SamlService({ baseUrl: TEST_SAML_BASE_URL, requestStore: new BlockingStore(pools[1]) }), serverConfig, authConfig });
      try {
        const pending = callback(login, {}, 1, undefined, race.base);
        await admitted;
        let disabled = false;
        const disabling = configs.setEnabled(orgA.id, false).then(() => { disabled = true; });
        await new Promise(resolve => setTimeout(resolve, 50));
        assert.equal(disabled, false, "configuration update cannot commit inside the acceptance transaction");
        resume();
        const response = await pending; assert.equal(response.status, 200);
        const token = (await response.json() as { accessToken: string }).accessToken;
        await disabling;
        assert.equal(await userStore.resolveUserSession(token), undefined);
      } finally { resume(); await race.close(); await configs.setEnabled(orgA.id, true); }
    });
    await t.test("later configuration rotation invalidates previously accepted SAML session", async () => {
      const response = await callback(await start()); assert.equal(response.status, 200);
      const token = (await response.json() as { accessToken: string }).accessToken;
      assert.ok(await userStore.resolveUserSession(token));
      await configs.upsertConfig(orgA.id, { provider: "saml", idpEntityId: TEST_IDP_ENTITY_ID,
        idpSsoUrl: TEST_IDP_SSO_URL, idpX509Cert: TEST_IDP_CERT });
      assert.equal(await userStore.resolveUserSession(token), undefined);
    });
    await t.test("fault after real session insert rolls back identity, session and consume together", async () => {
      const login = await start(), before = await effects();
      class FailingUserStore extends UserStore {
        public override async createSession(...args: Parameters<UserStore["createSession"]>): Promise<Awaited<ReturnType<UserStore["createSession"]>>> {
          await super.createSession(...args);
          throw new Error("controlled fault after session effect");
        }
      }
      const fault = await startSamlHttpServer({ orgStore, userStore: new FailingUserStore(pools[0]),
        ssoConfigStore: configs, samlService: new SamlService({ baseUrl: TEST_SAML_BASE_URL,
          requestStore: new PostgresSamlRequestStore(pools[1]) }), serverConfig, authConfig });
      const options = { email: `atomic-${randomUUID()}@demo.local` };
      try {
        assert.equal((await callback(login, options, 1, undefined, fault.base)).status, 500);
        assert.deepEqual(await effects(), before);
        assert.equal((await pools[0].query("SELECT count(*)::int AS n FROM saml_login_requests WHERE request_id=$1", [login.requestId])).rows[0].n, 1);
        assert.equal((await callback(login, options)).status, 200);
        const after = await effects(); assert.equal(after.users, before.users + 1); assert.equal(after.sessions, before.sessions + 1);
      } finally { await fault.close(); }
    });
    await t.test("authenticated tenant subject offboard leaves foreign user and session active", async () => {
      const responseA = await callback(await start(orgA.id)), responseB = await callback(await start(orgB.id));
      const tokenA = (await responseA.json() as { accessToken: string }).accessToken;
      const tokenB = (await responseB.json() as { accessToken: string }).accessToken;
      const personB = await userStore.findOrgUserByEmail(orgB.id, "sso-test@demo.local");
      const key = await orgStore.createApiKey(orgA.id, "EH03 controlled offboard");
      const offboard = async (body: unknown) => fetch(`${servers[0].base}/v1/auth/saml/offboard`, {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key.rawKey}` }, body: JSON.stringify(body) });
      assert.equal((await offboard({ userId: personB!.id })).status, 404);
      assert.equal((await offboard({ idpSubject: "sso-test@demo.local" })).status, 200);
      assert.equal(await userStore.resolveUserSession(tokenA), undefined);
      assert.ok(await userStore.resolveUserSession(tokenB));
      assert.equal((await userStore.getUser(personB!.id))?.deactivatedAt, undefined);
      assert.equal((await pools[0].query("SELECT count(*)::int AS n FROM user_sessions s JOIN users u ON u.id=s.user_id WHERE u.org_id=$1 AND u.idp_subject=$2", [orgA.id, "sso-test@demo.local"])).rows[0].n, 0);
    });
    await t.test("deactivated local identity cannot be reactivated by SAML", async () => {
      const person = await userStore.findOrgUserByEmail(orgB.id, "sso-test@demo.local");
      await pools[0].query("UPDATE users SET deactivated_at=NOW() WHERE id=$1", [person!.id]);
      const login = await start(orgB.id), before = await effects();
      assert.equal((await callback(login)).status, 403);
      assert.deepEqual(await effects(), before);
      assert.ok((await userStore.getUser(person!.id))?.deactivatedAt);
    });
    await t.test("suspended org cannot start or finish pending login", async () => {
      const login = await start(), before = await effects();
      await pools[0].query("UPDATE organizations SET operator_status='suspended' WHERE id=$1", [orgA.id]);
      assert.equal((await callback(login)).status, 403);
      const response = await fetch(`${servers[0].base}/v1/auth/saml/start?orgId=${orgA.id}&format=json`);
      assert.equal(response.status, 403); assert.deepEqual(await effects(), before);
    });
  } finally {
    await Promise.all(servers.map(server => server.close()));
    await Promise.all(pools.map(pool => pool.end()));
  }
});
