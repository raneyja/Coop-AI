import assert from "node:assert/strict";
import type { ServerResponse } from "node:http";
import { handleAdminApiRequest } from "./adminApi";
import type { AdminApiDeps } from "./adminApiShared";
import type { OrgStore } from "./orgStore";
import type { ServerConfig } from "./serverConfig";
import type { ResolvedUserSession, UserRecord, UserStore } from "./users/userStore";
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

function mockOrgStore(): OrgStore {
  return {
    resolveAuth: async () => undefined,
    getOrganization: async (id: string) => ({
      id,
      name: "Test Org",
      plan: "pro",
      createdAt: new Date()
    }),
    getOrganizationBilling: async () => ({
      orgId: "org-test",
      seatCount: 5,
      billingStatus: "active",
      updatedAt: new Date()
    })
  } as unknown as OrgStore;
}

function mockUsers(): UserRecord[] {
  return [
    {
      id: "u1",
      orgId: "org-test",
      email: "active@example.com",
      role: "admin",
      createdAt: new Date()
    },
    {
      id: "u2",
      orgId: "org-test",
      email: "inactive@example.com",
      role: "member",
      createdAt: new Date()
    },
    {
      id: "u3",
      orgId: "org-test",
      email: "deactivated@example.com",
      role: "member",
      deactivatedAt: new Date(),
      createdAt: new Date()
    }
  ];
}

function mockUserStore(): UserStore {
  const session: ResolvedUserSession = {
    userId: "u1",
    orgId: "org-test",
    orgName: "Test Org",
    plan: "pro",
    role: "admin"
  };
  return {
    resolveUserSession: async (token: string) => (token === "sess-admin" ? session : undefined),
    listOrgUsers: async () => mockUsers()
  } as unknown as UserStore;
}

function mockUsageTracker(): UsageTracker {
  return {
    countEvents: async () => 20,
    countDistinctPrincipals: async () => 2,
    eventsByDay: async () => [{ day: "2026-07-01", count: 10 }],
    eventsByDayForChatActivity: async () => [{ day: "2026-07-01", count: 8 }],
    eventsByType: async () => [
      { eventType: "chat.message", count: 5 },
      { eventType: "chat.completion", count: 2 },
      { eventType: "completion.suggested", count: 8 },
      { eventType: "completion.accepted", count: 4 },
      { eventType: "completion.requested", count: 6 },
      { eventType: "completion.rejected", count: 1 },
      { eventType: "lightning.search", count: 3 },
      { eventType: "quick_action.explain", count: 1 },
      { eventType: "edit.requested", count: 2 },
      { eventType: "edit.patch_applied", count: 1 },
      { eventType: "edit.patch_rejected", count: 1 }
    ],
    listActivePrincipals: async () => ["user:u1"],
    lastActiveAtByPrincipal: async () => [
      { principal: "user:u1", lastActiveAt: new Date("2026-07-08T12:00:00.000Z") },
      { principal: "user:u2", lastActiveAt: new Date("2026-06-01T12:00:00.000Z") }
    ],
    topPrincipals: async () => [
      { principal: "user:u1", count: 15 },
      { principal: "user:u2", count: 5 }
    ],
    completionAcceptanceByPrincipal: async () => [
      {
        principal: "user:u1",
        suggested: 8,
        accepted: 4,
        acceptanceRate: 0.5
      }
    ],
    countEventsOfType: async (_orgId: string, _range: UsageDateRange, eventType: string) =>
      eventType === "lightning.search" ? 3 : 0,
    eventsByDayForExactEventType: async (
      _orgId: string,
      _range: UsageDateRange,
      eventType: string
    ) => (eventType === "lightning.search" ? [{ day: "2026-07-01", count: 3 }] : []),
    eventsByDayForEventTypes: async () => [{ day: "2026-07-01", count: 7 }],
    latencyPercentilesForEventType: async () => ({ p50: 100, p95: 300, sampleCount: 4 }),
    exportCsv: async () => "created_at,event_type,principal,user_id,metadata\n"
  } as unknown as UsageTracker;
}

function baseDeps(usageTracker?: UsageTracker): AdminApiDeps {
  const serverConfig: ServerConfig = {
    nodeEnv: "test",
    requireApiAuth: true,
    jobsWorkersEnabled: false,
    devMode: true
  };
  return {
    orgStore: mockOrgStore(),
    userStore: mockUserStore(),
    serverConfig,
    usageTracker
  };
}

async function request(
  deps: AdminApiDeps,
  pathname: string
): Promise<{ statusCode?: number; body?: string }> {
  const response = mockResponse();
  const handled = await handleAdminApiRequest(
    {
      method: "GET",
      pathname,
      query: new URLSearchParams({
        from: "2026-07-01T00:00:00.000Z",
        to: "2026-07-09T00:00:00.000Z"
      }),
      headers: { authorization: "Bearer sess-admin" },
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

  const overview = await request(deps, "/v1/admin/analytics/overview");
  assert.equal(overview.statusCode, 200);
  const overviewBody = parseBody(overview.body);
  assert.equal(overviewBody.totalEvents, 20);
  assert.deepEqual(overviewBody.productMix, {
    chat: 7,
    completions: 19,
    lightning: 3,
    quickActions: 1
  });
  assert.equal(overviewBody.acceptanceRate, 0.5);
  assert.equal(overviewBody.inactiveSeatCount, 1);
  assert.equal(overviewBody.inactiveSeats, 1);
  const inactiveUsers = overviewBody.inactiveUsers as Array<Record<string, unknown>>;
  assert.equal(inactiveUsers.length, 1);
  assert.equal(inactiveUsers[0]?.userId, "u2");
  assert.equal(inactiveUsers[0]?.email, "inactive@example.com");
  assert.equal(inactiveUsers[0]?.lastActiveAt, "2026-06-01T12:00:00.000Z");

  const chat = await request(deps, "/v1/admin/analytics/chat");
  assert.equal(chat.statusCode, 200);
  const chatBody = parseBody(chat.body);
  const topUsers = chatBody.topUsers as Array<Record<string, unknown>>;
  assert.equal(topUsers[0]?.principal, "user:u1");
  assert.equal(topUsers[0]?.suggested, 8);
  assert.equal(topUsers[0]?.accepted, 4);
  assert.equal(topUsers[0]?.acceptanceRate, 0.5);
  assert.equal(topUsers[1]?.suggested, 0);
  assert.equal(topUsers[1]?.acceptanceRate, null);
  assert.equal(chatBody.editRequested, 2);
  assert.equal(chatBody.editPatchApplied, 1);
  assert.equal(chatBody.editPatchRejected, 1);
  assert.equal(chatBody.editApplyRate, 0.5);
  assert.equal((chatBody.editEvents as Array<{ eventType: string }>)[0]?.eventType, "edit.requested");

  const lightning = await request(deps, "/v1/admin/analytics/lightning");
  assert.equal(lightning.statusCode, 200);
  const lightningBody = parseBody(lightning.body);
  assert.equal(lightningBody.lightningSearches, 3);
  assert.equal(lightningBody.searchCount, 3);
  assert.ok(Array.isArray(lightningBody.eventsByDay));
  assert.equal(
    (lightningBody.eventsByDay as Array<{ count: number }>)[0]?.count,
    3
  );

  const completions = await request(deps, "/v1/admin/analytics/completions");
  assert.equal(completions.statusCode, 200);
  const completionsBody = parseBody(completions.body);
  assert.equal(completionsBody.acceptanceRate, 0.5);
  const topUsersByCar = completionsBody.topUsersByCar as Array<Record<string, unknown>>;
  assert.equal(topUsersByCar.length, 1);
  assert.equal(topUsersByCar[0]?.principal, "user:u1");
  assert.equal(topUsersByCar[0]?.acceptanceRate, 0.5);

  const users = await request(deps, "/v1/admin/analytics/users");
  assert.equal(users.statusCode, 200);
  const usersBody = parseBody(users.body);
  assert.equal(usersBody.inactiveSeatCount, 1);
  assert.ok(Array.isArray(usersBody.users));
  assert.equal((usersBody.users as unknown[])[0] && (usersBody.users as Array<{ principal: string }>)[0]?.principal, "user:u1");

  const noTracker = await request(baseDeps(undefined), "/v1/admin/analytics/overview");
  assert.equal(noTracker.statusCode, 503);

  console.log("adminAnalyticsApi.test.ts: ok");
})();
