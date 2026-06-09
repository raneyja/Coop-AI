import type { ServerResponse } from "node:http";
import type { URLSearchParams } from "node:url";
import type { GitLabAppService } from "./gitlabAppService";
import { gitlabSyntheticInstallationId } from "./gitlabAppService";
import type { GitLabAppConfig } from "./gitlabAppConfig";
import { requireInstallAdmin } from "./authMiddleware";
import type { OrgStore, AuthContext } from "./orgStore";
import { resolveOAuthSuccessRedirectUrl } from "./oauthCallbackRedirect";

export type GitLabAppApiDeps = {
  orgStore?: OrgStore;
  gitlabApp?: GitLabAppService;
  gitlabAppConfig?: GitLabAppConfig;
};

type ParsedRequest = {
  method: string;
  pathname: string;
  query: URLSearchParams;
  headers: Record<string, string | undefined>;
};

export async function handleGitLabAppApiRequest(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: GitLabAppApiDeps,
  auth?: AuthContext
): Promise<boolean> {
  if (parsed.pathname === "/v1/gitlab/app/install-url" && parsed.method === "GET") {
    return handleInstallUrl(parsed, response, deps, auth);
  }
  if (parsed.pathname === "/v1/gitlab/app/callback" && parsed.method === "GET") {
    return handleCallback(parsed, response, deps);
  }
  if (parsed.pathname === "/v1/orgs/gitlab/installation" && parsed.method === "GET") {
    return handleInstallationStatus(response, deps, auth);
  }
  return false;
}

async function handleInstallUrl(
  _parsed: ParsedRequest,
  response: ServerResponse,
  deps: GitLabAppApiDeps,
  auth?: AuthContext
): Promise<boolean> {
  if (!auth || auth.orgId === "legacy") {
    writeJson(response, 401, { error: "unauthorized" });
    return true;
  }
  if (!requireInstallAdmin(auth, response)) {
    return true;
  }
  if (!deps.gitlabApp || !deps.gitlabAppConfig) {
    writeJson(response, 503, { error: "GitLab App is not configured on this server" });
    return true;
  }
  const redirectUri = buildRedirectUri(deps.gitlabAppConfig);
  const url = deps.gitlabApp.buildAuthorizeUrl(redirectUri, auth.orgId);
  writeJson(response, 200, { url });
  return true;
}

async function handleCallback(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: GitLabAppApiDeps
): Promise<boolean> {
  if (!deps.orgStore || !deps.gitlabApp || !deps.gitlabAppConfig) {
    writeHtml(response, 503, "GitLab App integration is not configured.");
    return true;
  }

  const code = parsed.query.get("code") ?? "";
  const state = parsed.query.get("state") ?? "";
  const errorParam = parsed.query.get("error");

  if (errorParam) {
    const desc = parsed.query.get("error_description") ?? errorParam;
    writeHtml(response, 400, `GitLab authorization denied: ${escapeHtml(desc)}`);
    return true;
  }

  if (!code) {
    writeHtml(response, 400, "Missing authorization code.");
    return true;
  }

  const orgId = deps.gitlabApp.verifyAndParseState(state);
  if (!orgId) {
    writeHtml(response, 400, "Invalid or expired install state. Return to CoopAI and try again.");
    return true;
  }

  try {
    const redirectUri = buildRedirectUri(deps.gitlabAppConfig);
    const tokens = await deps.gitlabApp.exchangeCode(code, redirectUri);

    // GitLab has no native installation ID — use a stable synthetic value derived
    // from the orgId so the record survives re-authorization unchanged.
    const installationId = gitlabSyntheticInstallationId(orgId);

    await deps.orgStore.upsertCodeHostInstallation(
      orgId,
      "gitlab",
      installationId,
      tokens.accessToken,
      tokens.expiresAt
    );

    if (tokens.refreshToken) {
      await deps.orgStore.storeCredential(orgId, "gitlab:refresh", tokens.refreshToken);
    }

    writeHtml(
      response,
      200,
      "GitLab authorized successfully. You can close this tab and return to VS Code.",
      resolveOAuthSuccessRedirectUrl(deps.gitlabAppConfig.publicBaseUrl, "gitlab=installed")
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Authorization failed";
    writeHtml(response, 500, message);
  }
  return true;
}

async function handleInstallationStatus(
  response: ServerResponse,
  deps: GitLabAppApiDeps,
  auth?: AuthContext
): Promise<boolean> {
  if (!auth || auth.orgId === "legacy") {
    writeJson(response, 401, { error: "unauthorized" });
    return true;
  }
  if (!deps.orgStore) {
    writeJson(response, 503, { error: "organization database not configured" });
    return true;
  }
  const installation = await deps.orgStore.getCodeHostInstallation(auth.orgId, "gitlab");
  writeJson(response, 200, {
    installed: Boolean(installation),
    installationId: installation?.installationId,
    tokenExpiresAt: installation?.tokenExpiresAt.toISOString()
  });
  return true;
}

function buildRedirectUri(config: GitLabAppConfig): string {
  return `${config.publicBaseUrl}/v1/gitlab/app/callback`;
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
    `<!DOCTYPE html><html><head><meta charset="utf-8">${meta}<title>CoopAI GitLab</title></head><body><p>${escapeHtml(message)}</p></body></html>`
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
