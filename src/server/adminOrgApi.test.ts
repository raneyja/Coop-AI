import assert from "node:assert/strict";
import type { ServerResponse } from "node:http";
import { handleAdminApiRequest } from "./adminApi";
import type { AdminApiDeps } from "./adminApiShared";
import { AuditLogger, type AuditEntry } from "./audit/auditLogger";
import { parseOrganizationName } from "./adminOrgApi";
import type { Organization, OrgStore } from "./orgStore";
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

function org(name: string): Organization {
  return {
    id: "org-1",
    name,
    plan: "free",
    repoAccessMode: "all_indexed",
    createdAt: new Date("2026-01-01T00:00:00.000Z")
  };
}

function mockOrgStore(initialName: string, takenNames: string[] = []): OrgStore & { name: () => string } {
  let current = initialName;
  const taken = new Set(takenNames.map((name) => name.toLowerCase()));
  const store = {
    name: () => current,
    resolveAuth: async () => undefined,
    getOrganization: async (id: string) => (id === "org-1" ? org(current) : undefined),
    updateOrganizationName: async (id: string, name: string) => {
      if (id !== "org-1") return { ok: false as const, reason: "not_found" as const };
      if (current === name) {
        return { ok: true as const, org: org(current), previousName: current, changed: false };
      }
      if (taken.has(name.toLowerCase())) {
        return { ok: false as const, reason: "taken" as const };
      }
      const previousName = current;
      current = name;
      return { ok: true as const, org: org(current), previousName, changed: true };
    }
  };
  return store as unknown as OrgStore & { name: () => string };
}

function mockUserStore(): UserStore {
  const sessions: Record<string, ResolvedUserSession> = {
    "sess-admin": {
      userId: "u-admin",
      orgId: "org-1",
      orgName: "jonathanaraney",
      plan: "free",
      role: "admin",
      email: "jonathanaraney@gmail.com"
    },
    "sess-member": {
      userId: "u-member",
      orgId: "org-1",
      orgName: "jonathanaraney",
      plan: "free",
      role: "member",
      email: "member@example.com"
    }
  };
  return {
    resolveUserSession: async (token: string) => sessions[token]
  } as unknown as UserStore;
}

function baseDeps(orgStore: OrgStore, audits: AuditEntry[]): AdminApiDeps {
  const serverConfig: ServerConfig = {
    nodeEnv: "test",
    requireApiAuth: true,
    jobsWorkersEnabled: false,
    devMode: true
  };
  return {
    orgStore,
    userStore: mockUserStore(),
    serverConfig,
    auditLogger: {
      record: async (entry: AuditEntry) => {
        audits.push(entry);
      }
    } as unknown as AuditLogger
  };
}

async function request(
  deps: AdminApiDeps,
  token: string,
  body: unknown
): Promise<{ statusCode?: number; body?: string }> {
  const response = mockResponse();
  const handled = await handleAdminApiRequest(
    {
      method: "PATCH",
      pathname: "/v1/admin/org",
      headers: { authorization: `Bearer ${token}` },
      body
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
  assert.deepEqual(parseOrganizationName("  Acme   Corp  "), { ok: true, name: "Acme Corp" });
  assert.equal(parseOrganizationName("   ").ok, false);
  assert.equal(parseOrganizationName("a".repeat(256)).ok, false);
  assert.equal(parseOrganizationName("Line\nbreak").ok, false);

  const audits: AuditEntry[] = [];
  const store = mockOrgStore("jonathanaraney", ["Taken Name"]);
  const deps = baseDeps(store, audits);

  const renamed = await request(deps, "sess-admin", { name: "  Raney Apps  " });
  assert.equal(renamed.statusCode, 200);
  assert.equal(parseBody(renamed.body).name, "Raney Apps");
  assert.equal(store.name(), "Raney Apps");
  assert.equal(audits.length, 1);
  assert.equal(audits[0]?.action, "admin.org.rename");
  assert.deepEqual(audits[0]?.metadata, { previousName: "jonathanaraney", name: "Raney Apps" });

  const unchanged = await request(deps, "sess-admin", { name: "Raney Apps" });
  assert.equal(unchanged.statusCode, 200);
  assert.equal(audits.length, 1);

  const blank = await request(deps, "sess-admin", { name: "   " });
  assert.equal(blank.statusCode, 400);
  assert.equal(parseBody(blank.body).error, "invalid_org_name");

  const taken = await request(deps, "sess-admin", { name: "taken name" });
  assert.equal(taken.statusCode, 409);
  assert.equal(parseBody(taken.body).error, "org_name_taken");
  assert.equal(store.name(), "Raney Apps");

  const member = await request(deps, "sess-member", { name: "Should Fail" });
  assert.equal(member.statusCode, 403);
  assert.equal(store.name(), "Raney Apps");
})();
