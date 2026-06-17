import type { ServerResponse } from "node:http";
import { auditActor } from "./audit/auditLogger";
import type { AuthContext } from "./orgStore";
import type { IntegrationProvider } from "./integrationConnectionStore";
import { assessGithubConnection } from "./codeHostCredentialResolver";
import { writeJson, type AdminApiDeps } from "./adminApiShared";

type ParsedRequest = {
  method: string;
  pathname: string;
};

const ALL_PROVIDERS = [
  "github",
  "gitlab",
  "bitbucket",
  "slack",
  "atlassian",
  "notion",
  "google-docs",
  "teams"
] as const;

type AnyProvider = (typeof ALL_PROVIDERS)[number];

type CodeHostProvider = "github" | "gitlab" | "bitbucket";

const CODE_HOST_PROVIDERS: CodeHostProvider[] = ["github", "gitlab", "bitbucket"];

const INTEGRATION_PROVIDERS: IntegrationProvider[] = [
  "slack",
  "atlassian",
  "notion",
  "google-docs",
  "teams"
];

/**
 * Bulk integration status for the customer admin portal.
 *
 * To connect a provider, redirect the admin to the existing install-url routes
 * (same auth: owner/admin SSO session or org API key):
 *   GET /v1/github/app/install-url
 *   GET /v1/gitlab/app/install-url
 *   GET /v1/bitbucket/app/install-url
 *   GET /v1/slack/app/install-url
 *   GET /v1/atlassian/app/install-url
 *   GET /v1/notion/app/install-url
 *   GET /v1/google-docs/app/install-url
 *   GET /v1/teams/app/install-url
 */
export async function handleAdminIntegrationsRequest(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: AdminApiDeps,
  auth: AuthContext
): Promise<boolean> {
  const disconnectMatch = parsed.pathname.match(/^\/v1\/admin\/integrations\/([^/]+)$/);
  if (disconnectMatch && parsed.method === "DELETE") {
    const provider = decodeURIComponent(disconnectMatch[1]) as AnyProvider;
    if (!ALL_PROVIDERS.includes(provider)) {
      writeJson(response, 400, { error: "unknown provider" });
      return true;
    }
    if (provider === "github" || provider === "gitlab" || provider === "bitbucket") {
      await deps.orgStore!.deleteCodeHostInstallation(auth.orgId, provider);
      if (provider === "github") {
        await deps.orgStore!.deleteCredential(auth.orgId, "github:refresh");
      }
    } else {
      await deps.integrationStore!.delete(auth.orgId, provider);
    }
    const actor = auditActor(auth);
    await deps.auditLogger?.record({
      orgId: auth.orgId,
      userId: actor.userId,
      principal: actor.principal,
      action: "admin.integration.disconnect",
      metadata: { provider }
    });
    writeJson(response, 200, { ok: true, provider });
    return true;
  }

  if (parsed.method !== "GET" || parsed.pathname !== "/v1/admin/integrations") {
    return false;
  }

  const integrations = [
    ...(await Promise.all(CODE_HOST_PROVIDERS.map((provider) => loadCodeHostStatus(deps, auth.orgId, provider)))),
    ...(await Promise.all(
      INTEGRATION_PROVIDERS.map((provider) => loadIntegrationStatus(deps, auth.orgId, provider))
    ))
  ];

  writeJson(response, 200, { integrations });
  return true;
}

async function loadCodeHostStatus(deps: AdminApiDeps, orgId: string, provider: CodeHostProvider) {
  const installation = await deps.orgStore!.getCodeHostInstallation(orgId, provider);
  if (provider === "github") {
    const connection = await assessGithubConnection(deps.orgStore!, orgId);
    return {
      provider,
      installed: connection.installed && connection.tokenValid,
      needsReconnect: connection.needsReconnect,
      installUrlPath: `/v1/${provider}/app/install-url`,
      metadata: installation
        ? {
            installationId: installation.installationId,
            tokenExpiresAt: installation.tokenExpiresAt,
            connectedAt: installation.createdAt,
            hasRefreshToken: connection.hasRefreshToken
          }
        : {}
    };
  }
  return {
    provider,
    installed: Boolean(installation),
    installUrlPath: `/v1/${provider}/app/install-url`,
    metadata: installation
      ? {
          installationId: installation.installationId,
          tokenExpiresAt: installation.tokenExpiresAt,
          connectedAt: installation.createdAt
        }
      : {}
  };
}

async function loadIntegrationStatus(deps: AdminApiDeps, orgId: string, provider: IntegrationProvider) {
  const connection = deps.integrationStore
    ? await deps.integrationStore.get(orgId, provider)
    : undefined;
  return {
    provider,
    installed: Boolean(connection),
    installUrlPath: `/v1/${provider}/app/install-url`,
    metadata: connection
      ? {
          ...connection.metadata,
          tokenExpiresAt: connection.tokenExpiresAt,
          updatedAt: connection.updatedAt
        }
      : {}
  };
}
