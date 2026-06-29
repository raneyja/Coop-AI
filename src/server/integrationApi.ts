import type { ServerResponse } from "node:http";
import type { AuthContext } from "./orgStore";
import type { IntegrationConnectionStore, IntegrationProvider } from "./integrationConnectionStore";
import type { IntegrationScopePolicyStore } from "./integrationScopePolicyStore";
import type { OrgStore } from "./orgStore";
import type { AtlassianAppService } from "./atlassianAppService";
import type { NotionAppService } from "./notionAppService";
import type { GoogleDocsAppService } from "./googleDocsAppService";
import type { SlackAppService } from "./slackAppService";
import type { TeamsAppService } from "./teamsAppService";
import { resolveIntegrationScope } from "./resolveIntegrationScope";

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

const CREDENTIAL_PROVIDERS: IntegrationProvider[] = [
  "slack",
  "atlassian",
  "notion",
  "google-docs",
  "teams"
];

export type IntegrationApiDeps = {
  integrationStore?: IntegrationConnectionStore;
  scopePolicyStore?: IntegrationScopePolicyStore;
  orgStore?: OrgStore;
  atlassianApp?: AtlassianAppService;
  notionApp?: NotionAppService;
  googleDocsApp?: GoogleDocsAppService;
  teamsApp?: TeamsAppService;
  slackApp?: SlackAppService;
};

type ParsedRequest = {
  method: string;
  pathname: string;
  query: URLSearchParams;
  headers: Record<string, string | undefined>;
  body: unknown;
};

export async function handleIntegrationApiRequest(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: IntegrationApiDeps,
  auth?: AuthContext
): Promise<boolean> {
  if (parsed.method === "GET" && parsed.pathname === "/v1/orgs/integrations/credentials") {
    return handleIntegrationCredentials(parsed, response, deps, auth);
  }
  if (parsed.method === "GET" && parsed.pathname === "/v1/orgs/integrations/scope") {
    return handleIntegrationScope(parsed, response, deps, auth);
  }
  return false;
}

async function handleIntegrationCredentials(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: IntegrationApiDeps,
  auth?: AuthContext
): Promise<boolean> {
  if (!auth || auth.orgId === "legacy") {
    writeJson(response, 401, { error: "unauthorized" });
    return true;
  }
  if (!deps.integrationStore) {
    writeJson(response, 503, { error: "organization database not configured" });
    return true;
  }

  const provider = parsed.query.get("provider") as IntegrationProvider | null;
  if (!provider || !CREDENTIAL_PROVIDERS.includes(provider)) {
    writeJson(response, 400, { error: "invalid provider" });
    return true;
  }

  const connection = await deps.integrationStore.get(auth.orgId, provider);
  if (!connection) {
    writeJson(response, 404, { error: "not connected" });
    return true;
  }

  const accessToken = await resolveAccessToken(auth.orgId, provider, deps);
  if (!accessToken) {
    writeJson(response, 404, { error: "not connected" });
    return true;
  }

  writeJson(response, 200, {
    provider,
    accessToken,
    metadata: sanitizeMetadata(connection.metadata as Record<string, unknown>),
    tokenExpiresAt: connection.tokenExpiresAt?.toISOString()
  });
  return true;
}

async function handleIntegrationScope(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: IntegrationApiDeps,
  auth?: AuthContext
): Promise<boolean> {
  if (!auth || auth.orgId === "legacy") {
    writeJson(response, 401, { error: "unauthorized" });
    return true;
  }

  const provider = parsed.query.get("provider") as IntegrationProvider | null;
  if (!provider || !CREDENTIAL_PROVIDERS.includes(provider)) {
    writeJson(response, 400, { error: "invalid provider" });
    return true;
  }

  const org = deps.orgStore ? await deps.orgStore.getOrganization(auth.orgId) : undefined;
  const connection = deps.integrationStore
    ? await deps.integrationStore.get(auth.orgId, provider)
    : undefined;
  const resolved = await resolveIntegrationScope({
    orgId: auth.orgId,
    provider,
    orgPlan: org?.plan ?? auth.plan ?? "free",
    connected: Boolean(connection),
    scopePolicyStore: deps.scopePolicyStore
  });

  writeJson(response, 200, resolved);
  return true;
}

function sanitizeMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const { encryptedBotToken: _bot, ...rest } = metadata;
  return rest;
}

async function resolveAccessToken(
  orgId: string,
  provider: IntegrationProvider,
  deps: IntegrationApiDeps
): Promise<string | undefined> {
  const store = deps.integrationStore!;
  const connection = await store.get(orgId, provider);
  if (!connection) {
    return undefined;
  }

  const expiresAt = connection.tokenExpiresAt?.getTime();
  if (!expiresAt || expiresAt - Date.now() > TOKEN_REFRESH_BUFFER_MS) {
    const cached = await store.getAccessToken(orgId, provider);
    if (cached) {
      return cached;
    }
  }

  const refreshToken = await store.getRefreshToken(orgId, provider);
  if (!refreshToken) {
    return store.getAccessToken(orgId, provider);
  }

  if (provider === "atlassian" && deps.atlassianApp) {
    const refreshed = await deps.atlassianApp.refreshAccessToken(refreshToken);
    await store.upsert(orgId, provider, refreshed.accessToken, {
      refreshToken: refreshed.refreshToken,
      expiresAt: refreshed.expiresAt,
      metadata: connection.metadata
    });
    return refreshed.accessToken;
  }

  if (provider === "notion" && deps.notionApp) {
    const refreshed = await deps.notionApp.refreshAccessToken(refreshToken);
    await store.upsert(orgId, provider, refreshed.accessToken, {
      refreshToken: refreshed.refreshToken,
      metadata: connection.metadata
    });
    return refreshed.accessToken;
  }

  if (provider === "google-docs" && deps.googleDocsApp) {
    const refreshed = await deps.googleDocsApp.refreshAccessToken(refreshToken);
    await store.upsert(orgId, provider, refreshed.accessToken, {
      refreshToken: refreshed.refreshToken,
      expiresAt: refreshed.expiresAt,
      metadata: connection.metadata
    });
    return refreshed.accessToken;
  }

  if (provider === "teams" && deps.teamsApp) {
    const refreshed = await deps.teamsApp.refreshAccessToken(refreshToken);
    await store.upsert(orgId, provider, refreshed.accessToken, {
      refreshToken: refreshed.refreshToken,
      expiresAt: refreshed.expiresAt,
      metadata: connection.metadata
    });
    return refreshed.accessToken;
  }

  if (provider === "slack" && deps.slackApp) {
    const refreshed = await deps.slackApp.refreshAccessToken(refreshToken);
    await store.upsert(orgId, provider, refreshed.accessToken, {
      refreshToken: refreshed.refreshToken,
      expiresAt: refreshed.expiresAt,
      metadata: connection.metadata
    });
    return refreshed.accessToken;
  }

  return store.getAccessToken(orgId, provider);
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}
