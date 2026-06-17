import type { JobQueue } from "../jobs/jobQueue";
import type { OrgStore } from "./orgStore";
import { queueOrgRepoIndex } from "./queueOrgRepoIndex";
import type { CodeHostProvider } from "../api/codeHosts/types";
import { repoIdFromCoordinates } from "../api/codeHosts/types";
import { GitHubClient } from "../api/codeHosts/githubClient";
import { GitLabClient } from "../api/codeHosts/gitlabClient";
import { BitbucketClient } from "../api/codeHosts/bitbucketClient";
import { gitlabApiBaseUrl, loadGitLabAppConfig } from "./gitlabAppConfig";
import { resolveCodeHostTokenForOrg } from "./codeHostCredentialResolver";
import { getConnector } from "./codeHostConnectors/registry";
import { githubOAuthSyntheticInstallationId } from "./codeHostConnectors/githubOAuthConnector";
import type { GitHubAppService } from "./githubAppService";
import { createEstateSyncService } from "./estateSyncService";

export type CatalogSyncResult = {
  discovered: number;
  queued: number;
  skipped: number;
};

export type CatalogSyncProviderResult = CatalogSyncResult & {
  provider: CodeHostProvider;
};

export function codeHostDisplayName(provider: CodeHostProvider): string {
  switch (provider) {
    case "gitlab":
      return "GitLab";
    case "bitbucket":
      return "Bitbucket";
    default:
      return "GitHub";
  }
}

/**
 * Queues Deep-Code Graph indexing for repos discovered on a code host.
 * Used after org admin connects GitHub, GitLab, or Bitbucket (Pro + Enterprise).
 */
export async function syncOrgCatalog(
  orgId: string,
  repoIds: string[],
  deps: { orgStore: OrgStore; jobQueue?: JobQueue; force?: boolean }
): Promise<CatalogSyncResult> {
  if (!deps.jobQueue || repoIds.length === 0) {
    return { discovered: repoIds.length, queued: 0, skipped: repoIds.length };
  }

  let queued = 0;
  let skipped = 0;

  for (const repoId of repoIds) {
    const existing = await deps.orgStore.getOrgRepo(orgId, repoId);
    if (
      !deps.force &&
      existing?.lightningEnabled &&
      (existing.indexStatus === "indexing" ||
        existing.indexStatus === "queued" ||
        existing.indexStatus === "ready")
    ) {
      skipped += 1;
      continue;
    }

    const queueResult = await queueOrgRepoIndex(orgId, repoId, {
      orgStore: deps.orgStore,
      jobQueue: deps.jobQueue,
      bypassRateLimit: true
    });
    if (queueResult.outcome === "skipped") {
      skipped += 1;
      continue;
    }
    if (queueResult.outcome === "failed") {
      console.error(`[catalog-sync] failed to queue ${repoId}: ${queueResult.message}`);
      skipped += 1;
      continue;
    }

    queued += 1;
  }

  console.log(
    `[catalog-sync] org=${orgId} discovered=${repoIds.length} queued=${queued} skipped=${skipped}`
  );

  return { discovered: repoIds.length, queued, skipped };
}

/** Lists accessible repositories on a code host and returns normalized repo ids. */
export async function discoverCatalogRepoIds(
  provider: CodeHostProvider,
  accessToken: string,
  options?: { gitlabApiBase?: string; limit?: number }
): Promise<string[]> {
  const limit = options?.limit ?? 500;
  switch (provider) {
    case "github": {
      const repos = await new GitHubClient({ token: accessToken }).listUserRepositories(limit);
      return repos.map((entry) =>
        repoIdFromCoordinates({
          provider: "github",
          owner: entry.owner,
          repo: entry.name,
          branch: entry.defaultBranch
        })
      );
    }
    case "gitlab": {
      const repos = await new GitLabClient({
        token: accessToken,
        baseUrl: options?.gitlabApiBase
      }).listUserRepositories(limit);
      return repos.map((entry) =>
        repoIdFromCoordinates({
          provider: "gitlab",
          owner: entry.owner,
          repo: entry.name,
          branch: entry.defaultBranch
        })
      );
    }
    case "bitbucket": {
      const repos = await new BitbucketClient({ token: accessToken }).listUserRepositories(limit);
      return repos.map((entry) =>
        repoIdFromCoordinates({
          provider: "bitbucket",
          owner: entry.owner,
          repo: entry.name,
          branch: entry.defaultBranch
        })
      );
    }
    default:
      return [];
  }
}

/**
 * After OAuth connect, queue indexing for all repos the org can access on this host.
 * Fire-and-forget — callers should void this from OAuth callbacks.
 */
export async function runCodeHostCatalogSyncAfterConnect(
  orgId: string,
  provider: CodeHostProvider,
  accessToken: string,
  deps: { orgStore: OrgStore; jobQueue?: JobQueue; gitlabHostRoot?: string }
): Promise<CatalogSyncResult> {
  const org = await deps.orgStore.getOrganization(orgId);
  if (!org || (org.plan !== "pro" && org.plan !== "enterprise")) {
    return { discovered: 0, queued: 0, skipped: 0 };
  }
  if ((provider === "gitlab" || provider === "bitbucket") && org.plan !== "enterprise") {
    return { discovered: 0, queued: 0, skipped: 0 };
  }

  try {
    const gitlabApiBase = deps.gitlabHostRoot ? gitlabApiBaseUrl(deps.gitlabHostRoot) : undefined;
    const repoIds = await discoverCatalogRepoIds(provider, accessToken, { gitlabApiBase });
    const result = await syncOrgCatalog(orgId, repoIds, deps);
    console.log(
      `[catalog-sync] provider=${provider} org=${orgId} discovered=${result.discovered} queued=${result.queued} skipped=${result.skipped}`
    );
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[catalog-sync] provider=${provider} org=${orgId} failed: ${message}`);
    return { discovered: 0, queued: 0, skipped: 0 };
  }
}

export class CatalogSyncError extends Error {
  public constructor(
    message: string,
    public readonly code:
      | "code_host_not_connected"
      | "code_host_token_unavailable"
      | "plan_required"
      | "indexing_unavailable"
  ) {
    super(message);
    this.name = "CatalogSyncError";
  }
}

/**
 * Discover repos on a connected code host and queue Deep-Code Graph indexing.
 * Uses GitHub App installation API when available; otherwise OAuth/token discovery.
 */
export async function runCatalogSyncForProvider(
  orgId: string,
  provider: CodeHostProvider,
  deps: {
    orgStore: OrgStore;
    jobQueue?: JobQueue;
    githubApp?: GitHubAppService;
    allowPatFallback?: boolean;
    force?: boolean;
  }
): Promise<CatalogSyncProviderResult> {
  const org = await deps.orgStore.getOrganization(orgId);
  if (!org || (org.plan !== "pro" && org.plan !== "enterprise")) {
    return { provider, discovered: 0, queued: 0, skipped: 0 };
  }

  if ((provider === "gitlab" || provider === "bitbucket") && org.plan !== "enterprise") {
    throw new CatalogSyncError(
      `${codeHostDisplayName(provider)} catalog sync requires an Enterprise plan.`,
      "plan_required"
    );
  }

  if (!deps.jobQueue) {
    throw new CatalogSyncError("Indexing queue is not configured on this server.", "indexing_unavailable");
  }

  const installation = await deps.orgStore.getCodeHostInstallation(orgId, provider);
  if (!installation) {
    throw new CatalogSyncError(
      `Connect ${codeHostDisplayName(provider)} in Integrations before syncing.`,
      "code_host_not_connected"
    );
  }

  if (
    provider === "github" &&
    deps.githubApp &&
    installation.installationId !== githubOAuthSyntheticInstallationId(orgId)
  ) {
    const estateSync = createEstateSyncService({
      orgStore: deps.orgStore,
      githubApp: deps.githubApp,
      jobQueue: deps.jobQueue
    });
    if (estateSync) {
      const result = await estateSync.syncInstallation(orgId, installation.installationId, {
        force: deps.force
      });
      return { provider, ...result };
    }
  }

  const token = await resolveCodeHostTokenForOrg(orgId, provider, {
    orgStore: deps.orgStore,
    connector: getConnector(provider),
    allowPatFallback: deps.allowPatFallback ?? false
  });
  if (!token) {
    throw new CatalogSyncError(
      `Reconnect ${codeHostDisplayName(provider)} in Integrations — access token is missing or expired.`,
      "code_host_token_unavailable"
    );
  }

  const gitlabConfig = loadGitLabAppConfig();
  const gitlabApiBase = gitlabConfig ? gitlabApiBaseUrl(gitlabConfig.gitlabBaseUrl) : undefined;
  const repoIds = await discoverCatalogRepoIds(provider, token, { gitlabApiBase });
  const result = await syncOrgCatalog(orgId, repoIds, {
    orgStore: deps.orgStore,
    jobQueue: deps.jobQueue,
    force: deps.force
  });
  console.log(
    `[catalog-sync] provider=${provider} org=${orgId} discovered=${result.discovered} queued=${result.queued} skipped=${result.skipped}`
  );
  return { provider, ...result };
}
