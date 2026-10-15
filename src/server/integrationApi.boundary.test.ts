import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { handleIntegrationApiRequest, resolveOrgIntegrationAccessToken, type IntegrationApiDeps } from "./integrationApi";
import type { AuthContext } from "./orgStore";
import type { IntegrationProvider } from "./integrationConnectionStore";
import { CoopBackendClient } from "../api/CoopBackendClient";
import { createSlackClientFromCredentials, createJiraClientFromCredentials, createConfluenceClientFromCredentials,
  createNotionClientFromCredentials, createGoogleDocsClientFromCredentials, createTeamsClientFromCredentials } from "../api/integrations/buildIntegrationClients";
import type { IntegrationCredentials } from "../api/integrations/integrationSecrets";
import { resolveActorIntegrationScope } from "./resolveIntegrationScope";
import type { IntegrationScopePolicyStore } from "./integrationScopePolicyStore";
import { fetchIntegrationResponse } from "../api/integrations/integrationHttp";
import { resolveAuthContextDetailed } from "./authMiddleware";

const sharedToken = "synthetic-shared-token-never-real";
const realFetch = globalThis.fetch;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const policies: Record<IntegrationProvider, object> = {
  slack: { version: 1, mode: "allowlist", channels: [{ id: "C1", name: "eng" }, { id: "C2", name: "ops" }] },
  atlassian: { version: 1, mode: "allowlist", jiraProjects: [{ id: "P1", key: "APP", name: "App" }], confluenceSpaces: [{ id: "S1", key: "ENG", name: "Engineering" }] },
  notion: { version: 1, mode: "allowlist", resources: [{ id: "page1", type: "page", title: "Decision" }] },
  "google-docs": { version: 1, mode: "allowlist", folders: [{ id: "F1", name: "Engineering", kind: "folder" }], expandedFolderIds: ["F1"] },
  teams: { version: 1, mode: "allowlist", channels: [{ id: "C1", name: "Eng", teamId: "T1" }, { id: "C2", name: "Ops", teamId: "T2" }] }
};
function actor(token: string): AuthContext | undefined {
  if (!["member1", "member2", "admin", "other-org", "automation"].includes(token)) return undefined;
  return { orgId: token === "other-org" ? "B" : "A", orgName: "fixture", plan: "enterprise", apiKeyId: token,
    userId: token === "automation" ? undefined : token, role: token === "admin" ? "admin" : "member" };
}
async function harness(run: (h: {
  base: string; client: CoopBackendClient; creds: IntegrationCredentials;
  requests: string[]; state: { disconnected: boolean; revoked: boolean; policy?: object; expired: boolean; onPolicyRead?: () => Promise<void>; providerReply?: (url: URL, init?: RequestInit) => Promise<Response>; };
}) => Promise<void>, provider: IntegrationProvider = "slack") {
  const requests: string[] = [];
  const state = { disconnected: false, revoked: false, policy: structuredClone(policies[provider]) as object | undefined, expired: false,
    providerReply: undefined as ((url: URL, init?: RequestInit) => Promise<Response>) | undefined,
    onPolicyRead: undefined as (() => Promise<void>) | undefined };
  const resolve = async (token: string) => state.revoked ? undefined : actor(token);
  const deps: IntegrationApiDeps = {
    orgStore: { resolveAuth: resolve, isOrgSuspended: async () => false,
      getOrganization: async (orgId: string) => ({ id: orgId, plan: "enterprise" }) } as never,
    integrationStore: { get: async (orgId: string) => orgId !== "A" || state.disconnected ? undefined : ({ provider, metadata: { siteUrl: "https://fixture.atlassian.net", cloudId: "cloud-id" }, revision: "00000000-0000-4000-8000-000000000001", updatedAt: new Date(100), tokenExpiresAt: state.expired ? new Date(0) : undefined }),
      getAccessToken: async () => sharedToken, getRefreshToken: async () => state.expired ? "synthetic-refresh" : undefined } as never,
    scopePolicyStore: { get: async () => { await state.onPolicyRead?.(); return state.policy ? ({ provider, policy: state.policy, updatedAt: new Date(100) }) : undefined; } } as never,
    userStore: { resolveUserSession: async (token: string) => token === "synthetic-user-session" && !state.revoked ? ({
      orgId: "A", orgName: "fixture", plan: "enterprise", userId: "member1", role: "member", email: "member@fixture.invalid", authProvider: "saml"
    }) : undefined } as never,
    googleDocsApp: { refreshAccessToken: async () => { throw new Error(sharedToken); } } as never
  };
  // Synthetic transport/contract controls only: these query fixtures do not
  // establish row-lock acknowledgement ordering. The real PG suite does that.
  deps.pool = { connect: async () => ({
    query: async () => ({ rowCount: 1, rows: [{ expires_at: new Date(Date.now() + 60_000),
      require_sso: false, allow_password: true, allow_google: true }] }),
    release: () => undefined
  }) } as never;
  for (const owner of [deps.orgStore, deps.userStore, deps.integrationStore, deps.scopePolicyStore]) {
    Object.assign(owner!, { inTransaction: () => owner });
  }
  const server = createServer(async (request, response) => {
    const url = new URL(request.url!, "http://localhost"); let raw = "";
    for await (const chunk of request) raw += chunk;
    const headers = { authorization: request.headers.authorization };
    const outer = await resolveAuthContextDetailed(headers, deps.orgStore, undefined, true, deps.userStore);
    const handled = await handleIntegrationApiRequest({ method: request.method!, pathname: url.pathname, query: url.searchParams, headers, body: raw ? JSON.parse(raw) : undefined }, response, deps, outer.auth);
    if (!handled) { response.writeHead(404); response.end(); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === "127.0.0.1") return realFetch(input, init);
    requests.push(url.toString());
    assert.equal(init?.redirect, "error");
    assert.equal((init?.headers as Record<string, string>)?.Authorization, `Bearer ${sharedToken}`);
    if (state.providerReply) return state.providerReply(url, init);
    if (url.hostname === "slack.com") {
      if (url.pathname.endsWith("search.messages")) return json({ ok: true, messages: { matches: [{ channel: { id: "C1", name: "eng" }, ts: "123.000001", text: "Decision", user: "U1" }] } });
      if (url.pathname.endsWith("conversations.replies")) return json({ ok: true, messages: [{ ts: "123.000001", user: "U1", text: "Authorized body" }] });
    }
    if (url.pathname.endsWith("/search/jql")) return json({ issues: [{ key: "APP-1", fields: { summary: "Decision", created: "2026-01-01", updated: "2026-01-01" } }] });
    if (url.pathname.endsWith("/issue/APP-1")) return json({ key: "APP-1", fields: { summary: "Decision", description: "Authorized body" } });
    if (url.pathname.endsWith("/search")) return json({ results: [{ content: { id: "page1", title: "Decision", space: { id: "S1", key: "ENG" } } }] });
    if (url.pathname.includes("/wiki/api/v2/pages/")) return json({ body: { storage: { value: "<p>Authorized body</p>" } } });
    if (url.hostname === "api.notion.com" && url.pathname.includes("/pages/")) return json({ id: "page1", parent: { type: "workspace", workspace: true }, properties: { title: { title: [{ plain_text: "Decision" }] } } });
    if (url.hostname === "api.notion.com" && url.pathname.includes("/blocks/")) return json({ results: [{ type: "paragraph", paragraph: { rich_text: [{ plain_text: "Authorized body" }] } }] });
    if (url.hostname === "www.googleapis.com" && url.pathname.endsWith("/export")) return new Response("Authorized body");
    if (url.hostname === "www.googleapis.com") {
      const file = { id: "doc1", name: "Decision", parents: ["F1"], mimeType: "application/vnd.google-apps.document" };
      return json(url.pathname.endsWith("/files") ? { files: [file] } : file);
    }
    if (url.hostname === "graph.microsoft.com") {
      const message = { id: "m1", body: { content: "Authorized body Decision" }, from: { user: { displayName: "Engineer" } } };
      return json(url.pathname.endsWith("/messages/m1") ? message : { value: [message] });
    }
    throw new Error(`Unexpected synthetic provider path: ${url.pathname}`);
  };
  const client = new CoopBackendClient({ getToken: async () => "member1" });
  const creds: IntegrationCredentials = { proxy: (operation, args, signal) => client.executeIntegrationOperation(base, operation, args, signal) };
  try { await run({ base, client, creds, requests, state }); } finally {
    globalThis.fetch = realFetch;
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

test("retired token endpoint never returns a token to members, admins, keys or invalid actors", async () => {
  await harness(async ({ base, requests }) => {
    for (const token of ["member1", "admin", "automation", "invalid"]) {
      const response = await realFetch(`${base}/v1/orgs/integrations/credentials?provider=slack`, { headers: { Authorization: `Bearer ${token}` } });
      assert.equal(response.status, token === "invalid" ? 401 : 410);
      assert.ok(!(await response.text()).includes(sharedToken));
    }
    assert.equal(requests.length, 0);
  });
});
for (const provider of ["slack", "jira", "confluence", "notion", "google-docs", "teams"] as const) {
  test(`${provider}: authorized search and open use client -> HTTP -> server -> synthetic vendor without distributing tokens`, async () => {
    await harness(async ({ creds, requests }) => {
      switch (provider) {
        case "slack": { const client = createSlackClientFromCredentials(creds)!; assert.equal((await client.searchMessages("Decision"))[0]?.channelId, "C1"); assert.match((await client.getThread("C1", "123.000001")).messages[0]!.text, /Authorized/); break; }
        case "jira": { const client = createJiraClientFromCredentials(creds)!; assert.equal((await client.searchIssues('text ~ "Decision"'))[0]?.key, "APP-1"); assert.equal((await client.getIssue("APP-1")).key, "APP-1"); break; }
        case "confluence": { const client = createConfluenceClientFromCredentials(creds)!; assert.equal((await client.searchPages('text ~ "Decision"'))[0]?.id, "page1"); assert.match((await client.getPageBody("page1"))!, /Authorized/); break; }
        case "notion": { const client = createNotionClientFromCredentials(creds)!; assert.equal((await client.searchPages("Decision"))[0]?.id, "page1"); assert.match((await client.getPagePlainText("page1"))!, /Authorized/); break; }
        case "google-docs": { const client = createGoogleDocsClientFromCredentials(creds)!; assert.equal((await client.searchDocuments("Decision"))[0]?.id, "doc1"); assert.match((await client.getDocumentPlainText("doc1"))!, /Authorized/); break; }
        case "teams": { const client = createTeamsClientFromCredentials(creds)!; assert.equal((await client.searchMessages("Decision"))[0]?.channelId, "C1"); assert.match((await client.getThread("T1", "C1", "m1")).messages[0]!.body, /Authorized/); break; }
      }
      assert.ok(requests.length >= 2);
    }, provider === "jira" || provider === "confluence" ? "atlassian" : provider);
  });
}

test("trusted org/member grants control search and direct reads; tampered tenant and foreign hits fail closed", async () => {
  await harness(async ({ base, client, creds, requests, state }) => {
    state.policy = { ...policies.slack, access: { mode: "member-grants", members: { member1: ["C1"], member2: ["C2"] } } };
    const slack = createSlackClientFromCredentials(creds)!;
    await slack.searchMessages("in:C2 Decision");
    assert.match(requests[0]!, /C1/); assert.doesNotMatch(requests[0]!, /C2/);
    const before = requests.length;
    await assert.rejects(slack.getThread("C2", "123.000001"), /authorized/);
    assert.equal(requests.length, before);
    const other = new CoopBackendClient({ getToken: async () => "other-org" });
    await assert.rejects(other.executeIntegrationOperation(base, "slack.searchMessages", ["Decision"]), /connected/);
    const member2 = new CoopBackendClient({ getToken: async () => "member2" });
    state.providerReply = async () => json({ ok: true, messages: { matches: [{ channel: { id: "C2" }, ts: "1", text: "Allowed" }] } });
    assert.equal((await member2.executeIntegrationOperation(base, "slack.searchMessages", ["Decision"]))[0]?.channelId, "C2");
    await assert.rejects(slack.searchMessages("Decision"), /authorized/);
    const injected = await realFetch(`${base}/v1/orgs/integrations/operate`, { method: "POST", headers: { Authorization: "Bearer member1" }, body: JSON.stringify({ operation: "slack.searchMessages", args: ["Decision"], orgId: "B" }) });
    assert.equal(injected.status, 400);
  });
});

test("missing policy, disconnected integration and denied directory are blocked before vendor retrieval", async () => {
  await harness(async ({ creds, state, requests }) => {
    const client = createSlackClientFromCredentials(creds)!;
    state.policy = undefined;
    await assert.rejects(client.searchMessages("Decision"), /policy/);
    state.policy = policies.slack; state.disconnected = true;
    await assert.rejects(client.searchMessages("Decision"), /connected/);
    state.disconnected = false;
    await assert.rejects(client.getUserInfo("U1"), /authorized/);
    assert.equal(requests.length, 0);
  });
});
for (const change of ["membership", "policy", "connection"] as const) {
  test(`authorization rechecked after vendor response: ${change} revocation releases no content`, async () => {
    await harness(async ({ creds, state }) => {
      state.providerReply = async () => {
        if (change === "membership") state.revoked = true;
        if (change === "policy") state.policy = { ...policies.slack, channels: [] };
        if (change === "connection") state.disconnected = true;
        return json({ ok: true, messages: { matches: [{ channel: { id: "C1" }, ts: "1", text: "stale private body" }] } });
      };
      await assert.rejects(createSlackClientFromCredentials(creds)!.searchMessages("Decision"), /authorization changed/);
    });
  });
}
test("expired refresh fails without exposing the provider exception or token", async () => {
  await harness(async ({ client, base, state, requests }) => {
    state.expired = true;
    await assert.rejects(client.executeIntegrationOperation(base, "googleDocs.searchDocuments", ["Decision"]), error => {
      assert.ok(error instanceof Error); assert.ok(!error.message.includes(sharedToken)); return /sign-in/.test(error.message);
    });
    assert.equal(requests.length, 0);
  }, "google-docs");
});
test("Google direct read checks parent before export; a denied metadata parent cannot be opened", async () => {
  await harness(async ({ creds, state, requests }) => {
    state.providerReply = async () => json({ id: "doc1", parents: ["DENIED"], mimeType: "application/vnd.google-apps.document" });
    await assert.rejects(createGoogleDocsClientFromCredentials(creds)!.getDocumentPlainText("doc1"), /authorized/);
    assert.ok(requests.every(url => !url.includes("/export")));
  }, "google-docs");
});
test("Teams team/channel identities must be an approved pair", async () => {
  await harness(async ({ creds, requests }) => {
    await assert.rejects(createTeamsClientFromCredentials(creds)!.getThread("T2", "C1", "m1"), /authorized/);
    assert.equal(requests.length, 0);
  }, "teams");
});
test("provider transport errors never reveal sensitive exception text", async () => {
  await harness(async ({ creds, state }) => {
    state.providerReply = async () => { throw new Error(sharedToken); };
    await assert.rejects(createSlackClientFromCredentials(creds)!.searchMessages("Decision"), error => {
      assert.ok(error instanceof Error); return !error.message.includes(sharedToken);
    });
  });
});

for (const provider of ["slack", "atlassian", "notion", "google-docs", "teams"] as const) {
  test(`${provider}: missing or malformed member grant exposes no source metadata`, async () => {
    await harness(async ({ base, state, requests }) => {
      for (const access of [null, { mode: "member-grants", members: {} },
        { mode: "member-grants", members: { member1: [7] } }, { mode: "invalid" }]) {
        state.policy = { ...policies[provider], access };
        const response = await realFetch(`${base}/v1/orgs/integrations/scope?provider=${provider}`, {
          headers: { Authorization: "Bearer member1" } });
        assert.equal(response.status, 200);
        const scope = await response.json() as Record<string, unknown>;
        assert.equal(scope.allowed, false);
        for (const key of ["slack", "atlassian", "notion", "googleDocs", "teams"]) assert.equal(scope[key], undefined);
      }
      assert.equal(requests.length, 0);
    }, provider);
  });
}
test("member scope projects Teams names, team relationships and Google folder metadata from admitted IDs only", async () => {
  for (const provider of ["teams", "google-docs"] as const) {
    await harness(async ({ base, state }) => {
      state.policy = provider === "teams" ? {
        version: 1, mode: "allowlist", channels: [
          { id: "C1", name: "Approved", teamId: "T1" },
          { id: "C2", name: "DENIED_CHANNEL_NAME", teamId: "DENIED_TEAM_ID" }],
        access: { mode: "member-grants", members: { member1: ["C1"] } }
      } : {
        version: 1, mode: "allowlist", folders: [
          { id: "F1", name: "Approved", kind: "folder" },
          { id: "F2", name: "DENIED_FOLDER_NAME", kind: "shared_drive" }],
        expandedFolderIds: ["F1", "F2"], access: { mode: "member-grants", members: { member1: ["F1"] } }
      };
      const response = await realFetch(`${base}/v1/orgs/integrations/scope?provider=${provider}`, {
        headers: { Authorization: "Bearer member1" } });
      assert.equal(response.status, 200);
      const body = await response.text(); assert.doesNotMatch(body, /DENIED|C2|F2/);
      const scope = JSON.parse(body);
      if (provider === "teams") assert.deepEqual(scope.teams, {
        channelIds: ["C1"], channelNames: ["Approved"], channelTeamIds: { C1: "T1" }, teamIds: ["T1"]
      });
      else assert.deepEqual(scope.googleDocs, {
        folderIds: ["F1"], folderNames: ["Approved"], folderKinds: ["folder"], expandedFolderIds: ["F1"]
      });
    }, provider);
  }
});

test("allowlist and actor grants use one policy read and never mix revisions", async () => {
  let reads = 0;
  const store: Pick<IntegrationScopePolicyStore, "get"> = {
    get: async () => {
      reads += 1;
      return { provider: "slack", updatedAt: new Date(reads), policy: reads === 1 ? {
        ...policies.slack, access: { mode: "member-grants", members: { member1: ["C1"] } }
      } : { ...policies.slack, access: { mode: "organization-approved" } } };
    }
  };
  const scope = await resolveActorIntegrationScope({ orgId: "A", provider: "slack", connected: true,
    scopePolicyStore: store, principal: "member1" });
  assert.equal(reads, 1);
  assert.deepEqual(scope.slack, { channelIds: ["C1"], channelNames: ["eng"] });
});
test("malformed operations and foreign vendor reads release no content or credentials", async () => {
  await harness(async ({ base, state, requests }) => {
    for (const args of [[], ["Decision", { limit: 51 }], ["Decision", { arbitraryUrl: "https://example.invalid" }]]) {
      const response = await realFetch(`${base}/v1/orgs/integrations/operate`, { method: "POST",
        headers: { Authorization: "Bearer member1" }, body: JSON.stringify({ operation: "slack.searchMessages", args }) });
      assert.equal(response.status, 400); assert.ok(!(await response.text()).includes(sharedToken));
    }
    assert.equal(requests.length, 0);
    state.providerReply = async () => json({ ok: true, messages: { matches: [
      { channel: { id: "FOREIGN_CHANNEL" }, ts: "1", text: "foreign synthetic content" }] } });
    const response = await realFetch(`${base}/v1/orgs/integrations/operate`, { method: "POST",
      headers: { Authorization: "Bearer member1" }, body: JSON.stringify({ operation: "slack.searchMessages", args: ["Decision"] }) });
    assert.equal(response.status, 403); assert.doesNotMatch(await response.text(), /foreign synthetic content|synthetic-shared-token/);
  });
});

for (const fault of ["redirect", "oversize", "slow-body"] as const) {
  test(`native integration transport: ${fault} is bounded and releases no partial body`, async () => {
    let redirectedRequests = 0;
    const server = createServer((request, response) => {
      if (request.url === "/target") { redirectedRequests += 1; response.end("must not follow"); return; }
      if (fault === "redirect") { response.writeHead(302, { location: "/target" }); response.end(); }
      else if (fault === "oversize") response.end("x".repeat(1_048_577));
      else { response.writeHead(200); response.write("partial synthetic body"); }
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); assert.ok(address && typeof address === "object");
    try {
      const started = Date.now();
      const request = fetchIntegrationResponse(`http://127.0.0.1:${address.port}/source`, {}, 100);
      if (fault === "slow-body") {
        const result = await request; assert.ok("timeout" in result); assert.ok(Date.now() - started < 1500);
      } else await assert.rejects(request, fault === "oversize" ? /byte limit/ : /fetch failed/);
      assert.equal(redirectedRequests, 0);
    } finally {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
}
test("client Stop aborts the backend request and forwards cancellation to the active vendor read", async () => {
  await harness(async ({ client, base, state }) => {
    const controller = new AbortController();
    let sawAbort = false;
    let enter!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    let finish!: () => void;
    const finished = new Promise<void>(resolve => { finish = resolve; });
    state.providerReply = async (_url, init) => {
      assert.ok(init?.signal);
      enter();
      return new Promise<Response>((_resolve, reject) => {
        init.signal!.addEventListener("abort", () => { sawAbort = true; finish(); reject(new Error("synthetic stopped")); }, { once: true });
      });
    };
    const pending = client.executeIntegrationOperation(base, "slack.searchMessages", ["Decision"], controller.signal);
    await entered; controller.abort(); await assert.rejects(pending);
    await Promise.race([finished, new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(new Error("vendor cancellation not observed")), 1500); timer.unref();
    })]);
    assert.equal(sawAbort, true);
  });
});

test("actual session auth resolver admits a valid session to both scope and operation paths", async () => {
  await harness(async ({ base }) => {
    const headers = { Authorization: "Bearer synthetic-user-session" };
    const scope = await realFetch(`${base}/v1/orgs/integrations/scope?provider=slack`, { headers });
    assert.equal(scope.status, 200); assert.deepEqual((await scope.json() as { allowed: boolean }).allowed, true);
    const operation = await realFetch(`${base}/v1/orgs/integrations/operate`, { method: "POST", headers,
      body: JSON.stringify({ operation: "slack.searchMessages", args: ["Decision"] }) });
    assert.equal(operation.status, 200); assert.equal((await operation.json() as { result: { channelId: string }[] }).result[0].channelId, "C1");
  });
});
test("scope metadata is withheld when the session is revoked during a held policy read", async () => {
  await harness(async ({ base, state, requests }) => {
    let enter!: () => void; let release!: () => void; let reads = 0;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    state.onPolicyRead = async () => { if (++reads === 1) { enter(); await held; } };
    const pending = realFetch(`${base}/v1/orgs/integrations/scope?provider=slack`, {
      headers: { Authorization: "Bearer synthetic-user-session" } });
    await entered; state.revoked = true; release();
    const response = await pending; assert.equal(response.status, 403);
    assert.doesNotMatch(await response.text(), /channelIds|channelNames|eng|ops/);
    assert.equal(requests.length, 0);
  });
});
for (const nested of ["denied", "inline-denied", "allowed", "allowed-wrong-identity"] as const) {
  test(`Jira nested epic admission: ${nested} keeps project scope`, async () => {
    await harness(async ({ creds, state, requests }) => {
      state.providerReply = async url => {
        if (url.pathname.endsWith("/issue/APP-1")) return json({ key: "APP-1", fields: {
          summary: "Authorized issue", customfield_10014: nested.startsWith("allowed") ? "APP-2" : "DENIED-2",
          ...(nested === "inline-denied" ? { parent: { key: "DENIED-2", fields: { summary: "DENIED_EPIC_TITLE" } } } : {})
        } });
        if (url.pathname.endsWith("/issue/APP-2")) return json({ key: nested === "allowed-wrong-identity" ? "DENIED-2" : "APP-2",
          fields: { summary: nested === "allowed-wrong-identity" ? "DENIED_EPIC_TITLE" : "Allowed epic" } });
        throw new Error("Unexpected or denied nested read");
      };
      const issue = await createJiraClientFromCredentials(creds)!.getIssue("APP-1");
      assert.equal(issue.key, "APP-1"); assert.doesNotMatch(JSON.stringify(issue), /DENIED_EPIC_TITLE/);
      assert.ok(requests.every(url => !url.includes("DENIED-2")));
      if (nested === "allowed") assert.equal(issue.epicName, "Allowed epic");
      if (!nested.startsWith("allowed")) { assert.equal(issue.epicKey, undefined); assert.equal(issue.epicName, undefined); assert.equal(requests.length, 1); }
    }, "atlassian");
  });
}

// Provider refresh results are candidates; only bytes read at a current durable
// generation can become an operation credential.
for (const provider of ["slack", "atlassian", "notion", "google-docs", "teams"] as const) {
  for (const scenario of ["current", "deleted", "reconnected", "reload-raced"] as const) {
    test(`${provider} refresh ${scenario}: durable generation controls the credential`, async () => {
      const oldRevision = "00000000-0000-4000-8000-000000000001";
      const newRevision = "00000000-0000-4000-8000-000000000002";
      let recordReads = 0; let mutations = 0; let vendorCalls = 0; let tokenReads = 0;
      const connection = (revision: string) => ({ revision, provider, tokenExpiresAt: new Date(0), metadata: {} });
      const store = {
        get: async () => ++recordReads === 1 ? connection(oldRevision) : connection(newRevision),
        getAccessToken: async (_org: string, actualProvider: string, revision?: string) => {
          assert.equal(actualProvider, provider); assert.equal(revision, newRevision); tokenReads++;
          return scenario === "reload-raced" ? undefined : "synthetic-current-stored-token";
        },
        getRefreshToken: async (_org: string, actualProvider: string, revision?: string) => {
          assert.equal(actualProvider, provider); assert.equal(revision, oldRevision); return "synthetic-old-refresh";
        },
        saveRefreshedTokens: async (_org: string, actualProvider: string, revision: string, token: string,
          options: { refreshToken?: string; expiresAt?: Date }) => {
          mutations++; assert.equal(actualProvider, provider); assert.equal(revision, oldRevision);
          assert.equal(token, "synthetic-vendor-candidate"); assert.equal(options.refreshToken, "synthetic-new-refresh");
          assert.ok(options.expiresAt instanceof Date);
          return scenario === "current" || scenario === "reload-raced";
        },
        upsert: async () => { assert.fail("Refresh must never INSERT or upsert a connection."); }
      };
      const app = { refreshAccessToken: async (token: string) => {
        vendorCalls++; assert.equal(token, "synthetic-old-refresh"); return {
          accessToken: "synthetic-vendor-candidate", refreshToken: "synthetic-new-refresh", expiresAt: new Date(Date.now() + 3600000)
        };
      } };
      const deps: IntegrationApiDeps = { integrationStore: store as never,
        slackApp: app as never, atlassianApp: app as never, notionApp: app as never,
        googleDocsApp: app as never, teamsApp: app as never };
      const result = await resolveOrgIntegrationAccessToken("synthetic-org", provider, deps);
      assert.equal(result, scenario === "current" ? "synthetic-current-stored-token" : undefined);
      assert.equal(vendorCalls, 1); assert.equal(mutations, 1);
      assert.equal(recordReads, scenario === "deleted" || scenario === "reconnected" ? 1 : 2);
      assert.equal(tokenReads, scenario === "deleted" || scenario === "reconnected" ? 0 : 1);
    });
  }
}
