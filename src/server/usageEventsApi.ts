import type { ServerResponse } from "node:http";
import { requireAuth, resolveAuthContext } from "./authMiddleware";
import type { ServerConfig } from "./serverConfig";
import type { OrgStore } from "./orgStore";
import type { UserStore } from "./users/userStore";
import { auditActor } from "./audit/auditLogger";
import type { UsageTracker } from "./usageTracker";
import type { PlanQuotaService } from "./planQuota";
import {
  PlanQuotaExceededError,
  PlanQuotaUnavailableError,
  writePlanQuotaExceededResponse,
  writePlanQuotaUnavailableResponse
} from "./planQuota";
import type { LlmProvider } from "../api/zeroRetentionConfig";
import { effectiveUsageTier } from "./usageTiers";

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
  planQuota?: PlanQuotaService;
};

const ACCEPTED_PROVIDERS = new Set<LlmProvider>(["openai", "anthropic", "gemini", "mistral"]);

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

    if (eventType === "completion.accepted" && deps.planQuota) {
      const billed = await billAcceptedCompletion(deps, auth, actor, metadata, response);
      if (billed === "quota_error") {
        return true;
      }
      if (billed === "recorded") {
        recorded += 1;
        continue;
      }
    }

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

async function billAcceptedCompletion(
  deps: UsageEventsApiDeps,
  auth: { orgId: string; plan?: string },
  actor: { userId?: string; principal: string },
  metadata: Record<string, unknown>,
  response: ServerResponse
): Promise<"recorded" | "skipped" | "quota_error"> {
  if (!deps.planQuota || !deps.orgStore) {
    return "skipped";
  }
  if (metadata.cached === true || metadata.fromCache === true) {
    return "skipped";
  }
  const inputTokens = Number(metadata.inputTokens ?? 0);
  const outputTokens = Number(metadata.outputTokens ?? 0);
  if (!Number.isFinite(inputTokens) || !Number.isFinite(outputTokens) || inputTokens + outputTokens <= 0) {
    return "skipped";
  }
  const providerRaw = String(metadata.provider ?? "").trim().toLowerCase();
  const provider = (ACCEPTED_PROVIDERS.has(providerRaw as LlmProvider)
    ? providerRaw
    : "mistral") as LlmProvider;
  const model = String(metadata.model ?? "").trim() || "codestral-latest";
  const completionQuotaId = String(metadata.completionQuotaId ?? "").trim();

  const org = await deps.orgStore.getOrganization(auth.orgId);
  if (!org) {
    return "skipped";
  }
  const plan = org.plan ?? "free";
  let usageTier = null as import("./usageTiers").UsageTier | null;
  if (actor.userId && deps.userStore) {
    const user = await deps.userStore.getUser(actor.userId);
    usageTier = effectiveUsageTier(plan, user?.usageTier);
  } else {
    usageTier = effectiveUsageTier(plan, null);
  }

  try {
    await deps.planQuota.check(
      auth.orgId,
      plan,
      Math.ceil(inputTokens + outputTokens),
      undefined,
      {
        usageTier,
        userId: actor.userId,
        selection: "auto",
        provider,
        model,
        forceAutoBucket: true,
        periodAnchor: org.createdAt
      }
    );
    await deps.planQuota.recordTokens(auth.orgId, plan, {
      eventType: "completion.accepted",
      inputTokens: Math.max(0, Math.floor(inputTokens)),
      outputTokens: Math.max(0, Math.floor(outputTokens)),
      provider,
      model,
      userId: actor.userId,
      principal: actor.principal,
      metadata: {
        ...metadata,
        ...(completionQuotaId ? { completionQuotaId } : {}),
        source: "autocomplete-accept"
      },
      selection: "auto",
      usageTier,
      forceAutoBucket: true,
      useCase: "inline_completion"
    });
    return "recorded";
  } catch (error) {
    if (error instanceof PlanQuotaExceededError) {
      writePlanQuotaExceededResponse(response, error);
      return "quota_error";
    }
    if (error instanceof PlanQuotaUnavailableError) {
      writePlanQuotaUnavailableResponse(response, error);
      return "quota_error";
    }
    throw error;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}
