import type { ServerResponse } from "node:http";
import type { URLSearchParams } from "node:url";
import { requireInstallAdmin } from "./authMiddleware";
import type { AuthContext } from "./orgStore";
import type { IntegrationConnectionStore } from "./integrationConnectionStore";
import type { GoogleDocsAppConfig } from "./googleDocsAppConfig";
import type { GoogleDocsAppService } from "./googleDocsAppService";
import { resolveOAuthSuccessRedirectUrl } from "./oauthCallbackRedirect";

export type GoogleDocsAppApiDeps = {
  integrationStore?: IntegrationConnectionStore;
  googleDocsApp?: GoogleDocsAppService;
  googleDocsAppConfig?: GoogleDocsAppConfig;
};

type ParsedRequest = {
  method: string;
  pathname: string;
  query: URLSearchParams;
  headers: Record<string, string | undefined>;
};

export async function handleGoogleDocsAppApiRequest(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: GoogleDocsAppApiDeps,
  auth?: AuthContext
): Promise<boolean> {
  if (parsed.pathname === "/v1/google-docs/app/install-url" && parsed.method === "GET") {
    return handleInstallUrl(response, deps, auth);
  }
  if (parsed.pathname === "/v1/google-docs/app/callback" && parsed.method === "GET") {
    return handleCallback(parsed, response, deps);
  }
  if (parsed.pathname === "/v1/orgs/google-docs/installation" && parsed.method === "GET") {
    return handleInstallationStatus(response, deps, auth);
  }
  return false;
}

async function handleInstallUrl(
  response: ServerResponse,
  deps: GoogleDocsAppApiDeps,
  auth?: AuthContext
): Promise<boolean> {
  if (!auth || auth.orgId === "legacy") {
    writeJson(response, 401, { error: "unauthorized" });
    return true;
  }
  if (!requireInstallAdmin(auth, response)) {
    return true;
  }
  if (!deps.googleDocsApp || !deps.googleDocsAppConfig) {
    writeJson(response, 503, { error: "Google Docs App is not configured on this server" });
    return true;
  }
  const redirectUri = buildRedirectUri(deps.googleDocsAppConfig);
  const url = deps.googleDocsApp.buildAuthorizeUrl(redirectUri, auth.orgId);
  writeJson(response, 200, { url });
  return true;
}

async function handleCallback(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: GoogleDocsAppApiDeps
): Promise<boolean> {
  if (!deps.integrationStore || !deps.googleDocsApp || !deps.googleDocsAppConfig) {
    writeHtml(response, 503, "Google Docs integration is not configured.");
    return true;
  }

  const code = parsed.query.get("code") ?? "";
  const state = parsed.query.get("state") ?? "";
  const errorParam = parsed.query.get("error");

  if (errorParam) {
    const desc = parsed.query.get("error_description") ?? errorParam;
    writeHtml(response, 400, `Google authorization denied: ${escapeHtml(desc)}`);
    return true;
  }
  if (!code) {
    writeHtml(response, 400, "Missing authorization code.");
    return true;
  }

  const orgId = deps.googleDocsApp.verifyAndParseState(state);
  if (!orgId) {
    writeHtml(response, 400, "Invalid or expired install state. Return to Coop AI and try again.");
    return true;
  }

  try {
    const redirectUri = buildRedirectUri(deps.googleDocsAppConfig);
    const tokens = await deps.googleDocsApp.exchangeCode(code, redirectUri);
    const label = tokens.displayName ?? tokens.email ?? "Google account";
    await deps.integrationStore.upsert(orgId, "google-docs", tokens.accessToken, {
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      metadata: {
        displayName: tokens.displayName,
        email: tokens.email
      }
    });

    writeHtml(
      response,
      200,
      `Google Docs connected for ${escapeHtml(label)}. You can close this tab and return to VS Code.`,
      resolveOAuthSuccessRedirectUrl(deps.googleDocsAppConfig.publicBaseUrl, "google-docs=connected")
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Authorization failed";
    writeHtml(response, 500, message);
  }
  return true;
}

async function handleInstallationStatus(
  response: ServerResponse,
  deps: GoogleDocsAppApiDeps,
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
  const connection = await deps.integrationStore.get(auth.orgId, "google-docs");
  writeJson(response, 200, {
    installed: Boolean(connection),
    displayName: connection?.metadata.displayName,
    email: connection?.metadata.email,
    tokenExpiresAt: connection?.tokenExpiresAt?.toISOString()
  });
  return true;
}

function buildRedirectUri(config: GoogleDocsAppConfig): string {
  return `${config.publicBaseUrl}/v1/google-docs/app/callback`;
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
    `<!DOCTYPE html><html><head><meta charset="utf-8">${meta}<title>Coop AI · Google Docs</title></head><body><p>${escapeHtml(message)}</p></body></html>`
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
