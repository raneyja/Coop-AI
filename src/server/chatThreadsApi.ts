import type { ServerResponse } from "node:http";
import { auditActor } from "./audit/auditLogger";
import { requireAuth, resolveAuthContext } from "./authMiddleware";
import { getDbPool, requireDbPool } from "./db";
import type { OrgStore } from "./orgStore";
import type { ServerConfig } from "./serverConfig";
import type { UserStore } from "./users/userStore";
import {
  ChatThreadsStore,
  decodeThreadCursor,
  type ChatMessageRow,
  type ChatThreadRow
} from "./chatThreadsStore";

type ParsedRequest = {
  method: string;
  pathname: string;
  query?: URLSearchParams;
  headers: Record<string, string | undefined>;
  body: unknown;
};

export type ChatThreadsApiDeps = {
  orgStore?: OrgStore;
  userStore?: UserStore;
  serverConfig: ServerConfig;
};

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function threadToJson(thread: ChatThreadRow) {
  return {
    id: thread.id,
    orgId: thread.orgId,
    userId: thread.userId,
    principal: thread.principal,
    title: thread.title,
    repoOwner: thread.repoOwner,
    repoName: thread.repoName,
    repoProvider: thread.repoProvider,
    messageCount: thread.messageCount,
    previewText: thread.previewText,
    createdAt: thread.createdAt.toISOString(),
    updatedAt: thread.updatedAt.toISOString()
  };
}

function messageToJson(message: ChatMessageRow) {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    metadata: message.metadata,
    createdAt: message.createdAt.toISOString(),
    sortOrder: message.sortOrder
  };
}

function previewFromMessages(
  messages: Array<{ role: string; content: string }>
): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user" || message.role === "assistant") {
      const trimmed = message.content.trim().replace(/\s+/g, " ");
      if (trimmed) {
        return trimmed.length > 240 ? `${trimmed.slice(0, 237)}…` : trimmed;
      }
    }
  }
  return undefined;
}

function parseRepoFilter(value: string | null): { owner?: string; name?: string } {
  const raw = value?.trim();
  if (!raw) {
    return {};
  }
  const slash = raw.indexOf("/");
  if (slash <= 0) {
    return {};
  }
  return {
    owner: raw.slice(0, slash).trim() || undefined,
    name: raw.slice(slash + 1).trim() || undefined
  };
}

function threadOwnedByAuth(thread: ChatThreadRow, auth: import("./orgStore").AuthContext): boolean {
  const actor = auditActor(auth);
  if (auth.userId && thread.userId === auth.userId) {
    return true;
  }
  return thread.principal === actor.principal;
}

function personalThreadScope(auth: import("./orgStore").AuthContext, actor: ReturnType<typeof auditActor>) {
  return { userId: auth.userId, principal: actor.principal };
}

function parseOptionalDate(value: unknown): Date | undefined {
  if (value == null || value === "") {
    return undefined;
  }
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export async function handleChatThreadsApiRequest(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: ChatThreadsApiDeps
): Promise<boolean> {
  if (!parsed.pathname.startsWith("/v1/threads")) {
    return false;
  }

  const auth = await resolveAuthContext(
    parsed.headers,
    deps.orgStore,
    deps.serverConfig.legacyApiToken,
    deps.serverConfig.requireApiAuth,
    deps.userStore
  );
  if (!requireAuth(auth, deps.serverConfig.requireApiAuth) || !auth) {
    writeJson(response, 401, { error: "unauthorized" });
    return true;
  }

  if (auth.orgId === "legacy") {
    writeJson(response, 503, { error: "organization database not configured" });
    return true;
  }

  const pool = await getDbPool();
  if (!pool) {
    writeJson(response, 503, { error: "database not configured" });
    return true;
  }

  const store = new ChatThreadsStore(requireDbPool(pool));
  const actor = auditActor(auth);
  const memberScope = personalThreadScope(auth, actor);

  if (parsed.method === "GET" && parsed.pathname === "/v1/threads") {
    const query = parsed.query;
    const limit = Math.min(Math.max(Number(query?.get("limit") ?? 50), 1), 100);
    const repo = parseRepoFilter(query?.get("repo") ?? null);
    const fromRaw = query?.get("from")?.trim();
    const toRaw = query?.get("to")?.trim();
    const cursor = decodeThreadCursor(query?.get("cursor")?.trim() ?? "");

    const result = await store.listThreads({
      orgId: auth.orgId,
      from: fromRaw ? new Date(fromRaw) : undefined,
      to: toRaw ? new Date(toRaw) : undefined,
      repoOwner: repo.owner,
      repoName: repo.name,
      query: query?.get("q")?.trim() || undefined,
      limit,
      cursor,
      memberScope
    });

    writeJson(response, 200, {
      threads: result.threads.map(threadToJson),
      nextCursor: result.nextCursor
    });
    return true;
  }

  const threadMatch = parsed.pathname.match(/^\/v1\/threads\/([^/]+)$/);
  if (threadMatch) {
    const threadId = decodeURIComponent(threadMatch[1]);

    if (parsed.method === "GET") {
      const thread = await store.getThread(auth.orgId, threadId);
      if (!thread || !threadOwnedByAuth(thread, auth)) {
        writeJson(response, 404, { error: "thread_not_found" });
        return true;
      }
      const messages = await store.getThreadMessages(threadId);
      writeJson(response, 200, {
        thread: threadToJson(thread),
        messages: messages.map(messageToJson)
      });
      return true;
    }

    if (parsed.method === "PUT") {
      const body = asRecord(parsed.body);
      const title = String(body.title ?? "New Chat").trim() || "New Chat";
      const repoOwner = body.repoOwner ? String(body.repoOwner).trim() : undefined;
      const repoName = body.repoName ? String(body.repoName).trim() : undefined;
      const repoProvider = body.repoProvider ? String(body.repoProvider).trim() : undefined;
      const rawMessages = Array.isArray(body.messages) ? body.messages : [];

      const existing = await store.getThread(auth.orgId, threadId);
      if (existing && !threadOwnedByAuth(existing, auth)) {
        writeJson(response, 403, { error: "forbidden" });
        return true;
      }

      let threadUserId = auth.userId;
      if (!threadUserId && deps.userStore) {
        const ownerEmail = String(body.ownerEmail ?? "").trim();
        if (ownerEmail) {
          const owner = await deps.userStore.findActiveUserByOrgEmail(auth.orgId, ownerEmail);
          if (owner && owner.orgId === auth.orgId) {
            threadUserId = owner.id;
          }
        }
      }
      if (!threadUserId && existing?.userId) {
        threadUserId = existing.userId;
      }

      const messages = rawMessages.map((raw, index) => {
        const item = asRecord(raw);
        const role = String(item.role ?? "user");
        const content = String(item.content ?? "");
        const metadata =
          typeof item.metadata === "object" && item.metadata !== null && !Array.isArray(item.metadata)
            ? (item.metadata as Record<string, unknown>)
            : {};
        const id = String(item.id ?? `${threadId}-msg-${index}`);
        return {
          id,
          role,
          content,
          metadata,
          sortOrder: Number(item.sortOrder ?? index)
        };
      });

      const thread = await store.upsertThread({
        id: threadId,
        orgId: auth.orgId,
        userId: threadUserId,
        principal: actor.principal,
        title,
        repoOwner,
        repoName,
        repoProvider,
        previewText: previewFromMessages(messages),
        createdAt: parseOptionalDate(body.createdAt),
        updatedAt: parseOptionalDate(body.updatedAt),
        messages
      });

      writeJson(response, 200, { thread: threadToJson(thread) });
      return true;
    }

    writeJson(response, 405, { error: "method_not_allowed" });
    return true;
  }

  writeJson(response, 404, { error: "not_found" });
  return true;
}
