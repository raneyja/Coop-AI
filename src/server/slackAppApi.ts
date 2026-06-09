import type { ServerResponse } from "node:http";
import type { URLSearchParams } from "node:url";
import { requireInstallAdmin } from "./authMiddleware";
import type { AuthContext } from "./orgStore";
import type { IntegrationConnectionStore } from "./integrationConnectionStore";
import type { SlackAppConfig } from "./slackAppConfig";
import type { SlackAppService } from "./slackAppService";
import { resolveOAuthSuccessRedirectUrl } from "./oauthCallbackRedirect";

export type SlackAppApiDeps = {
  integrationStore?: IntegrationConnectionStore;
  slackApp?: SlackAppService;
  slackAppConfig?: SlackAppConfig;
};

type ParsedRequest = {
  method: string;
  pathname: string;
  query: URLSearchParams;
  headers: Record<string, string | undefined>;
};

export async function handleSlackAppApiRequest(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: SlackAppApiDeps,
  auth?: AuthContext
): Promise<boolean> {
  if (parsed.pathname === "/v1/slack/app/install-url" && parsed.method === "GET") {
    return handleInstallUrl(response, deps, auth);
  }
  if (parsed.pathname === "/v1/slack/app/callback" && parsed.method === "GET") {
    return handleCallback(parsed, response, deps);
  }
  if (parsed.pathname === "/v1/orgs/slack/installation" && parsed.method === "GET") {
    return handleInstallationStatus(response, deps, auth);
  }
  return false;
}

async function handleInstallUrl(
  response: ServerResponse,
  deps: SlackAppApiDeps,
  auth?: AuthContext
): Promise<boolean> {
  if (!auth || auth.orgId === "legacy") {
    writeJson(response, 401, { error: "unauthorized" });
    return true;
  }
  if (!requireInstallAdmin(auth, response)) {
    return true;
  }
  if (!deps.slackApp || !deps.slackAppConfig) {
    writeJson(response, 503, { error: "Slack App is not configured on this server" });
    return true;
  }
  const redirectUri = buildRedirectUri(deps.slackAppConfig);
  const url = deps.slackApp.buildAuthorizeUrl(redirectUri, auth.orgId);
  writeJson(response, 200, { url });
  return true;
}

async function handleCallback(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: SlackAppApiDeps
): Promise<boolean> {
  if (!deps.integrationStore || !deps.slackApp || !deps.slackAppConfig) {
    writeHtml(response, 503, "Slack integration is not configured.");
    return true;
  }

  const code = parsed.query.get("code") ?? "";
  const state = parsed.query.get("state") ?? "";
  const errorParam = parsed.query.get("error");

  if (errorParam) {
    const desc = parsed.query.get("error_description") ?? errorParam;
    writeHtml(response, 400, `Slack authorization denied: ${escapeHtml(desc)}`);
    return true;
  }
  if (!code) {
    writeHtml(response, 400, "Missing authorization code.");
    return true;
  }

  const orgId = deps.slackApp.verifyAndParseState(state);
  if (!orgId) {
    writeHtml(response, 400, "Invalid or expired install state. Return to Coop AI and try again.");
    return true;
  }

  try {
    const redirectUri = buildRedirectUri(deps.slackAppConfig);
    const tokens = await deps.slackApp.exchangeCode(code, redirectUri);
    await deps.integrationStore.upsert(orgId, "slack", tokens.userAccessToken, {
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      metadata: {
        teamId: tokens.teamId,
        teamName: tokens.teamName,
        userId: tokens.authedUserId
      }
    });

    writeHtml(
      response,
      200,
      `Slack connected to ${escapeHtml(tokens.teamName)}. You can close this tab and return to VS Code.`,
      resolveOAuthSuccessRedirectUrl(deps.slackAppConfig.publicBaseUrl, "slack=connected")
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Authorization failed";
    writeHtml(response, 500, message);
  }
  return true;
}

async function handleInstallationStatus(
  response: ServerResponse,
  deps: SlackAppApiDeps,
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
  const connection = await deps.integrationStore.get(auth.orgId, "slack");
  writeJson(response, 200, {
    installed: Boolean(connection),
    teamName: connection?.metadata.teamName,
    teamId: connection?.metadata.teamId,
    tokenExpiresAt: connection?.tokenExpiresAt?.toISOString()
  });
  return true;
}

function buildRedirectUri(config: SlackAppConfig): string {
  return `${config.publicBaseUrl}/v1/slack/app/callback`;
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
    `<!DOCTYPE html><html><head><meta charset="utf-8">${meta}<title>Coop AI · Slack</title></head><body><p>${escapeHtml(message)}</p></body></html>`
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
