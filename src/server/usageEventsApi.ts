import type { ServerResponse } from "node:http";
import { requireAuth, resolveAuthContext } from "./authMiddleware";
import type { ServerConfig } from "./serverConfig";
import type { OrgStore } from "./orgStore";
import type { UserStore } from "./users/userStore";
import { auditActor } from "./audit/auditLogger";
import type { UsageTracker } from "./usageTracker";

type ParsedRequest = {
  method: string;
  pathname: string;
  headers: Record<string, string | undefined>;
  body: unknown;
};

export type UsageEventsApiDeps = {
  orgStore?: OrgStore;
  userStore?: UserStore;
  serverConfig: ServerConfig;
  usageTracker?: UsageTracker;
};

export async function handleUsageEventsApiRequest(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: UsageEventsApiDeps
): Promise<boolean> {
  if (parsed.method !== "POST" || parsed.pathname !== "/v1/usage/events") {
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
  if (!deps.usageTracker) {
    writeJson(response, 503, { error: "usage tracking not configured" });
    return true;
  }

  const body = asRecord(parsed.body);
  const events = Array.isArray(body.events) ? body.events : [body];
  const actor = auditActor(auth);
  let recorded = 0;

  for (const raw of events) {
    const item = asRecord(raw);
    const eventType = String(item.eventType ?? item.event_type ?? "").trim();
    if (!eventType) {
      continue;
    }
    const metadata =
      typeof item.metadata === "object" && item.metadata !== null
        ? (item.metadata as Record<string, unknown>)
        : {};
    await deps.usageTracker.record({
      orgId: auth.orgId,
      userId: actor.userId,
      principal: actor.principal,
      eventType,
      metadata
    });
    recorded += 1;
  }

  writeJson(response, 200, { ok: true, recorded });
  return true;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}
