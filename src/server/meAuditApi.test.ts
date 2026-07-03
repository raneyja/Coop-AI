import assert from "node:assert/strict";
import type { ServerResponse } from "node:http";
import { handleOrgApiRequest, type OrgApiDeps } from "./orgApi";
import type { AuditLogItem, AuditLogger } from "./audit/auditLogger";
import type { OrgStore } from "./orgStore";
import type { ServerConfig } from "./serverConfig";
import type { ResolvedUserSession, UserStore } from "./users/userStore";

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
    resolveUserSession: async (token: string) => (token === "sess-member" ? session : undefined)
  } as unknown as UserStore;
}

function mockAuditLogger(): AuditLogger {
  const entries: AuditLogItem[] = [
    {
      id: "100",
      action: "chat.completion",
      principal: "user:u1",
      userId: "u1",
      metadata: { model: "gpt-4" },
      createdAt: "2026-07-01T12:00:00.000Z"
    },
    {
      id: "99",
      action: "repo.file.fetch",
      principal: "user:other",
      userId: "other",
      metadata: {},
      createdAt: "2026-07-01T11:00:00.000Z"
    }
  ];
  return {
    listForPrincipal: async (orgId: string, principal: string, options: { limit: number }) => {
      assert.equal(orgId, "org-test");
      assert.equal(principal, "user:u1");
      return {
        entries: entries.filter((entry) => entry.principal === principal).slice(0, options.limit)
      };
    }
  } as unknown as AuditLogger;
}

function baseDeps(auditLogger?: AuditLogger): OrgApiDeps {
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
    auditLogger
  };
}

async function request(
  deps: OrgApiDeps,
  query?: URLSearchParams
): Promise<{ statusCode?: number; body?: string }> {
  const response = mockResponse();
  const handled = await handleOrgApiRequest(
    {
      method: "GET",
      pathname: "/v1/me/audit",
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

void (async () => {
  const result = await request(baseDeps(mockAuditLogger()));
  assert.equal(result.statusCode, 200);
  const body = JSON.parse(result.body ?? "{}") as {
    entries: AuditLogItem[];
    nextCursor?: string;
  };
  assert.equal(body.entries.length, 1);
  assert.equal(body.entries[0]?.action, "chat.completion");
  assert.equal(body.entries[0]?.principal, "user:u1");
  assert.ok(!body.entries.some((entry) => entry.principal === "user:other"));

  const unavailable = await request(baseDeps(undefined));
  assert.equal(unavailable.statusCode, 503);
  assert.equal(JSON.parse(unavailable.body ?? "{}").error, "audit_unavailable");

  console.log("meAuditApi.test.ts: ok");
})();
