import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ServerResponse } from "node:http";
import { handleChatThreadsApiRequest, type ChatThreadsApiDeps } from "./chatThreadsApi";
import type { AuthContext, OrgStore } from "./orgStore";
import type { ServerConfig } from "./serverConfig";
import type { ResolvedUserSession, UserRecord, UserStore } from "./users/userStore";
import type {
  ChatMessageRow,
  ChatThreadRow,
  ChatThreadsStore,
  ListThreadsFilters,
  UpsertThreadInput
} from "./chatThreadsStore";

const ORG_ID = "org-test";

const ADMIN_A = "admin-a";
const ADMIN_C = "admin-c";
const MEMBER_B = "member-b";

const TOKENS = {
  adminA: "sess-admin-a",
  memberB: "sess-member-b",
  adminC: "sess-admin-c",
  apiKey: "org-api-key"
} as const;

function session(userId: string, role: string, email: string): ResolvedUserSession {
  return {
    userId,
    orgId: ORG_ID,
    orgName: "Test Org",
    plan: "pro",
    role,
    email
  };
}

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
  const apiKeyAuth: AuthContext = {
    orgId: ORG_ID,
    orgName: "Test Org",
    plan: "pro",
    apiKeyId: "key-1"
  };
  return {
    resolveAuth: async (token: string) => (token === TOKENS.apiKey ? apiKeyAuth : undefined),
    isOrgSuspended: async () => false,
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
  const sessions: Record<string, ResolvedUserSession> = {
    [TOKENS.adminA]: session(ADMIN_A, "admin", "admin-a@test.com"),
    [TOKENS.memberB]: session(MEMBER_B, "member", "member-b@test.com"),
    [TOKENS.adminC]: session(ADMIN_C, "admin", "admin-c@test.com")
  };
  const users: Record<string, UserRecord> = {
    [ADMIN_A]: {
      id: ADMIN_A,
      orgId: ORG_ID,
      email: "admin-a@test.com",
      role: "admin",
      status: "active",
      createdAt: new Date()
    } as UserRecord,
    [MEMBER_B]: {
      id: MEMBER_B,
      orgId: ORG_ID,
      email: "member-b@test.com",
      role: "member",
      status: "active",
      createdAt: new Date()
    } as UserRecord,
    [ADMIN_C]: {
      id: ADMIN_C,
      orgId: ORG_ID,
      email: "admin-c@test.com",
      role: "admin",
      status: "active",
      createdAt: new Date()
    } as UserRecord
  };
  return {
    resolveUserSession: async (token: string) => sessions[token],
    getUser: async (userId: string) => users[userId],
    findActiveUserByEmail: async (email: string) =>
      Object.values(users).find((user) => user.email === email)
  } as unknown as UserStore;
}

function threadRow(partial: {
  id: string;
  userId: string;
  principal: string;
  title: string;
}): ChatThreadRow {
  const now = new Date("2026-09-01T12:00:00.000Z");
  return {
    id: partial.id,
    orgId: ORG_ID,
    userId: partial.userId,
    principal: partial.principal,
    title: partial.title,
    repoOwner: "acme",
    repoName: "api",
    repoProvider: "github",
    messageCount: 1,
    previewText: `${partial.title} preview`,
    createdAt: now,
    updatedAt: now
  };
}

function messageRow(threadId: string, content: string): ChatMessageRow {
  return {
    id: `${threadId}-msg-1`,
    threadId,
    role: "user",
    content,
    metadata: {},
    createdAt: new Date("2026-09-01T12:00:00.000Z"),
    sortOrder: 0
  };
}

class MemoryChatThreadsStore {
  public threads = new Map<string, ChatThreadRow>();
  public messages = new Map<string, ChatMessageRow[]>();

  public seed(thread: ChatThreadRow, messages: ChatMessageRow[]): void {
    this.threads.set(thread.id, thread);
    this.messages.set(thread.id, messages);
  }

  public async listThreads(filters: ListThreadsFilters) {
    if (!filters.memberScope) {
      return { threads: [] as ChatThreadRow[] };
    }
    const matches = [...this.threads.values()].filter((thread) => {
      if (thread.orgId !== filters.orgId) {
        return false;
      }
      const scope = filters.memberScope!;
      if (scope.userId) {
        if (thread.userId !== scope.userId && thread.principal !== scope.principal) {
          return false;
        }
      } else if (thread.principal !== scope.principal) {
        return false;
      }
      if (filters.userId && thread.userId !== filters.userId) {
        return false;
      }
      if (filters.query?.trim()) {
        const needle = filters.query.trim().toLowerCase();
        const hay = `${thread.title} ${thread.previewText ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) {
          return false;
        }
      }
      return true;
    });
    return { threads: matches };
  }

  public async getThread(orgId: string, threadId: string) {
    const thread = this.threads.get(threadId);
    return thread?.orgId === orgId ? thread : undefined;
  }

  public async getThreadMessages(threadId: string) {
    return this.messages.get(threadId) ?? [];
  }

  public async upsertThread(input: UpsertThreadInput): Promise<ChatThreadRow> {
    const now = new Date("2026-09-18T12:00:00.000Z");
    const row: ChatThreadRow = {
      id: input.id,
      orgId: input.orgId,
      userId: input.userId,
      principal: input.principal,
      title: input.title,
      repoOwner: input.repoOwner,
      repoName: input.repoName,
      repoProvider: input.repoProvider,
      messageCount: input.messages.length,
      previewText: input.previewText,
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now
    };
    this.threads.set(row.id, row);
    this.messages.set(
      row.id,
      input.messages.map((message, index) => ({
        id: message.id,
        threadId: row.id,
        role: message.role,
        content: message.content,
        metadata: message.metadata ?? {},
        createdAt: now,
        sortOrder: message.sortOrder ?? index
      }))
    );
    return row;
  }
}

function baseDeps(store: MemoryChatThreadsStore): ChatThreadsApiDeps {
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
    threadsStore: store as unknown as ChatThreadsStore
  };
}

function seedOrgThreads(store: MemoryChatThreadsStore): {
  adminA: ChatThreadRow;
  memberB: ChatThreadRow;
  adminC: ChatThreadRow;
  apiKey: ChatThreadRow;
} {
  const adminA = threadRow({
    id: "thread-admin-a",
    userId: ADMIN_A,
    principal: `user:${ADMIN_A}`,
    title: "Admin A chat"
  });
  const memberB = threadRow({
    id: "thread-member-b",
    userId: MEMBER_B,
    principal: `user:${MEMBER_B}`,
    title: "Member B chat"
  });
  const adminC = threadRow({
    id: "thread-admin-c",
    userId: ADMIN_C,
    principal: `user:${ADMIN_C}`,
    title: "Admin C chat"
  });
  const apiKey = threadRow({
    id: "thread-apikey",
    userId: ADMIN_A,
    principal: "apikey:key-1",
    title: "API key chat"
  });
  apiKey.userId = undefined;
  store.seed(adminA, [messageRow(adminA.id, "admin-a secret")]);
  store.seed(memberB, [messageRow(memberB.id, "member-b secret")]);
  store.seed(adminC, [messageRow(adminC.id, "admin-c secret")]);
  store.seed(apiKey, [messageRow(apiKey.id, "apikey secret")]);
  return { adminA, memberB, adminC, apiKey };
}

async function request(
  deps: ChatThreadsApiDeps,
  options: {
    method: string;
    pathname: string;
    token?: string;
    query?: URLSearchParams;
    body?: unknown;
  }
): Promise<{ statusCode?: number; body?: string; json: Record<string, unknown> }> {
  const response = mockResponse();
  const headers: Record<string, string | undefined> = {};
  if (options.token) {
    headers.authorization = `Bearer ${options.token}`;
  }
  const handled = await handleChatThreadsApiRequest(
    {
      method: options.method,
      pathname: options.pathname,
      query: options.query,
      headers,
      body: options.body ?? null
    },
    response,
    deps
  );
  assert.equal(handled, true);
  return {
    statusCode: response.statusCode,
    body: response.body,
    json: JSON.parse(response.body ?? "{}") as Record<string, unknown>
  };
}

function threadIds(json: Record<string, unknown>): string[] {
  const threads = json.threads as Array<{ id: string }> | undefined;
  return (threads ?? []).map((thread) => thread.id).sort();
}

void (async () => {
  const store = new MemoryChatThreadsStore();
  const seeded = seedOrgThreads(store);
  const deps = baseDeps(store);

  const memberList = await request(deps, {
    method: "GET",
    pathname: "/v1/threads",
    token: TOKENS.memberB
  });
  assert.equal(memberList.statusCode, 200);
  assert.deepEqual(threadIds(memberList.json), ["thread-member-b"]);

  const adminList = await request(deps, {
    method: "GET",
    pathname: "/v1/threads",
    token: TOKENS.adminA
  });
  assert.equal(adminList.statusCode, 200);
  assert.deepEqual(threadIds(adminList.json), ["thread-admin-a"]);
  assert.equal(
    (adminList.json.threads as Array<{ id: string }>).some((thread) => thread.id === "thread-member-b"),
    false
  );
  assert.equal(
    (adminList.json.threads as Array<{ id: string }>).some((thread) => thread.id === "thread-admin-c"),
    false
  );

  const adminPeekMember = await request(deps, {
    method: "GET",
    pathname: "/v1/threads",
    token: TOKENS.adminA,
    query: new URLSearchParams({ userId: MEMBER_B })
  });
  assert.equal(adminPeekMember.statusCode, 200);
  assert.equal(
    (adminPeekMember.json.threads as Array<{ id: string }>).some((thread) => thread.id === "thread-member-b"),
    false
  );

  const memberPeekAdmin = await request(deps, {
    method: "GET",
    pathname: "/v1/threads",
    token: TOKENS.memberB,
    query: new URLSearchParams({ userId: ADMIN_A })
  });
  assert.equal(memberPeekAdmin.statusCode, 200);
  assert.equal(
    (memberPeekAdmin.json.threads as Array<{ id: string }>).some((thread) => thread.id === "thread-admin-a"),
    false
  );

  const adminGetMember = await request(deps, {
    method: "GET",
    pathname: `/v1/threads/${seeded.memberB.id}`,
    token: TOKENS.adminA
  });
  assert.equal(adminGetMember.statusCode, 404);
  assert.equal(adminGetMember.json.error, "thread_not_found");

  const memberGetAdmin = await request(deps, {
    method: "GET",
    pathname: `/v1/threads/${seeded.adminA.id}`,
    token: TOKENS.memberB
  });
  assert.equal(memberGetAdmin.statusCode, 404);
  assert.equal(memberGetAdmin.json.error, "thread_not_found");

  const ownerGetOwn = await request(deps, {
    method: "GET",
    pathname: `/v1/threads/${seeded.adminA.id}`,
    token: TOKENS.adminA
  });
  assert.equal(ownerGetOwn.statusCode, 200);
  const ownThread = ownerGetOwn.json.thread as { id: string };
  assert.equal(ownThread.id, "thread-admin-a");
  const ownMessages = ownerGetOwn.json.messages as Array<{ content: string }>;
  assert.equal(ownMessages[0]?.content, "admin-a secret");

  const adminPutOther = await request(deps, {
    method: "PUT",
    pathname: `/v1/threads/${seeded.memberB.id}`,
    token: TOKENS.adminA,
    body: { title: "hijack", messages: [{ role: "user", content: "nope" }] }
  });
  assert.equal(adminPutOther.statusCode, 403);
  assert.equal(adminPutOther.json.error, "forbidden");

  const adminPutOwn = await request(deps, {
    method: "PUT",
    pathname: `/v1/threads/${seeded.adminA.id}`,
    token: TOKENS.adminA,
    body: {
      title: "Admin A chat updated",
      messages: [{ role: "user", content: "still mine", sortOrder: 0 }]
    }
  });
  assert.equal(adminPutOwn.statusCode, 200);
  assert.equal((adminPutOwn.json.thread as { title: string }).title, "Admin A chat updated");

  const memberPutOwn = await request(deps, {
    method: "PUT",
    pathname: "/v1/threads/thread-member-b-new",
    token: TOKENS.memberB,
    body: {
      title: "New member thread",
      messages: [{ role: "user", content: "hello" }]
    }
  });
  assert.equal(memberPutOwn.statusCode, 200);
  assert.equal((memberPutOwn.json.thread as { userId: string }).userId, MEMBER_B);

  const unauthenticated = await request(deps, {
    method: "GET",
    pathname: "/v1/threads"
  });
  assert.equal(unauthenticated.statusCode, 401);
  assert.equal(unauthenticated.json.error, "unauthorized");

  const apiKeyList = await request(deps, {
    method: "GET",
    pathname: "/v1/threads",
    token: TOKENS.apiKey
  });
  assert.equal(apiKeyList.statusCode, 200);
  assert.deepEqual(threadIds(apiKeyList.json), ["thread-apikey"]);
  assert.equal(
    (apiKeyList.json.threads as Array<{ id: string }>).some((thread) =>
      ["thread-admin-a", "thread-member-b", "thread-admin-c"].includes(thread.id)
    ),
    false
  );

  const apiKeyGetMember = await request(deps, {
    method: "GET",
    pathname: `/v1/threads/${seeded.memberB.id}`,
    token: TOKENS.apiKey
  });
  assert.equal(apiKeyGetMember.statusCode, 404);

  const adminCList = await request(deps, {
    method: "GET",
    pathname: "/v1/threads",
    token: TOKENS.adminC
  });
  assert.equal(adminCList.statusCode, 200);
  assert.deepEqual(threadIds(adminCList.json), ["thread-admin-c"]);

  const repoRoot = join(__dirname, "../..");
  const feedPage = readFileSync(join(repoRoot, "admin/src/app/(admin)/feed/page.tsx"), "utf8");
  assert.match(feedPage, /fetchThreads\(/);
  assert.match(feedPage, /fetchThread\(/);
  assert.doesNotMatch(feedPage, /userId/);
  assert.doesNotMatch(feedPage, /browse org/i);
  assert.match(feedPage, /Your chats synced/);

  const coopApi = readFileSync(join(repoRoot, "admin/src/lib/coopApi.ts"), "utf8");
  assert.doesNotMatch(coopApi, /search\.set\("userId"/);

  const adminDocs = readFileSync(join(repoRoot, "website/content/docs/admin-portal.md"), "utf8");
  assert.doesNotMatch(adminDocs, /Browse org chat threads/);
  assert.match(adminDocs, /Your own chats synced from the VS Code extension/);

  console.log("chatThreadsApi.test.ts: ok");
})();
