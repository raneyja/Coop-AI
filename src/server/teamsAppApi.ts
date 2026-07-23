import type { ServerResponse } from "node:http";
import type { URLSearchParams } from "node:url";
import { requireInstallAdmin } from "./authMiddleware";
import type { AuthContext } from "./orgStore";
import type { IntegrationConnectionStore } from "./integrationConnectionStore";
import { describeTeamsAppConfigProblem, type TeamsAppConfig } from "./teamsAppConfig";
import type { TeamsAppService } from "./teamsAppService";
import { resolveOAuthSuccessRedirectUrl } from "./oauthCallbackRedirect";

export type TeamsAppApiDeps = {
  integrationStore?: IntegrationConnectionStore;
  teamsApp?: TeamsAppService;
  teamsAppConfig?: TeamsAppConfig;
};

type ParsedRequest = {
  method: string;
  pathname: string;
  query: URLSearchParams;
  headers: Record<string, string | undefined>;
};

export async function handleTeamsAppApiRequest(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: TeamsAppApiDeps,
  auth?: AuthContext
): Promise<boolean> {
  if (parsed.pathname === "/v1/teams/app/install-url" && parsed.method === "GET") {
    return handleInstallUrl(response, deps, auth);
  }
  // Canonical callback + trailing-slash variant. Also accept API-root OAuth returns when
  // Azure Entra has a misconfigured redirect URI of https://api.coop-ai.dev (no path).
  if (parsed.method === "GET" && isTeamsOAuthCallbackPath(parsed.pathname, parsed.query)) {
    return handleCallback(parsed, response, deps);
  }
  if (parsed.pathname === "/v1/orgs/teams/installation" && parsed.method === "GET") {
    return handleInstallationStatus(response, deps, auth);
  }
  return false;
}

function isTeamsOAuthCallbackPath(pathname: string, query: URLSearchParams): boolean {
  if (pathname === "/v1/teams/app/callback" || pathname === "/v1/teams/app/callback/") {
    return true;
  }
  if (pathname === "/" && (query.has("code") || query.has("error"))) {
    return true;
  }
  return false;
}

async function handleInstallUrl(
  response: ServerResponse,
  deps: TeamsAppApiDeps,
  auth?: AuthContext
): Promise<boolean> {
  if (!auth || auth.orgId === "legacy") {
    writeJson(response, 401, { error: "unauthorized" });
    return true;
  }
  if (!requireInstallAdmin(auth, response)) {
    return true;
  }
  if (!deps.teamsApp || !deps.teamsAppConfig) {
    const configProblem = describeTeamsAppConfigProblem();
    writeJson(response, 503, {
      error: configProblem ?? "Teams App is not configured on this server"
    });
    return true;
  }
  const redirectUri = buildRedirectUri(deps.teamsAppConfig);
  const url = deps.teamsApp.buildAuthorizeUrl(redirectUri, auth.orgId);
  writeJson(response, 200, { url });
  return true;
}

async function handleCallback(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: TeamsAppApiDeps
): Promise<boolean> {
  if (!deps.integrationStore || !deps.teamsApp || !deps.teamsAppConfig) {
    writeHtml(response, 503, "Microsoft Teams integration is not configured.");
    return true;
  }

  const code = parsed.query.get("code") ?? "";
  const state = parsed.query.get("state") ?? "";
  const errorParam = parsed.query.get("error");
  const errorDescription = parsed.query.get("error_description");

  if (errorParam) {
    const desc = errorDescription ?? errorParam;
    writeHtml(response, 400, `Microsoft authorization denied: ${escapeHtml(desc)}`);
    return true;
  }
  if (!code) {
    writeHtml(response, 400, "Missing authorization code.");
    return true;
  }

  const orgId = deps.teamsApp.verifyAndParseState(state);
  if (!orgId) {
    writeHtml(response, 400, "Invalid or expired install state. Return to Coop AI and try again.");
    return true;
  }

  try {
    // Token exchange redirect_uri must match the authorize request exactly. If Entra
    // redirected to API root, exchange against the root URI; otherwise the canonical callback.
    const redirectUri = buildRedirectUri(deps.teamsAppConfig, parsed.pathname);
    const tokens = await deps.teamsApp.exchangeCode(code, redirectUri);
    const label = tokens.displayName ?? tokens.email ?? "Microsoft account";
    await deps.integrationStore.upsert(orgId, "teams", tokens.accessToken, {
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      metadata: {
        displayName: tokens.displayName,
        email: tokens.email,
        tenantId: tokens.tenantId
      }
    });

    writeHtml(
      response,
      200,
      `Microsoft Teams connected for ${escapeHtml(label)}. You can close this tab and return to VS Code.`,
      resolveOAuthSuccessRedirectUrl(deps.teamsAppConfig.publicBaseUrl, "teams=connected")
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Authorization failed";
    writeHtml(response, 500, message);
  }
  return true;
}

async function handleInstallationStatus(
  response: ServerResponse,
  deps: TeamsAppApiDeps,
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
  const connection = await deps.integrationStore.get(auth.orgId, "teams");
  writeJson(response, 200, {
    installed: Boolean(connection),
    displayName: connection?.metadata.displayName,
    email: connection?.metadata.email,
    tenantId: connection?.metadata.tenantId,
    tokenExpiresAt: connection?.tokenExpiresAt?.toISOString()
  });
  return true;
}

function buildRedirectUri(config: TeamsAppConfig, callbackPath = "/v1/teams/app/callback"): string {
  if (callbackPath === "/" || callbackPath === "") {
    return config.publicBaseUrl.replace(/\/$/, "");
  }
  return `${config.publicBaseUrl.replace(/\/$/, "")}/v1/teams/app/callback`;
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function writeHtml(
  response: ServerResponse,
  statusCode: number,
  message: string,
  redirectUrl?: string
): void {
  const meta = redirectUrl
    ? `<meta http-equiv="refresh" content="3;url=${escapeHtml(redirectUrl)}">`
    : "";
  response.writeHead(statusCode, { "content-type": "text/html; charset=utf-8" });
  response.end(
    `<!DOCTYPE html><html><head><meta charset="utf-8">${meta}<title>Coop AI · Microsoft Teams</title></head><body><p>${escapeHtml(message)}</p></body></html>`
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
