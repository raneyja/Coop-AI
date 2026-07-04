// Coop validation: COOP-101 trace test
import type { ServerResponse } from "node:http";
import type { URLSearchParams } from "node:url";
import type { GitHubAppService } from "./githubAppService";
import type { GitHubAppConfig } from "./githubAppConfig";
import type { GitHubOAuthService } from "./githubOAuthService";
import type { GitHubOAuthConfig } from "./githubOAuthConfig";
import { githubOAuthSyntheticInstallationId } from "./codeHostConnectors/githubOAuthConnector";
import { assessGithubConnection } from "./codeHostCredentialResolver";
import { requireInstallAdmin } from "./authMiddleware";
import { requireCodeHostPlan, requireCodeHostPlanForOrg } from "./planGates";
import type { OrgStore } from "./orgStore";
import type { AuthContext } from "./orgStore";
import { resolveOAuthSuccessRedirectUrl, resolveGithubConnectSuccessRedirectUrl } from "./oauthCallbackRedirect";
import { createEstateSyncService, type EstateSyncService } from "./estateSyncService";
import { runCodeHostCatalogSyncAfterConnect } from "./catalogSyncService";
import type { JobQueue } from "../jobs/jobQueue";
import {
  buildGithubOAuthRedirectUri,
  githubConnectCapabilities,
  resolveGithubInstallUrl,
  type GithubInstallUrlMode
} from "./githubInstallUrl";
import {
  linkGithubInstallation,
  readGithubInstallHint,
  resolveOrgIdForGithubCallback,
  tryRelinkGithubInstallation
} from "./githubRelinkService";

export type GitHubAppApiDeps = {
  orgStore?: OrgStore;
  githubApp?: GitHubAppService;
  githubAppConfig?: GitHubAppConfig;
  githubOAuth?: GitHubOAuthService;
  githubOAuthConfig?: GitHubOAuthConfig;
  jobQueue?: JobQueue;
  estateSync?: EstateSyncService;
};

type ParsedRequest = {
  method: string;
  pathname: string;
  query: URLSearchParams;
  headers: Record<string, string | undefined>;
};

export async function handleGitHubAppApiRequest(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: GitHubAppApiDeps,
  auth?: AuthContext
): Promise<boolean> {
  if (parsed.pathname === "/v1/github/app/install-url" && parsed.method === "GET") {
    return handleInstallUrl(parsed, response, deps, auth);
  }
  if (parsed.pathname === "/v1/github/app/callback" && parsed.method === "GET") {
    return handleCallback(parsed, response, deps);
  }
  if (parsed.pathname === "/v1/orgs/github/installation" && parsed.method === "GET") {
    return handleInstallationStatus(response, deps, auth);
  }
  return false;
}

async function handleInstallUrl(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: GitHubAppApiDeps,
  auth?: AuthContext
): Promise<boolean> {
  if (!auth || auth.orgId === "legacy") {
    writeJson(response, 401, { error: "unauthorized" });
    return true;
  }
  if (!requireInstallAdmin(auth, response)) {
    return true;
  }
  if (!(await requireCodeHostPlan(deps.orgStore, auth, response, "github"))) {
    return true;
  }

  const capabilities = githubConnectCapabilities(deps);
  const modeParam = parsed.query.get("mode")?.trim().toLowerCase();
  const mode: GithubInstallUrlMode =
    modeParam === "oauth" ? "oauth" : modeParam === "app" ? "app" : "auto";

  if (mode !== "oauth") {
    const relink = await tryRelinkGithubInstallation(deps, auth.orgId);
    if (relink.outcome === "linked") {
      writeJson(response, 200, {
        connected: true,
        relinked: true,
        kind: "github_app",
        githubAppAvailable: capabilities.githubAppAvailable,
        oauthAvailable: capabilities.oauthAvailable
      });
      return true;
    }
  }

  const resolved = resolveGithubInstallUrl(deps, auth.orgId, mode);
  if (resolved) {
    const installHint = await readGithubInstallHint(deps, auth.orgId);
    writeJson(response, 200, {
      url: resolved.url,
      kind: resolved.kind,
      githubAppAvailable: resolved.githubAppAvailable,
      oauthAvailable: resolved.oauthAvailable,
      reconnect: Boolean(installHint),
      reconnectMessage: installHint
        ? "GitHub App is still installed on GitHub. If a new tab opens, click Save on that page to finish reconnecting, then return here."
        : undefined
    });
    return true;
  }

  if (mode === "oauth" && !capabilities.oauthAvailable) {
    writeJson(response, 503, {
      error: "github_oauth_not_configured",
      message:
        "GitHub OAuth is not configured on this server. Use GitHub App install or ask your Coop operator to set GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET.",
      githubAppAvailable: capabilities.githubAppAvailable,
      oauthAvailable: false
    });
    return true;
  }

  writeJson(response, 503, {
    error: "github_not_configured",
    message:
      "GitHub is not configured on this server. Set GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY (GitHub App) or GITHUB_OAUTH_CLIENT_ID + GITHUB_OAUTH_CLIENT_SECRET (OAuth App).",
    githubAppAvailable: capabilities.githubAppAvailable,
    oauthAvailable: capabilities.oauthAvailable
  });
  return true;
}

async function handleCallback(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: GitHubAppApiDeps
): Promise<boolean> {
  const code = parsed.query.get("code") ?? "";
  if (code) {
    return handleOAuthCallback(parsed, response, deps, code);
  }

  if (!deps.orgStore || !deps.githubApp) {
    writeHtml(response, 503, "GitHub App integration is not configured.");
    return true;
  }

  const installationId = Number(parsed.query.get("installation_id"));
  const state = parsed.query.get("state") ?? "";
  const setupAction = parsed.query.get("setup_action");

  if (!installationId || !Number.isFinite(installationId)) {
    writeHtml(response, 400, "Missing installation_id.");
    return true;
  }

  const orgId = await resolveOrgIdForGithubCallback(deps, state, installationId);
  if (!orgId) {
    writeHtml(
      response,
      400,
      "Invalid or expired install state. Return to the Coop admin portal → Integrations and click Connect (GitHub App) again."
    );
    return true;
  }
  if (!(await requireCodeHostPlanForOrg(deps.orgStore, orgId, response, "github", true))) {
    return true;
  }

  try {
    await linkGithubInstallation(deps, orgId, installationId);
    const redirect = resolveGithubConnectSuccessRedirectUrl();
    const actionLabel = setupAction === "update" ? "reconnected" : "installed";
    writeHtml(
      response,
      200,
      `GitHub App ${actionLabel} successfully. Returning to the Coop admin portal…`,
      redirect
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Installation failed";
    writeHtml(response, 500, message);
  }
  return true;
}

async function handleOAuthCallback(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: GitHubAppApiDeps,
  code: string
): Promise<boolean> {
  if (!deps.orgStore || !deps.githubOAuth || !deps.githubOAuthConfig) {
    writeHtml(response, 503, "GitHub OAuth is not configured on this server.");
    return true;
  }

  const state = parsed.query.get("state") ?? "";
  const errorParam = parsed.query.get("error");
  if (errorParam) {
    const desc = parsed.query.get("error_description") ?? errorParam;
    writeHtml(response, 400, `GitHub authorization denied: ${escapeHtml(desc)}`);
    return true;
  }

  const orgId = deps.githubOAuth.verifyAndParseState(state);
  if (!orgId) {
    writeHtml(response, 400, "Invalid or expired install state. Return to Coop AI and try again.");
    return true;
  }
  if (!(await requireCodeHostPlanForOrg(deps.orgStore, orgId, response, "github", true))) {
    return true;
  }

  try {
    const redirectUri = buildGithubOAuthRedirectUri(deps.githubOAuthConfig!);
    const tokens = await deps.githubOAuth.exchangeCode(code, redirectUri);
    const installationId = githubOAuthSyntheticInstallationId(orgId);

    await deps.orgStore.upsertCodeHostInstallation(
      orgId,
      "github",
      installationId,
      tokens.accessToken,
      tokens.expiresAt
    );

    if (tokens.refreshToken) {
      await deps.orgStore.storeCredential(orgId, "github:refresh", tokens.refreshToken);
    }

    void runCodeHostCatalogSyncAfterConnect(orgId, "github", tokens.accessToken, {
      orgStore: deps.orgStore,
      jobQueue: deps.jobQueue
    });

    writeHtml(
      response,
      200,
      "GitHub connected successfully. You can close this tab and return to VS Code.",
      resolveOAuthSuccessRedirectUrl(deps.githubOAuthConfig.publicBaseUrl, "github=installed")
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Authorization failed";
    writeHtml(response, 500, message);
  }
  return true;
}

async function handleInstallationStatus(
  response: ServerResponse,
  deps: GitHubAppApiDeps,
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
  const installation = await deps.orgStore.getCodeHostInstallation(auth.orgId, "github");
  const connection = await assessGithubConnection(deps.orgStore, auth.orgId);
  writeJson(response, 200, {
    installed: connection.installed,
    tokenValid: connection.tokenValid,
    needsReconnect: connection.needsReconnect,
    hasRefreshToken: connection.hasRefreshToken,
    installationId: installation?.installationId,
    tokenExpiresAt: installation?.tokenExpiresAt.toISOString()
  });
  return true;
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
    `<!DOCTYPE html><html><head><meta charset="utf-8">${meta}<title>CoopAI GitHub</title></head><body><p>${escapeHtml(message)}</p></body></html>`
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
