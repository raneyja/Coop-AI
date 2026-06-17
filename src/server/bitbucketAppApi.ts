import type { ServerResponse } from "node:http";
import type { URLSearchParams } from "node:url";
import type { BitbucketAppService } from "./bitbucketAppService";
import { bitbucketSyntheticInstallationId } from "./bitbucketAppService";
import type { BitbucketAppConfig } from "./bitbucketAppConfig";
import { requireInstallAdmin } from "./authMiddleware";
import { requireCodeHostPlan, requireCodeHostPlanForOrg } from "./planGates";
import type { OrgStore, AuthContext } from "./orgStore";
import { resolveOAuthSuccessRedirectUrl } from "./oauthCallbackRedirect";
import { runCodeHostCatalogSyncAfterConnect } from "./catalogSyncService";
import type { JobQueue } from "../jobs/jobQueue";

export type BitbucketAppApiDeps = {
  orgStore?: OrgStore;
  bitbucketApp?: BitbucketAppService;
  bitbucketAppConfig?: BitbucketAppConfig;
  jobQueue?: JobQueue;
};

type ParsedRequest = {
  method: string;
  pathname: string;
  query: URLSearchParams;
  headers: Record<string, string | undefined>;
};

export async function handleBitbucketAppApiRequest(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: BitbucketAppApiDeps,
  auth?: AuthContext
): Promise<boolean> {
  if (parsed.pathname === "/v1/bitbucket/app/install-url" && parsed.method === "GET") {
    return handleInstallUrl(parsed, response, deps, auth);
  }
  if (parsed.pathname === "/v1/bitbucket/app/callback" && parsed.method === "GET") {
    return handleCallback(parsed, response, deps);
  }
  if (parsed.pathname === "/v1/orgs/bitbucket/installation" && parsed.method === "GET") {
    return handleInstallationStatus(response, deps, auth);
  }
  return false;
}

async function handleInstallUrl(
  _parsed: ParsedRequest,
  response: ServerResponse,
  deps: BitbucketAppApiDeps,
  auth?: AuthContext
): Promise<boolean> {
  if (!auth || auth.orgId === "legacy") {
    writeJson(response, 401, { error: "unauthorized" });
    return true;
  }
  if (!requireInstallAdmin(auth, response)) {
    return true;
  }
  if (!(await requireCodeHostPlan(deps.orgStore, auth, response, "bitbucket"))) {
    return true;
  }
  if (!deps.bitbucketApp || !deps.bitbucketAppConfig) {
    writeJson(response, 503, { error: "Bitbucket App is not configured on this server" });
    return true;
  }
  const redirectUri = buildRedirectUri(deps.bitbucketAppConfig);
  const url = deps.bitbucketApp.buildAuthorizeUrl(redirectUri, auth.orgId);
  writeJson(response, 200, { url });
  return true;
}

async function handleCallback(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: BitbucketAppApiDeps
): Promise<boolean> {
  if (!deps.orgStore || !deps.bitbucketApp || !deps.bitbucketAppConfig) {
    writeHtml(response, 503, "Bitbucket App integration is not configured.");
    return true;
  }

  const code = parsed.query.get("code") ?? "";
  const state = parsed.query.get("state") ?? "";
  const errorParam = parsed.query.get("error");

  if (errorParam) {
    const desc = parsed.query.get("error_description") ?? errorParam;
    writeHtml(response, 400, `Bitbucket authorization denied: ${escapeHtml(desc)}`);
    return true;
  }

  if (!code) {
    writeHtml(response, 400, "Missing authorization code.");
    return true;
  }

  const orgId = deps.bitbucketApp.verifyAndParseState(state);
  if (!orgId) {
    writeHtml(response, 400, "Invalid or expired install state. Return to CoopAI and try again.");
    return true;
  }

  if (!(await requireCodeHostPlanForOrg(deps.orgStore, orgId, response, "bitbucket", true))) {
    return true;
  }

  try {
    const redirectUri = buildRedirectUri(deps.bitbucketAppConfig);
    const tokens = await deps.bitbucketApp.exchangeCode(code, redirectUri);

    const installationId = bitbucketSyntheticInstallationId(orgId);

    await deps.orgStore.upsertCodeHostInstallation(
      orgId,
      "bitbucket",
      installationId,
      tokens.accessToken,
      tokens.expiresAt
    );

    if (tokens.refreshToken) {
      await deps.orgStore.storeCredential(orgId, "bitbucket:refresh", tokens.refreshToken);
    }

    void runCodeHostCatalogSyncAfterConnect(orgId, "bitbucket", tokens.accessToken, {
      orgStore: deps.orgStore,
      jobQueue: deps.jobQueue
    });

    writeHtml(
      response,
      200,
      "Bitbucket authorized successfully. You can close this tab and return to VS Code.",
      resolveOAuthSuccessRedirectUrl(deps.bitbucketAppConfig.publicBaseUrl, "bitbucket=installed")
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Authorization failed";
    writeHtml(response, 500, message);
  }
  return true;
}

async function handleInstallationStatus(
  response: ServerResponse,
  deps: BitbucketAppApiDeps,
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
  const installation = await deps.orgStore.getCodeHostInstallation(auth.orgId, "bitbucket");
  writeJson(response, 200, {
    installed: Boolean(installation),
    installationId: installation?.installationId,
    tokenExpiresAt: installation?.tokenExpiresAt.toISOString()
  });
  return true;
}

function buildRedirectUri(config: BitbucketAppConfig): string {
  return `${config.publicBaseUrl}/v1/bitbucket/app/callback`;
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
    `<!DOCTYPE html><html><head><meta charset="utf-8">${meta}<title>CoopAI Bitbucket</title></head><body><p>${escapeHtml(message)}</p></body></html>`
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
