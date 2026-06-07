// Coop validation: COOP-101 trace test
import type { ServerResponse } from "node:http";
import type { URLSearchParams } from "node:url";
import type { GitHubAppService } from "./githubAppService";
import type { GitHubAppConfig } from "./githubAppConfig";
import { requireInstallAdmin } from "./authMiddleware";
import type { OrgStore } from "./orgStore";
import type { AuthContext } from "./orgStore";

export type GitHubAppApiDeps = {
  orgStore?: OrgStore;
  githubApp?: GitHubAppService;
  githubAppConfig?: GitHubAppConfig;
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
  if (!deps.githubApp || !deps.githubAppConfig) {
    writeJson(response, 503, { error: "GitHub App is not configured on this server" });
    return true;
  }
  const url = deps.githubApp.buildInstallUrl(deps.githubAppConfig.slug, auth.orgId);
  writeJson(response, 200, { url });
  return true;
}

async function handleCallback(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: GitHubAppApiDeps
): Promise<boolean> {
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

  const orgId = deps.githubApp.verifyAndParseState(state);
  if (!orgId) {
    writeHtml(response, 400, "Invalid or expired install state. Return to CoopAI and try again.");
    return true;
  }

  try {
    const token = await deps.githubApp.createInstallationAccessToken(installationId);
    await deps.orgStore.upsertCodeHostInstallation(
      orgId,
      "github",
      installationId,
      token.token,
      token.expiresAt
    );
    const redirect =
      deps.githubAppConfig?.publicBaseUrl.replace(/\/$/, "") ??
      "https://coop-ai.dev";
    writeHtml(
      response,
      200,
      `GitHub App installed successfully (${setupAction ?? "install"}). You can close this tab and return to VS Code.`,
      `${redirect}/docs?github=installed`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Installation failed";
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
  writeJson(response, 200, {
    installed: Boolean(installation),
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
