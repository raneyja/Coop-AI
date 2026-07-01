import type { ServerResponse } from "node:http";
import type { URLSearchParams } from "node:url";
import { requireInstallAdmin } from "./authMiddleware";
import type { AuthContext } from "./orgStore";
import type { IntegrationConnectionStore } from "./integrationConnectionStore";
import type { NotionAppConfig } from "./notionAppConfig";
import { isNotionOAuthConfig } from "./notionAppConfig";
import type { NotionAppService } from "./notionAppService";
import { NotionClient } from "../api/notion/notionClient";
import { resolveOAuthSuccessRedirectUrl } from "./oauthCallbackRedirect";

export type NotionAppApiDeps = {
  integrationStore?: IntegrationConnectionStore;
  notionApp?: NotionAppService;
  notionAppConfig?: NotionAppConfig;
};

type ParsedRequest = {
  method: string;
  pathname: string;
  query: URLSearchParams;
  headers: Record<string, string | undefined>;
};

export async function handleNotionAppApiRequest(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: NotionAppApiDeps,
  auth?: AuthContext
): Promise<boolean> {
  if (parsed.pathname === "/v1/notion/app/install-url" && parsed.method === "GET") {
    return handleInstallUrl(response, deps, auth);
  }
  if (parsed.pathname === "/v1/notion/app/callback" && parsed.method === "GET") {
    return handleCallback(parsed, response, deps);
  }
  if (parsed.pathname === "/v1/orgs/notion/installation" && parsed.method === "GET") {
    return handleInstallationStatus(response, deps, auth);
  }
  return false;
}

async function handleInstallUrl(
  response: ServerResponse,
  deps: NotionAppApiDeps,
  auth?: AuthContext
): Promise<boolean> {
  if (!auth || auth.orgId === "legacy") {
    writeJson(response, 401, { error: "unauthorized" });
    return true;
  }
  if (!requireInstallAdmin(auth, response)) {
    return true;
  }
  if (!deps.notionAppConfig) {
    writeJson(response, 503, {
      error:
        "Notion is not configured. Set NOTION_INTEGRATION_TOKEN (internal integration) or NOTION_APP_CLIENT_ID and NOTION_APP_CLIENT_SECRET (OAuth) in .env.backend."
    });
    return true;
  }

  if (deps.notionAppConfig.mode === "internal") {
    if (!deps.integrationStore) {
      writeJson(response, 503, { error: "organization database not configured" });
      return true;
    }
    try {
      const client = new NotionClient({ token: deps.notionAppConfig.integrationToken });
      const test = await client.testConnection();
      if (!test.ok) {
        writeJson(response, 400, {
          error: formatNotionInternalTokenError(test.message)
        });
        return true;
      }
      const profile = await client.getBotProfile();
      await deps.integrationStore.upsert(auth.orgId, "notion", deps.notionAppConfig.integrationToken, {
        metadata: {
          workspaceId: profile.workspaceId,
          workspaceName: profile.workspaceName,
          botId: profile.botId
        }
      });
      writeJson(response, 200, {
        connected: true,
        workspaceName: profile.workspaceName
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Notion connection failed.";
      writeJson(response, 400, { error: message });
    }
    return true;
  }

  if (!deps.notionApp) {
    writeJson(response, 503, {
      error:
        "Notion OAuth is not configured. Set NOTION_APP_CLIENT_ID and NOTION_APP_CLIENT_SECRET from a public OAuth integration at notion.so/my-integrations."
    });
    return true;
  }
  const redirectUri = buildRedirectUri(deps.notionAppConfig);
  const url = deps.notionApp.buildAuthorizeUrl(redirectUri, auth.orgId);
  writeJson(response, 200, { url });
  return true;
}

async function handleCallback(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: NotionAppApiDeps
): Promise<boolean> {
  if (!deps.integrationStore || !deps.notionAppConfig || !isNotionOAuthConfig(deps.notionAppConfig)) {
    writeHtml(response, 503, "Notion OAuth is not configured.");
    return true;
  }
  if (!deps.notionApp) {
    writeHtml(response, 503, "Notion OAuth is not configured.");
    return true;
  }

  const code = parsed.query.get("code") ?? "";
  const state = parsed.query.get("state") ?? "";
  const errorParam = parsed.query.get("error");

  if (errorParam) {
    const desc = parsed.query.get("error_description") ?? errorParam;
    writeHtml(response, 400, `Notion authorization denied: ${escapeHtml(desc)}`);
    return true;
  }
  if (!code) {
    writeHtml(response, 400, "Missing authorization code.");
    return true;
  }

  const orgId = deps.notionApp.verifyAndParseState(state);
  if (!orgId) {
    writeHtml(response, 400, "Invalid or expired install state. Return to Coop AI and try again.");
    return true;
  }

  try {
    const redirectUri = buildRedirectUri(deps.notionAppConfig);
    const tokens = await deps.notionApp.exchangeCode(code, redirectUri);
    await deps.integrationStore.upsert(orgId, "notion", tokens.accessToken, {
      refreshToken: tokens.refreshToken,
      metadata: {
        workspaceId: tokens.workspaceId,
        workspaceName: tokens.workspaceName,
        botId: tokens.botId
      }
    });

    writeHtml(
      response,
      200,
      `Notion connected to ${escapeHtml(tokens.workspaceName)}. You can close this tab and return to VS Code.`,
      resolveOAuthSuccessRedirectUrl(deps.notionAppConfig.publicBaseUrl, "notion=connected")
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Authorization failed";
    writeHtml(response, 500, message);
  }
  return true;
}

async function handleInstallationStatus(
  response: ServerResponse,
  deps: NotionAppApiDeps,
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
  const connection = await deps.integrationStore.get(auth.orgId, "notion");
  writeJson(response, 200, {
    installed: Boolean(connection),
    workspaceName: connection?.metadata.workspaceName,
    workspaceId: connection?.metadata.workspaceId,
    tokenExpiresAt: connection?.tokenExpiresAt?.toISOString()
  });
  return true;
}

function buildRedirectUri(config: NotionAppConfig): string {
  return `${config.publicBaseUrl}/v1/notion/app/callback`;
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
    `<!DOCTYPE html><html><head><meta charset="utf-8">${meta}<title>Coop AI · Notion</title></head><body><p>${escapeHtml(message)}</p></body></html>`
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatNotionInternalTokenError(message: string): string {
  if (/API token is invalid|unauthorized/i.test(message)) {
    return (
      "Notion internal token is invalid. In notion.so/my-integrations → your internal integration → " +
      "Configuration, copy Internal integration secret into NOTION_INTEGRATION_TOKEN in .env.backend " +
      "(not the OAuth client secret)."
    );
  }
  return message;
}
