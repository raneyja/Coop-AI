import type { ServerResponse } from "node:http";
import { auditActor } from "./audit/auditLogger";
import type { AuthContext } from "./orgStore";
import type { IntegrationProvider } from "./integrationConnectionStore";
import { assessGithubConnection } from "./codeHostCredentialResolver";
import { writeJson, type AdminApiDeps } from "./adminApiShared";
import { resolveScopeStatusForIntegration } from "./adminIntegrationScopeApi";
import { testAdminIntegration } from "./adminIntegrationTest";

type ParsedRequest = {
  method: string;
  pathname: string;
  query?: URLSearchParams;
};

export type IntegrationHealthValue =
  | "not_connected"
  | "not_configured"
  | "scope_required"
  | "degraded"
  | "healthy";

export type IntegrationHealthEntry = {
  provider: AnyProvider;
  installed: boolean;
  health: IntegrationHealthValue;
  message?: string;
  scopeStatus?: string;
  configured: boolean;
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
      await deps.scopePolicyStore?.delete(auth.orgId, provider as IntegrationProvider);
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

  if (parsed.method === "GET" && parsed.pathname === "/v1/admin/integrations/health") {
    const refresh = parsed.query?.get("refresh") === "true";
    const orgPlan = await loadOrgPlan(deps, auth.orgId);
    const statuses = [
      ...(await Promise.all(
        CODE_HOST_PROVIDERS.map((provider) => loadCodeHostStatus(deps, auth.orgId, provider))
      )),
      ...(await Promise.all(
        INTEGRATION_PROVIDERS.map((provider) =>
          loadIntegrationStatus(deps, auth.orgId, provider, orgPlan)
        )
      ))
    ];

    const integrations: IntegrationHealthEntry[] = [];
    for (const status of statuses) {
      integrations.push(await buildHealthEntry(deps, auth.orgId, orgPlan, status, refresh));
    }

    const githubOrToolConnected =
      statuses.some((entry) => entry.provider === "github" && entry.installed) ||
      statuses.some(
        (entry) =>
          INTEGRATION_PROVIDERS.includes(entry.provider as IntegrationProvider) && entry.installed
      );

    const slack = statuses.find((entry) => entry.provider === "slack");
    const slackScopeStatus =
      slack && "scopeStatus" in slack ? slack.scopeStatus : undefined;
    const slackScopeActive =
      orgPlan !== "enterprise" ||
      !slack?.installed ||
      slackScopeStatus === "active" ||
      slackScopeStatus === "none";

    const canCompleteOnboarding =
      githubOrToolConnected &&
      slackScopeActive &&
      !integrations.some(
        (entry) =>
          entry.installed &&
          (entry.health === "not_configured" || entry.health === "scope_required")
      );

    writeJson(response, 200, {
      orgPlan,
      onboardingGates: {
        githubOrToolConnected,
        slackScopeActive,
        canCompleteOnboarding
      },
      integrations
    });
    return true;
  }

  if (parsed.method !== "GET" || parsed.pathname !== "/v1/admin/integrations") {
    return false;
  }

  const orgPlan = await loadOrgPlan(deps, auth.orgId);

  const integrations = [
    ...(await Promise.all(CODE_HOST_PROVIDERS.map((provider) => loadCodeHostStatus(deps, auth.orgId, provider)))),
    ...(await Promise.all(
      INTEGRATION_PROVIDERS.map((provider) =>
        loadIntegrationStatus(deps, auth.orgId, provider, orgPlan)
      )
    ))
  ];

  writeJson(response, 200, { integrations });
  return true;
}

async function loadOrgPlan(deps: AdminApiDeps, orgId: string): Promise<string> {
  const org = deps.orgStore ? await deps.orgStore.getOrganization(orgId) : undefined;
  return org?.plan ?? "free";
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

async function loadIntegrationStatus(
  deps: AdminApiDeps,
  orgId: string,
  provider: IntegrationProvider,
  orgPlan: string
) {
  const connection = deps.integrationStore
    ? await deps.integrationStore.get(orgId, provider)
    : undefined;
  const installed = Boolean(connection);
  const scope = await resolveScopeStatusForIntegration(deps, orgId, orgPlan, provider, installed);
  const metadata = connection
    ? sanitizeIntegrationMetadata({
        ...connection.metadata,
        tokenExpiresAt: connection.tokenExpiresAt,
        updatedAt: connection.updatedAt
      })
    : {};
  const scopeNeedsReconnect =
    provider === "slack" &&
    installed &&
    orgPlan === "enterprise" &&
    !connection?.metadata.encryptedBotToken;
  return {
    provider,
    installed,
    installUrlPath: `/v1/${provider}/app/install-url`,
    scopeStatus: scope.scopeStatus,
    scopeSummary: scope.scopeSummary,
    scopeNeedsReconnect,
    metadata
  };
}

function sanitizeIntegrationMetadata(
  metadata: Record<string, unknown>
): Record<string, unknown> {
  const { encryptedBotToken: _bot, ...rest } = metadata;
  return rest;
}

async function buildHealthEntry(
  deps: AdminApiDeps,
  orgId: string,
  orgPlan: string,
  status: {
    provider: AnyProvider;
    installed: boolean;
    needsReconnect?: boolean;
    scopeStatus?: string;
    scopeNeedsReconnect?: boolean;
  },
  refresh: boolean
): Promise<IntegrationHealthEntry> {
  const scopeStatus = status.scopeStatus ?? "none";
  if (!status.installed) {
    return {
      provider: status.provider,
      installed: false,
      health: "not_connected",
      scopeStatus,
      configured: true
    };
  }

  if (status.needsReconnect || status.scopeNeedsReconnect) {
    return {
      provider: status.provider,
      installed: true,
      health: "degraded",
      message: status.scopeNeedsReconnect
        ? "Reconnect to refresh channel access."
        : "Reconnect required.",
      scopeStatus,
      configured: true
    };
  }

  if (
    orgPlan === "enterprise" &&
    scopeStatus === "required" &&
    ["slack", "atlassian", "notion", "google-docs"].includes(status.provider)
  ) {
    return {
      provider: status.provider,
      installed: true,
      health: "scope_required",
      message: "Configure access scope before chat uses this integration.",
      scopeStatus,
      configured: true
    };
  }

  if (refresh) {
    const test = await testAdminIntegration(orgId, status.provider, deps);
    if (/not configured/i.test(test.message)) {
      return {
        provider: status.provider,
        installed: true,
        health: "not_configured",
        message: test.message,
        scopeStatus,
        configured: false
      };
    }
    return {
      provider: status.provider,
      installed: true,
      health: test.ok ? "healthy" : "degraded",
      message: test.message,
      scopeStatus,
      configured: true
    };
  }

  return {
    provider: status.provider,
    installed: true,
    health: "healthy",
    scopeStatus,
    configured: true
  };
}
