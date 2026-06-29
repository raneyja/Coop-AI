import type { ServerResponse } from "node:http";
import { SlackClient } from "../api/slack/slackClient";
import {
  parseSlackIntegrationPolicy,
  slackPolicyIsActive,
  type SlackIntegrationPolicy
} from "../integrationScope/types";
import { applySlackChannelScope } from "../integrationScope/slackQuery";
import { auditActor } from "./audit/auditLogger";
import { writeJson, type AdminApiDeps } from "./adminApiShared";
import type { AuthContext } from "./orgStore";
import type { IntegrationProvider } from "./integrationConnectionStore";
import { resolveIntegrationScope } from "./resolveIntegrationScope";

type ParsedRequest = {
  method: string;
  pathname: string;
  query?: URLSearchParams;
  body: unknown;
};

const SCOPED_PROVIDERS: IntegrationProvider[] = ["slack", "atlassian", "notion", "google-docs"];

export async function handleAdminIntegrationScopeRequest(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: AdminApiDeps,
  auth: AuthContext
): Promise<boolean> {
  const scopeMatch = parsed.pathname.match(/^\/v1\/admin\/integrations\/([^/]+)\/scope$/);
  if (scopeMatch) {
    const provider = decodeURIComponent(scopeMatch[1]) as IntegrationProvider;
    if (!SCOPED_PROVIDERS.includes(provider)) {
      writeJson(response, 400, { error: "unknown provider" });
      return true;
    }
    if (parsed.method === "GET") {
      return handleGetScope(response, deps, auth, provider);
    }
    if (parsed.method === "PUT") {
      return handlePutScope(parsed, response, deps, auth, provider);
    }
    writeJson(response, 405, { error: "method not allowed" });
    return true;
  }

  const resourcesMatch = parsed.pathname.match(/^\/v1\/admin\/integrations\/([^/]+)\/resources$/);
  if (resourcesMatch && parsed.method === "GET") {
    const provider = decodeURIComponent(resourcesMatch[1]) as IntegrationProvider;
    if (provider !== "slack") {
      writeJson(response, 200, { provider, resources: [], comingSoon: true });
      return true;
    }
    return handleGetResources(parsed, response, deps, auth);
  }

  const testMatch = parsed.pathname.match(/^\/v1\/admin\/integrations\/([^/]+)\/test$/);
  if (testMatch && parsed.method === "POST") {
    const provider = decodeURIComponent(testMatch[1]) as IntegrationProvider;
    if (provider !== "slack") {
      writeJson(response, 501, { error: "test not implemented for provider" });
      return true;
    }
    return handleTestSlack(response, deps, auth);
  }

  return false;
}

async function handleGetScope(
  response: ServerResponse,
  deps: AdminApiDeps,
  auth: AuthContext,
  provider: IntegrationProvider
): Promise<boolean> {
  const org = await deps.orgStore!.getOrganization(auth.orgId);
  const connection = deps.integrationStore
    ? await deps.integrationStore.get(auth.orgId, provider)
    : undefined;
  const resolved = await resolveIntegrationScope({
    orgId: auth.orgId,
    provider,
    orgPlan: org?.plan ?? "free",
    connected: Boolean(connection),
    scopePolicyStore: deps.scopePolicyStore
  });
  const record = deps.scopePolicyStore
    ? await deps.scopePolicyStore.get(auth.orgId, provider)
    : undefined;

  writeJson(response, 200, {
    provider,
    installed: Boolean(connection),
    scopeStatus: resolved.scopeStatus,
    enforced: resolved.enforced,
    allowed: resolved.allowed,
    policy: record?.policy ?? {},
    summary: scopeSummary(provider, record?.policy),
    updatedAt: record?.updatedAt?.toISOString()
  });
  return true;
}

async function handlePutScope(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: AdminApiDeps,
  auth: AuthContext,
  provider: IntegrationProvider
): Promise<boolean> {
  if (!deps.scopePolicyStore) {
    writeJson(response, 503, { error: "scope policy store not configured" });
    return true;
  }
  if (provider !== "slack") {
    writeJson(response, 501, { error: "scope configuration coming soon for this provider" });
    return true;
  }

  const connection = deps.integrationStore
    ? await deps.integrationStore.get(auth.orgId, provider)
    : undefined;
  if (!connection) {
    writeJson(response, 400, { error: "integration not connected" });
    return true;
  }

  const body = parsed.body as { policy?: unknown } | null;
  const policy = parseSlackIntegrationPolicy(body?.policy);
  if (!policy) {
    writeJson(response, 400, { error: "invalid slack scope policy" });
    return true;
  }

  const saved = await deps.scopePolicyStore.upsert(auth.orgId, provider, policy);
  const actor = auditActor(auth);
  await deps.auditLogger?.record({
    orgId: auth.orgId,
    userId: actor.userId,
    principal: actor.principal,
    action: "admin.integration.scope.updated",
    metadata: {
      provider,
      channelCount: policy.channels.length
    }
  });

  const org = await deps.orgStore!.getOrganization(auth.orgId);
  const resolved = await resolveIntegrationScope({
    orgId: auth.orgId,
    provider,
    orgPlan: org?.plan ?? "free",
    connected: true,
    scopePolicyStore: deps.scopePolicyStore
  });

  writeJson(response, 200, {
    provider,
    scopeStatus: resolved.scopeStatus,
    policy: saved.policy,
    summary: scopeSummary(provider, saved.policy)
  });
  return true;
}

async function handleGetResources(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: AdminApiDeps,
  auth: AuthContext
): Promise<boolean> {
  if (!deps.integrationStore) {
    writeJson(response, 503, { error: "integration store not configured" });
    return true;
  }

  const botToken = await deps.integrationStore.getBotAccessToken(auth.orgId, "slack");
  if (!botToken) {
    writeJson(response, 400, {
      error: "Slack bot token unavailable. Disconnect and reconnect Slack to refresh channel access."
    });
    return true;
  }

  const query = parsed.query?.get("q")?.trim().toLowerCase() ?? "";
  const client = new SlackClient({ token: botToken });
  const channels = await client.listChannels({ limit: 500 });
  const filtered = query
    ? channels.filter(
        (channel) =>
          channel.name.toLowerCase().includes(query) ||
          channel.id.toLowerCase().includes(query) ||
          channel.topic?.toLowerCase().includes(query)
      )
    : channels;

  writeJson(response, 200, {
    provider: "slack",
    resources: filtered.map((channel) => ({
      id: channel.id,
      name: channel.name,
      isPrivate: channel.isPrivate,
      topic: channel.topic
    }))
  });
  return true;
}

async function handleTestSlack(
  response: ServerResponse,
  deps: AdminApiDeps,
  auth: AuthContext
): Promise<boolean> {
  if (!deps.integrationStore) {
    writeJson(response, 503, { error: "integration store not configured" });
    return true;
  }

  const org = await deps.orgStore!.getOrganization(auth.orgId);
  const connection = await deps.integrationStore.get(auth.orgId, "slack");
  if (!connection) {
    writeJson(response, 400, { ok: false, message: "Slack is not connected." });
    return true;
  }

  const resolved = await resolveIntegrationScope({
    orgId: auth.orgId,
    provider: "slack",
    orgPlan: org?.plan ?? "free",
    connected: true,
    scopePolicyStore: deps.scopePolicyStore
  });

  if (resolved.enforced && !resolved.allowed) {
    writeJson(response, 200, {
      ok: false,
      message: resolved.reason ?? "Configure allowed Slack channels before testing."
    });
    return true;
  }

  const userToken = await deps.integrationStore.getAccessToken(auth.orgId, "slack");
  if (!userToken) {
    writeJson(response, 400, { ok: false, message: "Slack access token unavailable." });
    return true;
  }

  const client = new SlackClient({ token: userToken });
  const channelIds = resolved.slack?.channelIds ?? [];
  const channelNames = resolved.slack?.channelNames ?? [];
  const baseQuery = channelNames[0] ? `in:${channelNames[0]}` : "*";
  const queries =
    resolved.enforced && channelIds.length > 0
      ? applySlackChannelScope([baseQuery], channelIds, channelNames)
      : [baseQuery];

  try {
    const hits = await client.searchMessages(queries[0] ?? baseQuery, { limit: 3 });
    const allowed = new Set(channelIds);
    const scopedHits =
      allowed.size > 0
        ? hits.filter((hit) => !hit.channelId || allowed.has(hit.channelId))
        : hits;
    const channelLabel = channelNames[0] ? `#${channelNames[0]}` : "workspace";
    writeJson(response, 200, {
      ok: true,
      message:
        resolved.enforced && channelIds.length > 0
          ? `Scoped Slack search succeeded (${scopedHits.length} recent hit(s) in allowlisted channels; tested ${channelLabel}).`
          : `Slack search succeeded (${scopedHits.length} recent hit(s) in ${channelLabel}).`
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Slack scoped test failed.";
    writeJson(response, 200, { ok: false, message });
  }
  return true;
}

function scopeSummary(provider: IntegrationProvider, policy: unknown): string | undefined {
  if (provider !== "slack") {
    return undefined;
  }
  const slackPolicy = parseSlackIntegrationPolicy(policy);
  if (!slackPolicyIsActive(slackPolicy)) {
    return undefined;
  }
  const count = slackPolicy!.channels.length;
  return count === 1 ? "1 channel selected" : `${count} channels selected`;
}

export async function resolveScopeStatusForIntegration(
  deps: AdminApiDeps,
  orgId: string,
  orgPlan: string,
  provider: IntegrationProvider,
  installed: boolean
): Promise<{ scopeStatus: string; scopeSummary?: string }> {
  if (!SCOPED_PROVIDERS.includes(provider)) {
    return { scopeStatus: "none" };
  }
  const resolved = await resolveIntegrationScope({
    orgId,
    provider,
    orgPlan,
    connected: installed,
    scopePolicyStore: deps.scopePolicyStore
  });
  const record = deps.scopePolicyStore ? await deps.scopePolicyStore.get(orgId, provider) : undefined;
  return {
    scopeStatus: resolved.scopeStatus,
    scopeSummary: scopeSummary(provider, record?.policy)
  };
}
