import type { ServerResponse } from "node:http";
import type { AuthContext } from "./orgStore";
import type { IntegrationConnectionStore, IntegrationProvider } from "./integrationConnectionStore";
import type { AtlassianAppService } from "./atlassianAppService";

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

export type IntegrationApiDeps = {
  integrationStore?: IntegrationConnectionStore;
  atlassianApp?: AtlassianAppService;
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
  if (provider !== "slack" && provider !== "atlassian") {
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
    metadata: connection.metadata,
    tokenExpiresAt: connection.tokenExpiresAt?.toISOString()
  });
  return true;
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

  if (provider === "atlassian" && deps.atlassianApp) {
    const refreshToken = await store.getRefreshToken(orgId, provider);
    if (refreshToken) {
      const refreshed = await deps.atlassianApp.refreshAccessToken(refreshToken);
      await store.upsert(orgId, provider, refreshed.accessToken, {
        refreshToken: refreshed.refreshToken,
        expiresAt: refreshed.expiresAt,
        metadata: connection.metadata
      });
      return refreshed.accessToken;
    }
  }

  return store.getAccessToken(orgId, provider);
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}
