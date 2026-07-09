import assert from "node:assert/strict";
import type { ServerResponse } from "node:http";
import { handleOrgApiRequest, type OrgApiDeps } from "./orgApi";
import type { AuditLogItem, AuditLogger } from "./audit/auditLogger";
import type { OrgStore } from "./orgStore";
import type { ServerConfig } from "./serverConfig";
import type { ResolvedUserSession, UserStore } from "./users/userStore";
import type { UsageDateRange, UsageTracker } from "./usageTracker";

function mockResponse(): ServerResponse & { statusCode?: number; body?: string } {
  const res = {
    statusCode: undefined as number | undefined,
    body: undefined as string | undefined,
    writeHead(code: number) {
      this.statusCode = code;
    },
    end(payload: string) {
      this.body = payload;
    }
  };
  return res as ServerResponse & { statusCode?: number; body?: string };
}

function mockOrgStore(orgId: string): OrgStore {
  return {
    resolveAuth: async () => undefined,
    getOrganization: async (id: string) => ({
      id,
      name: "Test Org",
      plan: "pro",
      createdAt: new Date()
    }),
    listOrgRepos: async () => []
  } as unknown as OrgStore;
}

function mockUserStore(): UserStore {
  const session: ResolvedUserSession = {
    userId: "u1",
    orgId: "org-test",
    orgName: "Test Org",
    plan: "pro",
    role: "member"
  };
  return {
    resolveUserSession: async (token: string) => (token === "sess-member" ? session : undefined),
    getUser: async (userId: string) =>
      userId === "u1"
        ? {
            id: "u1",
            orgId: "org-test",
            email: "member@test.com",
            role: "member",
            status: "active",
            createdAt: new Date()
          }
        : undefined
  } as unknown as UserStore;
}

function mockUsageTracker(): UsageTracker {
  const principal = "user:u1";
  const matches = (p: string, principals: string[]) => principals.includes(p);
  return {
    countEventsForPrincipal: async (_oid: string, p: string, _range: UsageDateRange) =>
      p === principal ? 42 : 0,
    countEventsForPrincipals: async (_oid: string, principals: string[], _range: UsageDateRange) =>
      principals.includes(principal) ? 42 : 0,
    eventsByDayForPrincipal: async (_oid: string, p: string, _range: UsageDateRange, prefix?: string) =>
      p === principal
        ? [{ day: "2026-07-01", count: prefix ? 3 : 10 }]
        : [],
    eventsByDayForPrincipals: async (
      _oid: string,
      principals: string[],
      _range: UsageDateRange,
      prefix?: string
    ) => (matches(principal, principals) ? [{ day: "2026-07-01", count: prefix ? 3 : 10 }] : []),
    eventsByDayForChatActivityForPrincipals: async (
      _oid: string,
      principals: string[],
      _range: UsageDateRange
    ) => (matches(principal, principals) ? [{ day: "2026-07-01", count: 8 }] : []),
    eventsByTypeForPrincipal: async (_oid: string, p: string) =>
      p === principal
        ? [
            { eventType: "chat.message", count: 5 },
            { eventType: "chat.completion", count: 2 },
            { eventType: "quick_action.explain", count: 1 },
            { eventType: "edit.requested", count: 2 },
            { eventType: "edit.patch_applied", count: 1 },
            { eventType: "edit.patch_rejected", count: 1 },
            { eventType: "completion.suggested", count: 8 },
            { eventType: "completion.accepted", count: 4 },
            { eventType: "completion.requested", count: 6 },
            { eventType: "completion.rejected", count: 1 },
            { eventType: "lightning.search", count: 3 }
          ]
        : [],
    eventsByTypeForPrincipals: async (_oid: string, principals: string[]) =>
      matches(principal, principals)
        ? [
            { eventType: "chat.message", count: 5 },
            { eventType: "chat.completion", count: 2 },
            { eventType: "quick_action.explain", count: 1 },
            { eventType: "edit.requested", count: 2 },
            { eventType: "edit.patch_applied", count: 1 },
            { eventType: "edit.patch_rejected", count: 1 },
            { eventType: "completion.suggested", count: 8 },
            { eventType: "completion.accepted", count: 4 },
            { eventType: "completion.requested", count: 6 },
            { eventType: "completion.rejected", count: 1 },
            { eventType: "lightning.search", count: 3 }
          ]
        : [],
    countEventsOfTypeForPrincipal: async (
      _oid: string,
      p: string,
      _range: UsageDateRange,
      eventType: string
    ) => (p === principal && eventType === "lightning.search" ? 3 : 0),
    eventsByDayForExactEventTypeForPrincipal: async (
      _oid: string,
      p: string,
      _range: UsageDateRange,
      eventType: string
    ) =>
      p === principal && eventType === "lightning.search"
        ? [{ day: "2026-07-01", count: 3 }]
        : [],
    latencyPercentilesForPrincipal: async (
      _oid: string,
      p: string,
      _range: UsageDateRange,
      eventType: string,
      metadataKey: string
    ) => {
      if (p !== principal) {
        return { p50: null, p95: null, sampleCount: 0 };
      }
      if (eventType === "completion.requested" && metadataKey === "latencyMs") {
        return { p50: 120, p95: 450, sampleCount: 6 };
      }
      if (eventType === "completion.performance" && metadataKey === "p50LatencyMs") {
        return { p50: 80, p95: null, sampleCount: 4 };
      }
      if (eventType === "completion.performance" && metadataKey === "p95LatencyMs") {
        return { p50: null, p95: 200, sampleCount: 4 };
      }
      return { p50: null, p95: null, sampleCount: 0 };
    }
  } as unknown as UsageTracker;
}

function baseDeps(usageTracker?: UsageTracker): OrgApiDeps {
  const serverConfig: ServerConfig = {
    nodeEnv: "test",
    requireApiAuth: true,
    jobsWorkersEnabled: false,
    devMode: true
  };
  return {
    orgStore: mockOrgStore("org-test"),
    userStore: mockUserStore(),
    serverConfig,
    usageTracker
  };
}

async function request(
  deps: OrgApiDeps,
  pathname: string,
  query?: URLSearchParams
): Promise<{ statusCode?: number; body?: string }> {
  const response = mockResponse();
  const handled = await handleOrgApiRequest(
    {
      method: "GET",
      pathname,
      query,
      headers: { authorization: "Bearer sess-member" },
      body: null
    },
    response,
    deps
  );
  assert.equal(handled, true);
  return response;
}

function parseBody(body?: string): Record<string, unknown> {
  return JSON.parse(body ?? "{}") as Record<string, unknown>;
}

void (async () => {
  const deps = baseDeps(mockUsageTracker());

  const overview = await request(deps, "/v1/me/analytics/overview");
  assert.equal(overview.statusCode, 200);
  const overviewBody = parseBody(overview.body);
  assert.equal(overviewBody.totalEvents, 42);
  assert.ok(Array.isArray(overviewBody.eventsByDay));
  assert.deepEqual(overviewBody.productMix, {
    chat: 7,
    completions: 19,
    lightning: 3,
    quickActions: 1
  });
  assert.equal(overviewBody.chatMessages, 7);
  assert.equal(overviewBody.lightningEvents, 3);
  assert.equal(overviewBody.acceptanceRate, 0.5);
  assert.equal("seats" in overviewBody, false);
  assert.equal("topUsers" in overviewBody, false);
  assert.equal("totalUsers" in overviewBody, false);
  assert.equal("dau" in overviewBody, false);
  assert.equal("mau" in overviewBody, false);

  const chat = await request(deps, "/v1/me/analytics/chat");
  assert.equal(chat.statusCode, 200);
  const chatBody = parseBody(chat.body);
  assert.equal(chatBody.chatMessages, 7);
  assert.ok(Array.isArray(chatBody.quickActions));
  assert.equal((chatBody.quickActions as unknown[]).length, 1);
  assert.equal(chatBody.editRequested, 2);
  assert.equal(chatBody.editPatchApplied, 1);
  assert.equal(chatBody.editPatchRejected, 1);
  assert.equal(chatBody.editApplyRate, 0.5);
  assert.ok(Array.isArray(chatBody.eventsByDay));
  assert.equal("topUsers" in chatBody, false);

  const lightning = await request(deps, "/v1/me/analytics/lightning");
  assert.equal(lightning.statusCode, 200);
  const lightningBody = parseBody(lightning.body);
  assert.equal(lightningBody.lightningSearches, 3);
  assert.equal(lightningBody.searchCount, 3);
  assert.ok(Array.isArray(lightningBody.eventsByDay));

  const completions = await request(deps, "/v1/me/analytics/completions");
  assert.equal(completions.statusCode, 200);
  const completionsBody = parseBody(completions.body);
  assert.equal(completionsBody.suggested, 8);
  assert.equal(completionsBody.requested, 6);
  assert.equal(completionsBody.accepted, 4);
  assert.equal(completionsBody.rejected, 1);
  assert.equal(completionsBody.acceptanceRate, 0.5);
  assert.equal(completionsBody.serverLatencyP50Ms, 120);
  assert.equal(completionsBody.clientLatencyP95Ms, 200);
  assert.ok(Array.isArray(completionsBody.eventsByDay));

  const noTracker = await request(baseDeps(undefined), "/v1/me/analytics/overview");
  assert.equal(noTracker.statusCode, 503);
  assert.match(parseBody(noTracker.body).error as string, /usage tracking not configured/);

  console.log("meAnalyticsApi.test.ts: ok");
})();
