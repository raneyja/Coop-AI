import type { ServerResponse } from "node:http";
import type { JobQueue } from "../jobs/jobQueue";
import { GitHubClient } from "../api/codeHosts/githubClient";
import { GitLabClient } from "../api/codeHosts/gitlabClient";
import { BitbucketClient } from "../api/codeHosts/bitbucketClient";
import { buildExplorerFileSearchQuery } from "../api/codeHosts/explorerSearch";
import { codeHostRequestJson } from "../api/codeHosts/codeHostHttp";
import { CodeHostError, type RepoCoordinates } from "../api/codeHosts/types";
import { parseRepoId } from "../jobs/buildStructureManifest";
import { RepoManifestStore } from "../manifest/repoManifestStore";
import { requireDbPool, getDbPool } from "./db";
import { JobType } from "../jobs/types";
import {
  authUserId,
  canInstallIntegrations,
  canOrgAdmin,
  extractBearerToken,
  requireAuth,
  requireOrgAdmin,
  requireOrgPlan,
  resolveAuthContext,
  resolveOrgPlanFromDb
} from "./authMiddleware";
import { requireCodeHostPlan, requireRemoteCodePlan } from "./planGates";
import { AuditLogger, auditActor } from "./audit/auditLogger";
import { resolveCodeHostTokenForOrg, assessGithubConnection } from "./codeHostCredentialResolver";
import { getConnector } from "./codeHostConnectors/registry";
import { CollectionStore } from "./collectionStore";
import { normalizeIdentityDirectory } from "../identity/identityDirectory";
import { mergeSelfIdentityHints } from "../identity/identityAutoSeed";
import { canUseLightningPlan, type AuthContext, type OrgRepoRecord, type OrgStore } from "./orgStore";
import { OrgIdentityDirectoryStore } from "./orgIdentityDirectoryStore";
import { buildIdentityConnectionHints } from "./identityHintsService";
import type { IntegrationConnectionStore } from "./integrationConnectionStore";
import type { ServerConfig } from "./serverConfig";
import { createPlanQuotaService } from "./planQuota";
import type { EstateSyncService } from "./estateSyncService";
import { getIndexedRepoQuota } from "./indexedRepoQuota";
import { UserWorkspaceStore, workspaceRepoLimitForPlan } from "./userWorkspaceStore";
import type { GitHubAppService } from "./githubAppService";
import { githubOAuthSyntheticInstallationId } from "./codeHostConnectors/githubOAuthConnector";
import { repoIdFromCoordinates, coordinatesFromRepoId, type CodeHostProvider } from "../api/codeHosts/types";
import { loadGitLabAppConfig, gitlabApiBaseUrl } from "./gitlabAppConfig";
import { syncOrgCatalog, runCatalogSyncForProvider, CatalogSyncError } from "./catalogSyncService";
import { queueOrgRepoIndex, reindexEmbeddingFailures } from "./queueOrgRepoIndex";
import type { UsageTracker } from "./usageTracker";
import type { UserStore } from "./users/userStore";

export type OrgApiDeps = {
  orgStore?: OrgStore;
  jobQueue?: JobQueue;
  githubApp?: GitHubAppService;
  estateSync?: EstateSyncService;
  serverConfig: ServerConfig;
  auditLogger?: AuditLogger;
  userStore?: UserStore;
  usageTracker?: UsageTracker;
  integrationStore?: IntegrationConnectionStore;
};

/** Apply index_repository rate limits only when re-queuing a repo that already reached ready. */
export function shouldRateLimitIndexRepository(
  existing?: Pick<OrgRepoRecord, "indexStatus">
): boolean {
  return existing?.indexStatus === "ready";
}

/** Org admin operations and embedding retries bypass per-user index rate limits. */
export function shouldBypassIndexRateLimit(
  existing?: Pick<OrgRepoRecord, "indexStatus" | "embeddingStatus">,
  options?: { orgAdmin?: boolean }
): boolean {
  if (options?.orgAdmin) {
    return true;
  }
  if (existing?.embeddingStatus === "failed") {
    return true;
  }
  return !shouldRateLimitIndexRepository(existing);
}

export type OrgRepoApiRecord = OrgRepoRecord & { indexProgress?: number };

export async function enrichReposWithIndexProgress(
  repos: OrgRepoRecord[]
): Promise<OrgRepoApiRecord[]> {
  const pool = await getDbPool();
  if (!pool) {
    return repos;
  }

  const jobIds: string[] = [];
  for (const repo of repos) {
    if (
      repo.lastJobId &&
      (repo.indexStatus === "queued" || repo.indexStatus === "indexing" || repo.indexStatus === "cloning")
    ) {
      jobIds.push(repo.lastJobId);
    }
  }
  if (jobIds.length === 0) {
    return repos;
  }

  const result = await pool.query(`SELECT id, progress FROM jobs WHERE id = ANY($1::uuid[])`, [jobIds]);
  const progressByJobId = new Map(
    result.rows.map((row) => [String(row.id), Number(row.progress ?? 0)])
  );

  return repos.map((repo) => {
    if (!repo.lastJobId) {
      return repo;
    }
    const progress = progressByJobId.get(repo.lastJobId);
    if (progress === undefined) {
      return repo;
    }
    if (repo.indexStatus !== "queued" && repo.indexStatus !== "indexing" && repo.indexStatus !== "cloning") {
      return repo;
    }
    return { ...repo, indexProgress: progress };
  });
}

type ParsedRequest = {
  method: string;
  pathname: string;
  query?: URLSearchParams;
  headers: Record<string, string | undefined>;
  body: unknown;
};

export async function handleOrgApiRequest(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: OrgApiDeps
): Promise<boolean> {
  if (!parsed.pathname.startsWith("/v1/")) {
    return false;
  }

  const auth = await resolveAuthContext(
    parsed.headers,
    deps.orgStore,
    deps.serverConfig.legacyApiToken,
    deps.serverConfig.requireApiAuth,
    deps.userStore
  );
  if (!requireAuth(auth, deps.serverConfig.requireApiAuth)) {
    writeJson(response, 401, { error: "unauthorized" });
    return true;
  }

  if (!auth) {
    writeJson(response, 401, { error: "unauthorized" });
    return true;
  }

  if (parsed.method === "GET" && parsed.pathname === "/v1/me") {
    const plan = (await resolveOrgPlanFromDb(deps.orgStore, auth!)) ?? auth!.plan;
    const planQuota = createPlanQuotaService(deps.usageTracker);
    const quota = await planQuota.getSnapshot(auth.orgId, plan);
    const indexedRepoQuota =
      deps.orgStore && auth.orgId !== "legacy"
        ? await getIndexedRepoQuota(deps.orgStore, auth.orgId, plan)
        : undefined;
    let workspaceRepoQuota:
      | { selectedCount: number; limit: number | null; canAddMore: boolean; primaryRepoId?: string }
      | undefined;
    if (deps.orgStore && auth.orgId !== "legacy") {
      try {
        const pool = await getDbPool();
        if (pool) {
          const workspaceStore = new UserWorkspaceStore(pool);
          workspaceRepoQuota = await workspaceStore.getUserWorkspaceQuota(
            auth.orgId,
            authUserId(auth),
            plan
          );
        }
      } catch {
        // Non-fatal when workspace table is unavailable (pre-migration environments).
      }
    }
    writeJson(response, 200, {
      orgId: auth.orgId,
      orgName: auth.orgName,
      plan,
      canUseLightning: canUseLightningPlan(plan),
      lightningBackend: "cloud",
      userId: auth.userId,
      role: auth.role,
      authMethod: auth.userId ? "sso_session" : "api_key",
      canInstallIntegrations: canInstallIntegrations(auth),
      indexedRepoCount: indexedRepoQuota?.indexedRepoCount,
      indexedRepoLimit: indexedRepoQuota?.indexedRepoLimit,
      canEnableMoreRepos: indexedRepoQuota?.canEnableMoreRepos,
      workspaceRepoCount: workspaceRepoQuota?.selectedCount,
      workspaceRepoLimit: workspaceRepoQuota?.limit,
      canAddMoreWorkspaceRepos: workspaceRepoQuota?.canAddMore,
      primaryWorkspaceRepoId: workspaceRepoQuota?.primaryRepoId,
      quota
    });
    return true;
  }

  if (parsed.pathname === "/v1/me/workspace-repos") {
    if (!deps.orgStore || auth.orgId === "legacy") {
      writeJson(response, 503, { error: "organization database not configured" });
      return true;
    }
    const pool = requireDbPool(await getDbPool());
    const workspaceStore = new UserWorkspaceStore(pool);
    const plan = (await resolveOrgPlanFromDb(deps.orgStore, auth)) ?? auth.plan;
    const userId = authUserId(auth);

    if (parsed.method === "GET") {
      await handleGetWorkspaceRepos(response, deps, workspaceStore, auth.orgId, userId, plan);
      return true;
    }
    if (parsed.method === "PUT") {
      await handlePutWorkspaceRepos(parsed, response, deps, workspaceStore, auth, userId, plan);
      return true;
    }
    writeJson(response, 405, { error: "method_not_allowed" });
    return true;
  }

  if (!deps.orgStore || auth.orgId === "legacy") {
    writeJson(response, 503, { error: "organization database not configured" });
    return true;
  }

  if (parsed.pathname === "/v1/identity-directory") {
    const store = new OrgIdentityDirectoryStore(requireDbPool(await getDbPool()));
    if (parsed.method === "GET") {
      const stored = await store.get(auth!.orgId);
      const hints = await buildIdentityConnectionHints(auth!, {
        orgStore: deps.orgStore,
        integrationStore: deps.integrationStore,
        userStore: deps.userStore,
        allowPatFallback: deps.serverConfig.devMode
      });
      const directory = mergeSelfIdentityHints(stored, hints);
      writeJson(response, 200, { directory });
      return true;
    }
    if (parsed.method === "PUT") {
      if (!requireOrgAdmin(auth, response)) {
        return true;
      }
      const body = parsed.body as { directory?: unknown };
      const directory = await store.save(auth!.orgId, normalizeIdentityDirectory(body?.directory));
      await audit(deps, auth!, "identity.directory.save", { people: directory.people.length });
      writeJson(response, 200, { directory });
      return true;
    }
  }

  if (parsed.method === "POST" && parsed.pathname === "/v1/orgs/credentials/github") {
    if (!(await requireCodeHostPlan(deps.orgStore, auth!, response, "github"))) {
      return true;
    }
    await handleStoreGithubCredential(parsed, response, deps, auth!);
    await audit(deps, auth!, "org.credential.store", { provider: "github" });
    return true;
  }

  if (parsed.method === "GET" && parsed.pathname === "/v1/orgs/repos") {
    if (!(await requireRemoteCodePlan(deps.orgStore, auth!, response))) {
      return true;
    }
    const repos = await enrichReposWithIndexProgress(await deps.orgStore.listOrgRepos(auth!.orgId));
    writeJson(response, 200, { repos });
    return true;
  }

  if (parsed.method === "GET" && parsed.pathname === "/v1/orgs/catalog/repos") {
    if (!(await requireRemoteCodePlan(deps.orgStore, auth!, response))) {
      return true;
    }
    await handleListCatalogRepos(parsed, response, deps, auth!);
    return true;
  }

  if (parsed.method === "GET" && parsed.pathname === "/v1/orgs/github/repos") {
    if (!(await requireRemoteCodePlan(deps.orgStore, auth!, response))) {
      return true;
    }
    await handleListGithubRepos(parsed, response, deps, auth!);
    return true;
  }

  if (parsed.method === "POST" && parsed.pathname === "/v1/orgs/estate/sync") {
    if (!requireOrgAdmin(auth!, response)) {
      return true;
    }
    if (!(await requireOrgPlan(deps.orgStore, auth!, response, "pro", "enterprise"))) {
      return true;
    }
    await handleEstateSync(parsed, response, deps, auth!);
    return true;
  }

  const enableMatch = parsed.pathname.match(/^\/v1\/orgs\/repos\/([^/]+)\/lightning\/enable$/);
  if (parsed.method === "POST" && enableMatch) {
    if (!(await requireOrgPlan(deps.orgStore, auth!, response, "pro", "enterprise"))) {
      return true;
    }
    const repoId = decodeURIComponent(enableMatch[1]);
    await handleEnableLightning(repoId, parsed, response, deps, auth!);
    await audit(deps, auth!, "repo.lightning.enable", { repoId });
    return true;
  }

  if (parsed.method === "POST" && parsed.pathname === "/v1/orgs/repos/reindex-embedding-failures") {
    if (!requireOrgAdmin(auth!, response)) {
      return true;
    }
    if (!(await requireOrgPlan(deps.orgStore, auth!, response, "pro", "enterprise"))) {
      return true;
    }
    await handleReindexEmbeddingFailures(response, deps, auth!);
    return true;
  }

  const disableMatch = parsed.pathname.match(/^\/v1\/orgs\/repos\/([^/]+)\/lightning\/disable$/);
  if (parsed.method === "POST" && disableMatch) {
    if (!(await requireOrgPlan(deps.orgStore, auth!, response, "pro", "enterprise"))) {
      return true;
    }
    const repoId = decodeURIComponent(disableMatch[1]);
    const record = await deps.orgStore.upsertOrgRepo(auth!.orgId, repoId, {
      lightningEnabled: false,
      indexStatus: "disabled"
    });
    await audit(deps, auth!, "repo.lightning.disable", { repoId });
    writeJson(response, 200, { repo: record });
    return true;
  }

  const statusMatch = parsed.pathname.match(/^\/v1\/orgs\/repos\/([^/]+)\/lightning\/status$/);
  if (parsed.method === "GET" && statusMatch) {
    if (!(await requireOrgPlan(deps.orgStore, auth!, response, "pro", "enterprise"))) {
      return true;
    }
    const repoId = decodeURIComponent(statusMatch[1]);
    const record = await deps.orgStore.getOrgRepo(auth!.orgId, repoId);
    writeJson(response, 200, {
      repo: record ?? {
        orgId: auth!.orgId,
        repoId,
        lightningEnabled: false,
        indexStatus: "idle"
      }
    });
    return true;
  }

  if (parsed.method === "POST" && parsed.pathname === "/v1/collections") {
    if (!(await requireRemoteCodePlan(deps.orgStore, auth!, response))) {
      return true;
    }
    await handleCreateCollection(parsed, response, auth!.orgId);
    await audit(deps, auth!, "collection.create");
    return true;
  }

  if (parsed.method === "GET" && parsed.pathname === "/v1/collections") {
    if (!(await requireRemoteCodePlan(deps.orgStore, auth!, response))) {
      return true;
    }
    await handleListCollections(response, auth!.orgId);
    return true;
  }

  const addRepoMatch = parsed.pathname.match(/^\/v1\/collections\/([^/]+)\/repos$/);
  if (parsed.method === "POST" && addRepoMatch) {
    if (!(await requireRemoteCodePlan(deps.orgStore, auth!, response))) {
      return true;
    }
    const collectionId = decodeURIComponent(addRepoMatch[1]);
    await handleAddCollectionRepo(collectionId, parsed, response, auth!.orgId);
    await audit(deps, auth!, "collection.repo.add", { collectionId });
    return true;
  }

  const removeRepoMatch = parsed.pathname.match(/^\/v1\/collections\/([^/]+)\/repos\/([^/]+)$/);
  if (parsed.method === "DELETE" && removeRepoMatch) {
    if (!(await requireRemoteCodePlan(deps.orgStore, auth!, response))) {
      return true;
    }
    const collectionId = decodeURIComponent(removeRepoMatch[1]);
    const repoId = decodeURIComponent(removeRepoMatch[2]);
    await handleRemoveCollectionRepo(collectionId, repoId, response, auth!.orgId);
    await audit(deps, auth!, "collection.repo.remove", { collectionId, repoId });
    return true;
  }

  const remoteRepoApiMatch =
    parsed.method === "GET" &&
    /^\/v1\/orgs\/repos\/[^/]+\/(manifest|metadata|files|tree|search|blame|history|commits|pulls|issues)/.test(
      parsed.pathname
    );
  if (remoteRepoApiMatch) {
    if (!(await requireRemoteCodePlan(deps.orgStore, auth!, response))) {
      return true;
    }
  }

  const manifestMatch = parsed.pathname.match(/^\/v1\/orgs\/repos\/([^/]+)\/manifest$/);
  if (parsed.method === "GET" && manifestMatch) {
    const repoId = decodeURIComponent(manifestMatch[1]);
    await handleGetRepoManifest(repoId, response, auth!.orgId);
    return true;
  }

  const fileMatch = parsed.pathname.match(/^\/v1\/orgs\/repos\/([^/]+)\/files$/);
  if (parsed.method === "GET" && fileMatch) {
    const repoId = decodeURIComponent(fileMatch[1]);
    await handleGetRepoFile(repoId, parsed, response, deps, auth!);
    await audit(deps, auth!, "repo.file.fetch", { repoId, path: parsed.query?.get("path") ?? undefined });
    return true;
  }

  const treeMatch = parsed.pathname.match(/^\/v1\/orgs\/repos\/([^/]+)\/tree$/);
  if (parsed.method === "GET" && treeMatch) {
    const repoId = decodeURIComponent(treeMatch[1]);
    await handleGetRepoTree(repoId, parsed, response, deps, auth!);
    await audit(deps, auth!, "repo.tree.fetch", { repoId, path: parsed.query?.get("path") ?? undefined });
    return true;
  }

  const searchMatch = parsed.pathname.match(/^\/v1\/orgs\/repos\/([^/]+)\/search$/);
  if (parsed.method === "GET" && searchMatch) {
    const repoId = decodeURIComponent(searchMatch[1]);
    await handleGetRepoSearch(repoId, parsed, response, deps, auth!);
    await audit(deps, auth!, "repo.search", { repoId, query: parsed.query?.get("q") ?? undefined });
    return true;
  }

  const blameMatch = parsed.pathname.match(/^\/v1\/orgs\/repos\/([^/]+)\/blame$/);
  if (parsed.method === "GET" && blameMatch) {
    const repoId = decodeURIComponent(blameMatch[1]);
    await handleGetRepoBlame(repoId, parsed, response, deps, auth!);
    await audit(deps, auth!, "repo.blame.fetch", { repoId, path: parsed.query?.get("path") ?? undefined });
    return true;
  }

  const historyMatch = parsed.pathname.match(/^\/v1\/orgs\/repos\/([^/]+)\/history$/);
  if (parsed.method === "GET" && historyMatch) {
    const repoId = decodeURIComponent(historyMatch[1]);
    await handleGetRepoHistory(repoId, parsed, response, deps, auth!);
    await audit(deps, auth!, "repo.history.fetch", { repoId, path: parsed.query?.get("path") ?? undefined });
    return true;
  }

  const commitMatch = parsed.pathname.match(/^\/v1\/orgs\/repos\/([^/]+)\/commits\/([^/]+)$/);
  if (parsed.method === "GET" && commitMatch) {
    const repoId = decodeURIComponent(commitMatch[1]);
    const sha = decodeURIComponent(commitMatch[2]);
    await handleGetRepoCommit(repoId, sha, parsed, response, deps, auth!);
    await audit(deps, auth!, "repo.commit.fetch", { repoId, sha });
    return true;
  }

  const pullsForFileMatch = parsed.pathname.match(/^\/v1\/orgs\/repos\/([^/]+)\/pulls-for-file$/);
  if (parsed.method === "GET" && pullsForFileMatch) {
    const repoId = decodeURIComponent(pullsForFileMatch[1]);
    await handleGetRepoPullsForFile(repoId, parsed, response, deps, auth!);
    await audit(deps, auth!, "repo.pulls.fetch", { repoId, path: parsed.query?.get("path") ?? undefined });
    return true;
  }

  const metadataMatch = parsed.pathname.match(/^\/v1\/orgs\/repos\/([^/]+)\/metadata$/);
  if (parsed.method === "GET" && metadataMatch) {
    const repoId = decodeURIComponent(metadataMatch[1]);
    await handleGetRepoMetadata(repoId, parsed, response, deps, auth!);
    await audit(deps, auth!, "repo.metadata.fetch", { repoId });
    return true;
  }

  const repoIssuesMatch = parsed.pathname.match(/^\/v1\/orgs\/repos\/([^/]+)\/issues$/);
  if (parsed.method === "GET" && repoIssuesMatch) {
    const repoId = decodeURIComponent(repoIssuesMatch[1]);
    await handleGetRepoIssues(repoId, parsed, response, deps, auth!);
    await audit(deps, auth!, "repo.issues.fetch", { repoId, state: parsed.query?.get("state") ?? undefined });
    return true;
  }

  const repoPullsMatch = parsed.pathname.match(/^\/v1\/orgs\/repos\/([^/]+)\/pulls$/);
  if (parsed.method === "GET" && repoPullsMatch) {
    const repoId = decodeURIComponent(repoPullsMatch[1]);
    await handleGetRepoPulls(repoId, parsed, response, deps, auth!);
    await audit(deps, auth!, "repo.pulls.list", { repoId, state: parsed.query?.get("state") ?? undefined });
    return true;
  }

  const pullCommentsMatch = parsed.pathname.match(/^\/v1\/orgs\/repos\/([^/]+)\/pulls\/(\d+)\/comments$/);
  if (parsed.method === "GET" && pullCommentsMatch) {
    const repoId = decodeURIComponent(pullCommentsMatch[1]);
    const prNumber = Number(pullCommentsMatch[2]);
    await handleGetRepoPullComments(repoId, prNumber, parsed, response, deps, auth!);
    await audit(deps, auth!, "repo.pull.comments.fetch", { repoId, prNumber });
    return true;
  }

  const pullReviewsMatch = parsed.pathname.match(/^\/v1\/orgs\/repos\/([^/]+)\/pulls\/(\d+)\/reviews$/);
  if (parsed.method === "GET" && pullReviewsMatch) {
    const repoId = decodeURIComponent(pullReviewsMatch[1]);
    const prNumber = Number(pullReviewsMatch[2]);
    await handleGetRepoPullReviews(repoId, prNumber, parsed, response, deps, auth!);
    await audit(deps, auth!, "repo.pull.reviews.fetch", { repoId, prNumber });
    return true;
  }

  const pullDetailMatch = parsed.pathname.match(/^\/v1\/orgs\/repos\/([^/]+)\/pulls\/(\d+)$/);
  if (parsed.method === "GET" && pullDetailMatch) {
    const repoId = decodeURIComponent(pullDetailMatch[1]);
    const prNumber = Number(pullDetailMatch[2]);
    await handleGetRepoPullDetail(repoId, prNumber, parsed, response, deps, auth!);
    await audit(deps, auth!, "repo.pull.fetch", { repoId, prNumber });
    return true;
  }

  const commitPullsMatch = parsed.pathname.match(/^\/v1\/orgs\/repos\/([^/]+)\/commits\/([^/]+)\/pulls$/);
  if (parsed.method === "GET" && commitPullsMatch) {
    const repoId = decodeURIComponent(commitPullsMatch[1]);
    const sha = decodeURIComponent(commitPullsMatch[2]);
    await handleGetRepoCommitPulls(repoId, sha, parsed, response, deps, auth!);
    await audit(deps, auth!, "repo.commit.pulls.fetch", { repoId, sha });
    return true;
  }

  writeJson(response, 404, { error: "not found" });
  return true;
}

type CatalogRepoEntry = {
  repoId: string;
  provider: string;
  owner: string;
  name: string;
  defaultBranch: string;
  lightningEnabled?: boolean;
  indexStatus?: string;
  workspaceSelected?: boolean;
};

/** Indexed org catalog across GitHub, GitLab, and Bitbucket (Layer 1 → workspace picker). */
async function handleListCatalogRepos(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: OrgApiDeps,
  auth: NonNullable<Awaited<ReturnType<typeof resolveAuthContext>>>
): Promise<void> {
  if (!deps.orgStore) {
    writeJson(response, 503, { error: "organization database not configured" });
    return;
  }

  const query = parsed.query?.get("q")?.trim().toLowerCase() ?? "";
  const pool = await getDbPool();
  const selectedIds = pool
    ? new Set(
        await new UserWorkspaceStore(pool).listUserWorkspaceRepoIds(auth.orgId, authUserId(auth))
      )
    : new Set<string>();

  const indexedById = new Map(
    (await deps.orgStore.listOrgRepos(auth.orgId)).map((record) => [record.repoId, record])
  );

  const discovered = await discoverOrgCatalogEntries(auth.orgId, deps);
  const byRepoId = new Map<string, CatalogRepoEntry>();

  for (const entry of discovered) {
    const indexed = indexedById.get(entry.repoId);
    byRepoId.set(entry.repoId, {
      ...entry,
      lightningEnabled: indexed?.lightningEnabled,
      indexStatus: indexed?.indexStatus,
      workspaceSelected: selectedIds.has(entry.repoId)
    });
  }

  // Include org_repos rows that may no longer appear in live discovery (still indexing).
  for (const record of indexedById.values()) {
    if (byRepoId.has(record.repoId)) {
      continue;
    }
    if (
      !record.lightningEnabled &&
      record.indexStatus !== "ready" &&
      record.indexStatus !== "indexing" &&
      record.indexStatus !== "queued"
    ) {
      continue;
    }
    const coords = coordinatesFromRepoId(record.repoId);
    if (!coords) {
      continue;
    }
    byRepoId.set(record.repoId, {
      repoId: record.repoId,
      provider: coords.provider,
      owner: coords.owner,
      name: coords.repo,
      defaultBranch: coords.branch || "main",
      lightningEnabled: record.lightningEnabled,
      indexStatus: record.indexStatus,
      workspaceSelected: selectedIds.has(record.repoId)
    });
  }

  let repos = [...byRepoId.values()];

  if (query) {
    repos = repos.filter((entry) => {
      const haystack = `${entry.provider}:${entry.owner}/${entry.name}`.toLowerCase();
      return haystack.includes(query);
    });
  }

  const org = await deps.orgStore.getOrganization(auth.orgId);
  if (org && canUseLightningPlan(org.plan) && deps.jobQueue && discovered.length > 0) {
    const needsQueue = discovered
      .map((entry) => entry.repoId)
      .filter((repoId) => {
        const indexed = indexedById.get(repoId);
        return (
          !indexed?.lightningEnabled ||
          indexed.indexStatus === "idle" ||
          indexed.indexStatus === "disabled" ||
          indexed.indexStatus === "error"
        );
      });
    if (needsQueue.length > 0) {
      await syncOrgCatalog(auth.orgId, needsQueue, {
        orgStore: deps.orgStore,
        jobQueue: deps.jobQueue
      });
      for (const entry of repos) {
        const updated = await deps.orgStore.getOrgRepo(auth.orgId, entry.repoId);
        if (updated) {
          entry.lightningEnabled = updated.lightningEnabled;
          entry.indexStatus = updated.indexStatus;
        }
      }
    }
  }

  writeJson(response, 200, { repos });
}

async function discoverOrgCatalogEntries(orgId: string, deps: OrgApiDeps): Promise<CatalogRepoEntry[]> {
  if (!deps.orgStore) {
    return [];
  }

  const entries: CatalogRepoEntry[] = [];
  const gitlabConfig = loadGitLabAppConfig();
  const gitlabApiBase = gitlabConfig ? gitlabApiBaseUrl(gitlabConfig.gitlabBaseUrl) : undefined;

  for (const provider of ["github", "gitlab", "bitbucket"] as CodeHostProvider[]) {
    const installation = await deps.orgStore.getCodeHostInstallation(orgId, provider);
    if (!installation) {
      continue;
    }

    try {
      if (provider === "github") {
        entries.push(...(await discoverGithubCatalogEntries(orgId, deps)));
      } else {
        const token = await resolveCodeHostTokenForOrg(orgId, provider, {
          orgStore: deps.orgStore,
          connector: getConnector(provider),
          allowPatFallback: deps.serverConfig.devMode
        });
        if (!token) {
          continue;
        }
        const remote =
          provider === "gitlab"
            ? await new GitLabClient({ token, baseUrl: gitlabApiBase }).listUserRepositories(300)
            : await new BitbucketClient({ token }).listUserRepositories(300);
        for (const entry of remote) {
          entries.push({
            repoId: repoIdFromCoordinates({
              provider,
              owner: entry.owner,
              repo: entry.name,
              branch: entry.defaultBranch
            }),
            provider,
            owner: entry.owner,
            name: entry.name,
            defaultBranch: entry.defaultBranch || "main"
          });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[catalog] discover provider=${provider} org=${orgId} failed: ${message}`);
    }
  }

  return entries;
}

async function discoverGithubCatalogEntries(orgId: string, deps: OrgApiDeps): Promise<CatalogRepoEntry[]> {
  if (!deps.orgStore) {
    return [];
  }

  let token: string | undefined;
  try {
    token = await resolveCodeHostTokenForOrg(orgId, "github", {
      orgStore: deps.orgStore,
      connector: getConnector("github"),
      allowPatFallback: deps.serverConfig.devMode
    });
  } catch {
    return [];
  }
  if (!token) {
    return [];
  }

  const installation = await deps.orgStore.getCodeHostInstallation(orgId, "github");
  const isOAuthInstall =
    installation != null && installation.installationId === githubOAuthSyntheticInstallationId(orgId);

  if (!isOAuthInstall && deps.githubApp && installation) {
    const catalog = await deps.githubApp.listInstallationRepositoryCatalog(installation.installationId);
    return catalog.map((entry) => ({
      repoId: entry.repoId,
      provider: "github",
      owner: entry.owner,
      name: entry.name,
      defaultBranch: entry.defaultBranch || "main"
    }));
  }

  const remote = await new GitHubClient({ token }).listUserRepositories(300);
  return remote.map((entry) => ({
    repoId: repoIdFromCoordinates({
      provider: "github",
      owner: entry.owner,
      repo: entry.name,
      branch: entry.defaultBranch
    }),
    provider: "github",
    owner: entry.owner,
    name: entry.name,
    defaultBranch: entry.defaultBranch || "main"
  }));
}

type GithubDiscoveredRepo = {
  repoId: string;
  owner: string;
  name: string;
  defaultBranch: string;
  isPrivate?: boolean;
  htmlUrl?: string;
  lightningEnabled?: boolean;
  indexStatus?: string;
};

async function handleListGithubRepos(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: OrgApiDeps,
  auth: NonNullable<Awaited<ReturnType<typeof resolveAuthContext>>>
): Promise<void> {
  if (!deps.orgStore) {
    writeJson(response, 503, { error: "organization database not configured" });
    return;
  }

  let token: string | undefined;
  try {
    token = await resolveCodeHostTokenForOrg(auth.orgId, "github", {
      orgStore: deps.orgStore,
      connector: getConnector("github"),
      allowPatFallback: deps.serverConfig.devMode
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "GitHub authorization failed.";
    writeJson(response, 401, { error: "github_auth_expired", message });
    return;
  }
  if (!token) {
    const githubStatus = await assessGithubConnection(deps.orgStore, auth.orgId);
    writeJson(response, 401, {
      error: githubStatus.installed ? "github_auth_expired" : "github_not_installed",
      message: githubStatus.installed
        ? "GitHub access expired. Ask your org admin to reconnect GitHub in the admin portal (Integrations → GitHub)."
        : "GitHub is not connected for your organization. Ask your org admin to connect GitHub in the admin portal."
    });
    return;
  }

  const query = parsed.query?.get("q")?.trim().toLowerCase() ?? "";
  const installation = await deps.orgStore.getCodeHostInstallation(auth.orgId, "github");
  const isOAuthInstall =
    installation != null && installation.installationId === githubOAuthSyntheticInstallationId(auth.orgId);

  let discovered: GithubDiscoveredRepo[] = [];
  try {
    if (!isOAuthInstall && deps.githubApp && installation) {
      const catalog = await deps.githubApp.listInstallationRepositoryCatalog(installation.installationId);
      discovered = catalog.map((entry) => ({
        repoId: entry.repoId,
        owner: entry.owner,
        name: entry.name,
        defaultBranch: entry.defaultBranch,
        isPrivate: entry.isPrivate,
        htmlUrl: entry.htmlUrl
      }));
    } else {
      const client = new GitHubClient({ token });
      const remote = await client.listUserRepositories(300);
      discovered = remote.map((entry) => ({
        repoId: repoIdFromCoordinates({
          provider: "github",
          owner: entry.owner,
          repo: entry.name,
          branch: entry.defaultBranch
        }),
        owner: entry.owner,
        name: entry.name,
        defaultBranch: entry.defaultBranch || "main",
        isPrivate: entry.isPrivate,
        htmlUrl: entry.htmlUrl
      }));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to list GitHub repositories.";
    writeJson(response, 502, { error: "github_list_failed", message });
    return;
  }

  if (query) {
    discovered = discovered.filter((entry) => {
      const haystack = `${entry.owner}/${entry.name}`.toLowerCase();
      return haystack.includes(query);
    });
  }

  const indexedById = new Map(
    (await deps.orgStore.listOrgRepos(auth.orgId)).map((record) => [record.repoId, record])
  );
  const pool = await getDbPool();
  const selectedIds = pool
    ? new Set(
        await new UserWorkspaceStore(pool).listUserWorkspaceRepoIds(auth.orgId, authUserId(auth))
      )
    : new Set<string>();
  const repos = discovered.map((entry) => {
    const indexed = indexedById.get(entry.repoId);
    return {
      ...entry,
      lightningEnabled: indexed?.lightningEnabled,
      indexStatus: indexed?.indexStatus,
      workspaceSelected: selectedIds.has(entry.repoId)
    };
  });

  writeJson(response, 200, { repos });
}

async function handleStoreGithubCredential(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: OrgApiDeps,
  auth: NonNullable<Awaited<ReturnType<typeof resolveAuthContext>>>
): Promise<void> {
  if (!deps.serverConfig.devMode) {
    writeJson(response, 403, {
      error: "PAT storage is disabled. Install the CoopAI GitHub App instead."
    });
    return;
  }
  const body = asRecord(parsed.body);
  const token = String(body.token ?? "").trim();
  if (!token) {
    writeJson(response, 400, { error: "token is required" });
    return;
  }
  try {
    await deps.orgStore!.storeCredential(auth.orgId, "github", token);
    writeJson(response, 200, { ok: true, provider: "github" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to store credential";
    writeJson(response, 500, { error: message });
  }
}

async function handleGetRepoFile(
  repoId: string,
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: OrgApiDeps,
  auth: NonNullable<Awaited<ReturnType<typeof resolveAuthContext>>>
): Promise<void> {
  const filePath = parsed.query?.get("path")?.trim();
  if (!filePath) {
    writeJson(response, 400, { error: "path query parameter is required" });
    return;
  }

  const target = parseRepoId(repoId);
  const token = await resolveCodeHostTokenForOrg(auth.orgId, target.provider, {
    orgStore: deps.orgStore!,
    connector: getConnector(target.provider),
    allowPatFallback: deps.serverConfig.devMode
  });
  if (!token) {
    writeJson(response, 401, {
      error: `${target.provider} App is not installed for this organization. Install it from CoopAI settings.`
    });
    return;
  }

  const branch = parsed.query?.get("branch")?.trim() || undefined;
  const coords = { provider: target.provider, owner: target.owner, repo: target.repo, branch };
  try {
    const file = await fetchRepoFile(coords, filePath, token);
    writeJson(response, 200, {
      repoId,
      path: file.path,
      content: file.content,
      encoding: file.encoding,
      branch: file.branch,
      truncated: file.truncated ?? false
    });
  } catch (error) {
    if (error instanceof CodeHostError) {
      writeJson(response, error.status ?? 502, { error: error.message, code: error.code });
      return;
    }
    const message = error instanceof Error ? error.message : "failed to fetch file";
    writeJson(response, 502, { error: message });
  }
}

async function handleReindexEmbeddingFailures(
  response: ServerResponse,
  deps: OrgApiDeps,
  auth: NonNullable<Awaited<ReturnType<typeof resolveAuthContext>>>
): Promise<void> {
  if (!deps.jobQueue || !deps.orgStore) {
    writeJson(response, 503, { error: "job queue not available" });
    return;
  }

  const result = await reindexEmbeddingFailures(auth.orgId, {
    orgStore: deps.orgStore,
    jobQueue: deps.jobQueue
  });
  writeJson(response, 202, result);
}

async function handleEnableLightning(
  repoId: string,
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: OrgApiDeps,
  auth: NonNullable<Awaited<ReturnType<typeof resolveAuthContext>>>
): Promise<void> {
  if (!deps.jobQueue) {
    writeJson(response, 503, { error: "job queue not available" });
    return;
  }

  const existing = await deps.orgStore!.getOrgRepo(auth.orgId, repoId);

  const queueResult = await queueOrgRepoIndex(auth.orgId, repoId, {
    orgStore: deps.orgStore!,
    jobQueue: deps.jobQueue,
    userId: `org:${auth.orgId}`,
    bypassRateLimit: shouldBypassIndexRateLimit(existing, { orgAdmin: canOrgAdmin(auth) })
  });

  if (queueResult.outcome === "skipped" && queueResult.reason === "already_active") {
    const activeJob = queueResult.jobId ? await deps.jobQueue.getJob(queueResult.jobId) : undefined;
    writeJson(response, 200, {
      repoId,
      jobId: queueResult.jobId,
      status: activeJob?.status ?? "queued",
      alreadyQueued: true
    });
    return;
  }

  if (queueResult.outcome === "failed") {
    const status = queueResult.message.toLowerCase().includes("limit") ? 429 : 503;
    writeJson(response, status, { error: "index_queue_failed", message: queueResult.message });
    return;
  }

  writeJson(response, 202, {
    repoId,
    jobId: queueResult.jobId,
    status: "queued"
  });
}

async function ensureWorkspaceReposInOrgCatalog(
  orgId: string,
  repoIds: string[],
  deps: OrgApiDeps
): Promise<void> {
  if (!deps.orgStore) {
    return;
  }
  for (const repoId of repoIds) {
    try {
      parseRepoId(repoId);
    } catch {
      throw new Error(`Invalid repository id: ${repoId}`);
    }
    const existing = await deps.orgStore.getOrgRepo(orgId, repoId);
    if (existing) {
      continue;
    }
    let lastJobId: string | undefined;
    if (deps.jobQueue) {
      try {
        const submit = await deps.jobQueue.createJob({
          type: JobType.INDEX_REPOSITORY,
          priority: "high",
          params: { repoId, orgId }
        });
        lastJobId = submit.jobId;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[workspace-repos] failed to queue ${repoId}: ${message}`);
      }
    }
    await deps.orgStore.upsertOrgRepo(orgId, repoId, {
      lightningEnabled: true,
      indexStatus: lastJobId ? "queued" : "idle",
      lastJobId,
      error: undefined
    });
  }
}

async function handleGetWorkspaceRepos(
  response: ServerResponse,
  deps: OrgApiDeps,
  workspaceStore: UserWorkspaceStore,
  orgId: string,
  userId: string,
  plan: import("./orgStore").OrgPlan
): Promise<void> {
  const selections = await workspaceStore.listUserWorkspaceRepos(orgId, userId);
  const quota = await workspaceStore.getUserWorkspaceQuota(orgId, userId, plan);
  const orgRepos = await deps.orgStore!.listOrgRepos(orgId);
  const orgRepoById = new Map(orgRepos.map((repo) => [repo.repoId, repo]));
  const repos = selections.map((selection, index) => {
    const orgRepo = orgRepoById.get(selection.repoId);
    const parsed = parseRepoId(selection.repoId);
    return {
      repoId: selection.repoId,
      owner: parsed.owner,
      name: parsed.repo,
      defaultBranch: "main",
      indexStatus: orgRepo?.indexStatus,
      lightningEnabled: orgRepo?.lightningEnabled,
      isPrimary: index === 0,
      sortOrder: selection.sortOrder
    };
  });
  writeJson(response, 200, {
    repos,
    selectedCount: quota.selectedCount,
    limit: quota.limit,
    canAddMore: quota.canAddMore,
    primaryRepoId: quota.primaryRepoId
  });
}

async function handlePutWorkspaceRepos(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: OrgApiDeps,
  workspaceStore: UserWorkspaceStore,
  auth: NonNullable<Awaited<ReturnType<typeof resolveAuthContext>>>,
  userId: string,
  plan: import("./orgStore").OrgPlan
): Promise<void> {
  const body = asRecord(parsed.body);
  const rawRepoIds = body.repoIds;
  if (!Array.isArray(rawRepoIds)) {
    writeJson(response, 400, { error: "repoIds array is required" });
    return;
  }
  const repoIds = rawRepoIds.map((entry) => String(entry).trim()).filter(Boolean);
  const limit = workspaceRepoLimitForPlan(plan);
  if (limit === null && repoIds.length > 0) {
    writeJson(response, 403, {
      error: "plan_required",
      message: "Workspace repo selection requires a Pro or Enterprise plan."
    });
    return;
  }
  try {
    await ensureWorkspaceReposInOrgCatalog(auth.orgId, repoIds, deps);
    await workspaceStore.setUserWorkspaceRepos(auth.orgId, userId, repoIds, plan);
    await audit(deps, auth, "workspace.repos.update", { count: repoIds.length });
    await handleGetWorkspaceRepos(response, deps, workspaceStore, auth.orgId, userId, plan);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update workspace repos.";
    const status = message.includes("at most") ? 403 : 400;
    writeJson(response, status, { error: "workspace_repos_invalid", message });
  }
}

async function handleEstateSync(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: OrgApiDeps,
  auth: NonNullable<Awaited<ReturnType<typeof resolveAuthContext>>>
): Promise<void> {
  if (!deps.orgStore) {
    writeJson(response, 503, { error: "organization database not configured" });
    return;
  }

  const body = asRecord(parsed.body);
  const providerRaw = String(body.provider ?? "github").trim().toLowerCase();
  if (providerRaw !== "github" && providerRaw !== "gitlab" && providerRaw !== "bitbucket") {
    writeJson(response, 400, {
      error: "invalid_provider",
      message: "provider must be github, gitlab, or bitbucket."
    });
    return;
  }
  const provider = providerRaw as CodeHostProvider;

  try {
    const result = await runCatalogSyncForProvider(auth.orgId, provider, {
      orgStore: deps.orgStore,
      jobQueue: deps.jobQueue,
      githubApp: deps.githubApp,
      allowPatFallback: deps.serverConfig.devMode,
      force: body.force === true
    });
    await audit(deps, auth, "estate.sync", result);
    writeJson(response, 202, result);
  } catch (error) {
    if (error instanceof CatalogSyncError) {
      const status =
        error.code === "plan_required"
          ? 403
          : error.code === "indexing_unavailable"
            ? 503
            : 400;
      writeJson(response, status, { error: error.code, message: error.message, provider });
      return;
    }
    const message = error instanceof Error ? error.message : "Catalog sync failed.";
    writeJson(response, 502, { error: "catalog_sync_failed", message, provider });
  }
}

async function handleCreateCollection(
  parsed: ParsedRequest,
  response: ServerResponse,
  orgId: string
): Promise<void> {
  const pool = requireDbPool(await getDbPool());
  const body = asRecord(parsed.body);
  const name = String(body.name ?? "").trim();
  const description = body.description ? String(body.description) : undefined;
  if (!name) {
    writeJson(response, 400, { error: "name is required" });
    return;
  }
  try {
    const store = new CollectionStore(pool);
    const collection = await store.createCollection(orgId, name, description);
    writeJson(response, 201, { collection });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to create collection";
    const status = message.includes("unique") ? 409 : 500;
    writeJson(response, status, { error: message });
  }
}

async function handleListCollections(response: ServerResponse, orgId: string): Promise<void> {
  const pool = requireDbPool(await getDbPool());
  const store = new CollectionStore(pool);
  const collections = await store.listCollections(orgId);
  const enriched = await Promise.all(
    collections.map(async (collection) => ({
      ...collection,
      repos: await store.listCollectionRepos(orgId, collection.id)
    }))
  );
  writeJson(response, 200, { collections: enriched });
}

async function handleAddCollectionRepo(
  collectionId: string,
  parsed: ParsedRequest,
  response: ServerResponse,
  orgId: string
): Promise<void> {
  const pool = requireDbPool(await getDbPool());
  const body = asRecord(parsed.body);
  const repoId = String(body.repoId ?? "").trim();
  if (!repoId) {
    writeJson(response, 400, { error: "repoId is required" });
    return;
  }
  try {
    const store = new CollectionStore(pool);
    const repo = await store.addRepoToCollection(orgId, collectionId, repoId);
    writeJson(response, 200, { repo });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to add repo";
    const status = message === "Collection not found" ? 404 : message.includes("not registered") ? 400 : 500;
    writeJson(response, status, { error: message });
  }
}

async function handleRemoveCollectionRepo(
  collectionId: string,
  repoId: string,
  response: ServerResponse,
  orgId: string
): Promise<void> {
  const pool = requireDbPool(await getDbPool());
  const store = new CollectionStore(pool);
  const removed = await store.removeRepoFromCollection(orgId, collectionId, repoId);
  if (!removed) {
    writeJson(response, 404, { error: "collection or repo membership not found" });
    return;
  }
  writeJson(response, 200, { ok: true, collectionId, repoId });
}

async function handleGetRepoManifest(
  repoId: string,
  response: ServerResponse,
  orgId: string
): Promise<void> {
  const pool = requireDbPool(await getDbPool());
  if (!pool) {
    writeJson(response, 503, { error: "organization database not configured" });
    return;
  }
  const store = new RepoManifestStore(pool);
  const files = await store.loadManifest(orgId, repoId);
  const lastCrawledAt = await pool.query<{ last_crawled_at: Date | null }>(
    `SELECT MAX(last_crawled_at) AS last_crawled_at FROM repo_manifests WHERE org_id = $1 AND repo_id = $2`,
    [orgId, repoId]
  );
  const crawled = lastCrawledAt.rows[0]?.last_crawled_at;
  writeJson(response, 200, {
    repoId,
    files: files.map((file) => ({ path: file.filePath, symbols: file.symbols })),
    fileCount: files.length,
    lastCrawledAt: crawled ? new Date(crawled).toISOString() : undefined
  });
}

async function audit(
  deps: OrgApiDeps,
  auth: AuthContext,
  action: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  const actor = auditActor(auth);
  await deps.auditLogger?.record({
    orgId: auth.orgId,
    userId: actor.userId,
    principal: actor.principal,
    action,
    metadata
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

async function fetchRepoFile(
  coords: RepoCoordinates,
  filePath: string,
  token: string
): Promise<Awaited<ReturnType<GitHubClient["getFileContent"]>>> {
  switch (coords.provider) {
    case "github":
      return new GitHubClient({ token }).getFileContent(coords, filePath);
    case "gitlab":
      return new GitLabClient({ token }).getFileContent(coords, filePath);
    case "bitbucket":
      return new BitbucketClient({ token }).getFileContent(coords, filePath);
    default:
      throw new CodeHostError(`Unsupported provider: ${coords.provider}`, "unsupported");
  }
}

async function handleGetRepoTree(
  repoId: string,
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: OrgApiDeps,
  auth: NonNullable<Awaited<ReturnType<typeof resolveAuthContext>>>
): Promise<void> {
  const dirPath = parsed.query?.get("path")?.trim() ?? "";
  const target = parseRepoId(repoId);
  const token = await resolveCodeHostTokenForOrg(auth.orgId, target.provider, {
    orgStore: deps.orgStore!,
    connector: getConnector(target.provider),
    allowPatFallback: deps.serverConfig.devMode
  });
  if (!token) {
    writeJson(response, 401, {
      error: `${target.provider} App is not installed for this organization. Install it from CoopAI settings.`
    });
    return;
  }

  const branch = parsed.query?.get("branch")?.trim() || undefined;
  const coords = { provider: target.provider, owner: target.owner, repo: target.repo, branch };
  try {
    const tree = await fetchRepoTree(coords, dirPath, token);
    writeJson(response, 200, {
      repoId,
      path: tree.path,
      branch: tree.branch,
      entries: tree.entries
    });
  } catch (error) {
    if (error instanceof CodeHostError) {
      writeJson(response, error.status ?? 502, { error: error.message, code: error.code });
      return;
    }
    const message = error instanceof Error ? error.message : "failed to fetch tree";
    writeJson(response, 502, { error: message });
  }
}

async function handleGetRepoSearch(
  repoId: string,
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: OrgApiDeps,
  auth: NonNullable<Awaited<ReturnType<typeof resolveAuthContext>>>
): Promise<void> {
  const query = parsed.query?.get("q")?.trim() ?? "";
  if (!query) {
    writeJson(response, 400, { error: "q query parameter is required" });
    return;
  }
  const limit = Math.min(Math.max(Number(parsed.query?.get("limit") ?? 30) || 30, 1), 50);
  const target = parseRepoId(repoId);
  const token = await resolveCodeHostTokenForOrg(auth.orgId, target.provider, {
    orgStore: deps.orgStore!,
    connector: getConnector(target.provider),
    allowPatFallback: deps.serverConfig.devMode
  });
  if (!token) {
    writeJson(response, 401, {
      error: `${target.provider} App is not installed for this organization. Install it from CoopAI settings.`
    });
    return;
  }

  const branch = parsed.query?.get("branch")?.trim() || undefined;
  const coords = { provider: target.provider, owner: target.owner, repo: target.repo, branch };
  try {
    const hits = await searchRepoFiles(coords, query, token, limit);
    writeJson(response, 200, {
      repoId,
      query,
      hits: hits.map((hit) => ({
        path: hit.path,
        name: hit.path.split("/").pop() ?? hit.path
      }))
    });
  } catch (error) {
    if (error instanceof CodeHostError) {
      writeJson(response, error.status ?? 502, { error: error.message, code: error.code });
      return;
    }
    const message = error instanceof Error ? error.message : "failed to search repository files";
    writeJson(response, 502, { error: message });
  }
}

async function searchRepoFiles(
  coords: RepoCoordinates,
  query: string,
  token: string,
  limit: number
): Promise<Array<{ path: string }>> {
  switch (coords.provider) {
    case "github": {
      const searchQuery = buildExplorerFileSearchQuery(query, coords.provider);
      return new GitHubClient({ token }).searchCode(coords, searchQuery, limit);
    }
    case "gitlab":
      return new GitLabClient({ token }).searchCode(coords, query, limit);
    case "bitbucket":
      throw new CodeHostError(
        "File search isn't supported for this code host yet.",
        "unsupported",
        400,
        coords.provider
      );
    default:
      throw new CodeHostError(`Unsupported provider: ${coords.provider}`, "unsupported");
  }
}

async function fetchRepoTree(
  coords: RepoCoordinates,
  dirPath: string,
  token: string
): Promise<Awaited<ReturnType<GitHubClient["getRepositoryTree"]>>> {
  switch (coords.provider) {
    case "github":
      return new GitHubClient({ token }).getRepositoryTree(coords, dirPath);
    case "gitlab":
      return new GitLabClient({ token }).getRepositoryTree(coords, dirPath);
    case "bitbucket":
      return new BitbucketClient({ token }).getRepositoryTree(coords, dirPath);
    default:
      throw new CodeHostError(`Unsupported provider: ${coords.provider}`, "unsupported");
  }
}

type OrgRepoContext = {
  repoId: string;
  coords: RepoCoordinates;
  token: string;
};

async function resolveOrgRepoContext(
  repoId: string,
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: OrgApiDeps,
  auth: NonNullable<Awaited<ReturnType<typeof resolveAuthContext>>>
): Promise<OrgRepoContext | undefined> {
  const target = parseRepoId(repoId);
  const token = await resolveCodeHostTokenForOrg(auth.orgId, target.provider, {
    orgStore: deps.orgStore!,
    connector: getConnector(target.provider),
    allowPatFallback: deps.serverConfig.devMode
  });
  if (!token) {
    writeJson(response, 401, {
      error: `${target.provider} App is not installed for this organization. Install it from CoopAI settings.`
    });
    return undefined;
  }
  const branch = parsed.query?.get("branch")?.trim() || undefined;
  return {
    repoId,
    coords: { provider: target.provider, owner: target.owner, repo: target.repo, branch },
    token
  };
}

async function handleGetRepoBlame(
  repoId: string,
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: OrgApiDeps,
  auth: NonNullable<Awaited<ReturnType<typeof resolveAuthContext>>>
): Promise<void> {
  const filePath = parsed.query?.get("path")?.trim();
  if (!filePath) {
    writeJson(response, 400, { error: "path query parameter is required" });
    return;
  }
  const ctx = await resolveOrgRepoContext(repoId, parsed, response, deps, auth);
  if (!ctx) {
    return;
  }
  try {
    const blame = await fetchRepoBlame(ctx.coords, filePath, ctx.token);
    writeJson(response, 200, { repoId, path: filePath, blame });
  } catch (error) {
    writeCodeHostError(response, error, "failed to fetch blame");
  }
}

async function handleGetRepoHistory(
  repoId: string,
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: OrgApiDeps,
  auth: NonNullable<Awaited<ReturnType<typeof resolveAuthContext>>>
): Promise<void> {
  const filePath = parsed.query?.get("path")?.trim() ?? "";
  const limit = Math.min(Math.max(Number(parsed.query?.get("limit") ?? 20) || 20, 1), 100);
  const ctx = await resolveOrgRepoContext(repoId, parsed, response, deps, auth);
  if (!ctx) {
    return;
  }
  try {
    const commits = await fetchRepoHistory(ctx.coords, filePath, ctx.token, limit);
    writeJson(response, 200, { repoId, path: filePath || undefined, commits });
  } catch (error) {
    writeCodeHostError(response, error, filePath ? "failed to fetch file history" : "failed to fetch commit history");
  }
}

async function handleGetRepoCommit(
  repoId: string,
  sha: string,
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: OrgApiDeps,
  auth: NonNullable<Awaited<ReturnType<typeof resolveAuthContext>>>
): Promise<void> {
  const ctx = await resolveOrgRepoContext(repoId, parsed, response, deps, auth);
  if (!ctx) {
    return;
  }
  try {
    const commit = await fetchRepoCommit(ctx.coords, sha, ctx.token);
    writeJson(response, 200, { repoId, sha, commit });
  } catch (error) {
    writeCodeHostError(response, error, "failed to fetch commit");
  }
}

async function handleGetRepoPullsForFile(
  repoId: string,
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: OrgApiDeps,
  auth: NonNullable<Awaited<ReturnType<typeof resolveAuthContext>>>
): Promise<void> {
  const filePath = parsed.query?.get("path")?.trim();
  if (!filePath) {
    writeJson(response, 400, { error: "path query parameter is required" });
    return;
  }
  const limit = Math.min(Math.max(Number(parsed.query?.get("limit") ?? 20) || 20, 1), 50);
  const ctx = await resolveOrgRepoContext(repoId, parsed, response, deps, auth);
  if (!ctx) {
    return;
  }
  try {
    const pulls = await fetchRepoPullsForFile(ctx.coords, filePath, ctx.token, limit);
    writeJson(response, 200, { repoId, path: filePath, pulls });
  } catch (error) {
    writeCodeHostError(response, error, "failed to fetch pull requests");
  }
}

async function handleGetRepoPullDetail(
  repoId: string,
  prNumber: number,
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: OrgApiDeps,
  auth: NonNullable<Awaited<ReturnType<typeof resolveAuthContext>>>
): Promise<void> {
  if (!Number.isFinite(prNumber) || prNumber <= 0) {
    writeJson(response, 400, { error: "invalid pull request number" });
    return;
  }
  const ctx = await resolveOrgRepoContext(repoId, parsed, response, deps, auth);
  if (!ctx) {
    return;
  }
  const commitSha = parsed.query?.get("commitSha")?.trim();
  try {
    const pull = await fetchRepoPullDetail(ctx.coords, prNumber, ctx.token);
    writeJson(response, 200, { repoId, number: prNumber, pull });
  } catch (error) {
    if (commitSha && isNotFoundError(error)) {
      try {
        const linked = await fetchRepoCommitPulls(ctx.coords, commitSha, ctx.token);
        const fromCommit = linked.find((entry) => entry.number === prNumber);
        if (fromCommit) {
          writeJson(response, 200, { repoId, number: prNumber, pull: fromCommit });
          return;
        }
      } catch {
        /* fall through */
      }
    }
    writeCodeHostError(response, error, "failed to fetch pull request");
  }
}

function isNotFoundError(error: unknown): boolean {
  if (error instanceof CodeHostError) {
    return error.status === 404 || error.code === "not_found";
  }
  const message = error instanceof Error ? error.message : String(error);
  return /\b404\b/.test(message) || /not found/i.test(message);
}

async function handleGetRepoCommitPulls(
  repoId: string,
  sha: string,
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: OrgApiDeps,
  auth: NonNullable<Awaited<ReturnType<typeof resolveAuthContext>>>
): Promise<void> {
  const ctx = await resolveOrgRepoContext(repoId, parsed, response, deps, auth);
  if (!ctx) {
    return;
  }
  try {
    const pulls = await fetchRepoCommitPulls(ctx.coords, sha, ctx.token);
    writeJson(response, 200, { repoId, sha, pulls });
  } catch (error) {
    writeCodeHostError(response, error, "failed to fetch commit pull requests");
  }
}

async function fetchRepoPullDetail(
  coords: RepoCoordinates,
  prNumber: number,
  token: string
): Promise<{
  number: number;
  title: string;
  body?: string;
  state: string;
  merged: boolean;
  author?: string;
  createdAt: string;
  updatedAt: string;
  htmlUrl?: string;
  labels: string[];
}> {
  if (coords.provider !== "github") {
    throw new CodeHostError("Pull request details are only supported for GitHub.", "unsupported", 400, coords.provider);
  }
  const url = `https://api.github.com/repos/${encodeURIComponent(coords.owner)}/${encodeURIComponent(coords.repo)}/pulls/${prNumber}`;
  const pr = await codeHostRequestJson<{
    number: number;
    title: string;
    body?: string;
    state: string;
    merged_at?: string | null;
    user?: { login?: string };
    created_at: string;
    updated_at: string;
    html_url?: string;
    labels?: Array<{ name: string }>;
  }>(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "coop-ai-server"
    },
    provider: "github"
  });
  return {
    number: pr.number,
    title: pr.title,
    body: pr.body,
    state: pr.state,
    merged: Boolean(pr.merged_at),
    author: pr.user?.login,
    createdAt: pr.created_at,
    updatedAt: pr.updated_at,
    htmlUrl: pr.html_url,
    labels: (pr.labels ?? []).map((label) => label.name)
  };
}

type CommitLinkedPull = {
  number: number;
  title: string;
  body?: string;
  state: string;
  merged: boolean;
  author?: string;
  createdAt: string;
  updatedAt: string;
  htmlUrl?: string;
  owner: string;
  repo: string;
  labels: string[];
};

async function fetchRepoCommitPulls(
  coords: RepoCoordinates,
  sha: string,
  token: string
): Promise<CommitLinkedPull[]> {
  if (coords.provider !== "github") {
    return [];
  }
  const url = `https://api.github.com/repos/${encodeURIComponent(coords.owner)}/${encodeURIComponent(coords.repo)}/commits/${encodeURIComponent(sha)}/pulls`;
  const pulls = await codeHostRequestJson<
    Array<{
      number: number;
      title: string;
      body?: string;
      state: string;
      merged_at?: string | null;
      user?: { login?: string };
      created_at: string;
      updated_at: string;
      html_url?: string;
      url?: string;
      labels?: Array<{ name: string }>;
      base?: { repo?: { owner?: { login?: string }; name?: string } };
    }>
  >(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "coop-ai-server"
    },
    provider: "github"
  }).catch(() => []);
  return pulls.map((pull) => {
    const fromBase = pull.base?.repo;
    const fromApiUrl = parseGithubPullApiUrl(pull.url);
    const owner = fromBase?.owner?.login ?? fromApiUrl?.owner ?? coords.owner;
    const repo = fromBase?.name ?? fromApiUrl?.repo ?? coords.repo;
    return {
      number: pull.number,
      title: pull.title,
      body: pull.body,
      state: pull.state,
      merged: Boolean(pull.merged_at),
      author: pull.user?.login,
      createdAt: pull.created_at,
      updatedAt: pull.updated_at,
      htmlUrl: pull.html_url,
      owner,
      repo,
      labels: (pull.labels ?? []).map((label) => label.name)
    };
  });
}

function parseGithubPullApiUrl(apiUrl?: string): { owner: string; repo: string } | undefined {
  if (!apiUrl) {
    return undefined;
  }
  const match = /\/repos\/([^/]+)\/([^/]+)\/pulls\//.exec(apiUrl);
  if (!match) {
    return undefined;
  }
  return { owner: match[1], repo: match[2] };
}

async function handleGetRepoPullComments(
  repoId: string,
  prNumber: number,
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: OrgApiDeps,
  auth: NonNullable<Awaited<ReturnType<typeof resolveAuthContext>>>
): Promise<void> {
  if (!Number.isFinite(prNumber) || prNumber <= 0) {
    writeJson(response, 400, { error: "invalid pull request number" });
    return;
  }
  const ctx = await resolveOrgRepoContext(repoId, parsed, response, deps, auth);
  if (!ctx) {
    return;
  }
  const pullOwner = parsed.query?.get("pullOwner")?.trim();
  const pullRepo = parsed.query?.get("pullRepo")?.trim();
  const commentCoords =
    pullOwner && pullRepo
      ? { ...ctx.coords, owner: pullOwner, repo: pullRepo }
      : ctx.coords;
  try {
    const comments = await fetchRepoPullComments(commentCoords, prNumber, ctx.token);
    writeJson(response, 200, { repoId, number: prNumber, comments });
  } catch (error) {
    writeCodeHostError(response, error, "failed to fetch pull request comments");
  }
}

async function fetchRepoBlame(
  coords: RepoCoordinates,
  filePath: string,
  token: string
): Promise<Awaited<ReturnType<GitHubClient["getBlameData"]>>> {
  switch (coords.provider) {
    case "github":
      return new GitHubClient({ token }).getBlameData(coords, filePath);
    case "gitlab":
      return new GitLabClient({ token }).getBlameData(coords, filePath);
    case "bitbucket":
      return new BitbucketClient({ token }).getBlameData(coords, filePath);
    default:
      throw new CodeHostError(`Unsupported provider: ${coords.provider}`, "unsupported");
  }
}

async function fetchRepoHistory(
  coords: RepoCoordinates,
  filePath: string,
  token: string,
  limit: number
): Promise<Awaited<ReturnType<GitHubClient["getFileHistory"]>>> {
  const path = filePath.replace(/^\/+/, "");
  switch (coords.provider) {
    case "github": {
      const client = new GitHubClient({ token });
      return path
        ? client.getFileHistory(coords, path, limit)
        : client.getCommitHistory(coords, { limit });
    }
    case "gitlab": {
      const client = new GitLabClient({ token });
      return path
        ? client.getFileHistory(coords, path, limit)
        : client.getCommitHistory(coords, { limit });
    }
    case "bitbucket": {
      const client = new BitbucketClient({ token });
      return path
        ? client.getFileHistory(coords, path, limit)
        : client.getCommitHistory(coords, { limit });
    }
    default:
      throw new CodeHostError(`Unsupported provider: ${coords.provider}`, "unsupported");
  }
}

async function handleGetRepoMetadata(
  repoId: string,
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: OrgApiDeps,
  auth: NonNullable<Awaited<ReturnType<typeof resolveAuthContext>>>
): Promise<void> {
  const ctx = await resolveOrgRepoContext(repoId, parsed, response, deps, auth);
  if (!ctx) {
    return;
  }
  try {
    const repository = await fetchRepoMetadata(ctx.coords, ctx.token);
    writeJson(response, 200, { repoId, repository });
  } catch (error) {
    writeCodeHostError(response, error, "failed to fetch repository metadata");
  }
}

async function handleGetRepoPulls(
  repoId: string,
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: OrgApiDeps,
  auth: NonNullable<Awaited<ReturnType<typeof resolveAuthContext>>>
): Promise<void> {
  const state = parsed.query?.get("state")?.trim() || "all";
  const limit = Math.min(Math.max(Number(parsed.query?.get("limit") ?? 20) || 20, 1), 50);
  const ctx = await resolveOrgRepoContext(repoId, parsed, response, deps, auth);
  if (!ctx) {
    return;
  }
  try {
    const pulls = await fetchRepoPulls(ctx.coords, ctx.token, { state, limit });
    writeJson(response, 200, { repoId, pulls });
  } catch (error) {
    writeCodeHostError(response, error, "failed to list pull requests");
  }
}

async function handleGetRepoIssues(
  repoId: string,
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: OrgApiDeps,
  auth: NonNullable<Awaited<ReturnType<typeof resolveAuthContext>>>
): Promise<void> {
  const state = parsed.query?.get("state")?.trim() || "all";
  const limit = Math.min(Math.max(Number(parsed.query?.get("limit") ?? 20) || 20, 1), 50);
  const ctx = await resolveOrgRepoContext(repoId, parsed, response, deps, auth);
  if (!ctx) {
    return;
  }
  try {
    const issues = await fetchRepoIssues(ctx.coords, ctx.token, { state, limit });
    writeJson(response, 200, { repoId, issues });
  } catch (error) {
    writeCodeHostError(response, error, "failed to list issues");
  }
}

async function handleGetRepoPullReviews(
  repoId: string,
  prNumber: number,
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: OrgApiDeps,
  auth: NonNullable<Awaited<ReturnType<typeof resolveAuthContext>>>
): Promise<void> {
  if (!Number.isFinite(prNumber) || prNumber <= 0) {
    writeJson(response, 400, { error: "invalid pull request number" });
    return;
  }
  const ctx = await resolveOrgRepoContext(repoId, parsed, response, deps, auth);
  if (!ctx) {
    return;
  }
  try {
    const reviews = await fetchRepoPullReviews(ctx.coords, prNumber, ctx.token);
    writeJson(response, 200, { repoId, number: prNumber, reviews });
  } catch (error) {
    writeCodeHostError(response, error, "failed to fetch pull request reviews");
  }
}

async function fetchRepoMetadata(
  coords: RepoCoordinates,
  token: string
): Promise<Awaited<ReturnType<GitHubClient["getRepository"]>>> {
  switch (coords.provider) {
    case "github":
      return new GitHubClient({ token }).getRepository(coords);
    case "gitlab":
      return new GitLabClient({ token }).getRepository(coords);
    case "bitbucket":
      return new BitbucketClient({ token }).getRepository(coords);
    default:
      throw new CodeHostError(`Unsupported provider: ${coords.provider}`, "unsupported");
  }
}

async function fetchRepoPulls(
  coords: RepoCoordinates,
  token: string,
  options?: { state?: string; limit?: number }
): Promise<Awaited<ReturnType<GitHubClient["listPullRequests"]>>> {
  const limit = options?.limit ?? 20;
  const state = options?.state ?? "all";
  switch (coords.provider) {
    case "github":
      return new GitHubClient({ token }).listPullRequests(coords, { state, limit });
    case "gitlab":
      return new GitLabClient({ token }).listPullRequests(coords, { state, limit });
    case "bitbucket":
      return new BitbucketClient({ token }).listPullRequests(coords, { state, limit });
    default:
      throw new CodeHostError(`Unsupported provider: ${coords.provider}`, "unsupported");
  }
}

async function fetchRepoIssues(
  coords: RepoCoordinates,
  token: string,
  options?: { state?: string; limit?: number }
): Promise<Awaited<ReturnType<GitHubClient["listIssues"]>>> {
  const limit = options?.limit ?? 20;
  const state = options?.state ?? "all";
  switch (coords.provider) {
    case "github":
      return new GitHubClient({ token }).listIssues(coords, { state, limit });
    case "gitlab":
      return new GitLabClient({ token }).listIssues(coords, { state, limit });
    case "bitbucket":
      return new BitbucketClient({ token }).listIssues(coords, { state, limit });
    default:
      throw new CodeHostError(`Unsupported provider: ${coords.provider}`, "unsupported");
  }
}

async function fetchRepoPullReviews(
  coords: RepoCoordinates,
  prNumber: number,
  token: string
): Promise<Awaited<ReturnType<GitHubClient["getPullRequestReviews"]>>> {
  switch (coords.provider) {
    case "github":
      return new GitHubClient({ token }).getPullRequestReviews(coords, prNumber);
    case "gitlab":
      return new GitLabClient({ token }).getPullRequestReviews(coords, prNumber);
    case "bitbucket":
      return new BitbucketClient({ token }).getPullRequestReviews(coords, prNumber);
    default:
      throw new CodeHostError(`Unsupported provider: ${coords.provider}`, "unsupported");
  }
}

async function fetchRepoCommit(
  coords: RepoCoordinates,
  sha: string,
  token: string
): Promise<Awaited<ReturnType<GitHubClient["getCommitBySha"]>>> {
  switch (coords.provider) {
    case "github":
      return new GitHubClient({ token }).getCommitBySha(coords, sha);
    case "gitlab":
      return new GitLabClient({ token }).getCommitBySha(coords, sha);
    case "bitbucket":
      return new BitbucketClient({ token }).getCommitBySha(coords, sha);
    default:
      throw new CodeHostError(`Unsupported provider: ${coords.provider}`, "unsupported");
  }
}

async function fetchRepoPullsForFile(
  coords: RepoCoordinates,
  filePath: string,
  token: string,
  limit: number
): Promise<Awaited<ReturnType<GitHubClient["listPullRequests"]>>> {
  const path = filePath.replace(/^\/+/, "");
  switch (coords.provider) {
    case "github": {
      const client = new GitHubClient({ token });
      const prs = await client.listPullRequests(coords, { state: "all", limit: 50 });
      const enriched = await Promise.all(
        prs.slice(0, 20).map(async (pr) => {
          if (pr.files?.length) {
            return pr;
          }
          try {
            const files = await client.getPullRequestFiles(coords, pr.number);
            return { ...pr, files };
          } catch {
            return pr;
          }
        })
      );
      return enriched
        .filter((pr) => !pr.files || pr.files.includes(path) || pr.files.some((file) => path.startsWith(file)))
        .slice(0, limit);
    }
    case "gitlab":
    case "bitbucket":
      throw new CodeHostError(
        "Pull request lookup for a file isn't supported for this code host yet.",
        "unsupported",
        400,
        coords.provider
      );
    default:
      throw new CodeHostError(`Unsupported provider: ${coords.provider}`, "unsupported");
  }
}

async function fetchRepoPullComments(
  coords: RepoCoordinates,
  prNumber: number,
  token: string
): Promise<Awaited<ReturnType<GitHubClient["getPullRequestComments"]>>> {
  switch (coords.provider) {
    case "github":
      return new GitHubClient({ token }).getPullRequestComments(coords, prNumber);
    case "gitlab":
      return new GitLabClient({ token }).getPullRequestComments(coords, prNumber);
    case "bitbucket":
      return new BitbucketClient({ token }).getPullRequestComments(coords, prNumber);
    default:
      throw new CodeHostError(`Unsupported provider: ${coords.provider}`, "unsupported");
  }
}

function writeCodeHostError(response: ServerResponse, error: unknown, fallback: string): void {
  if (error instanceof CodeHostError) {
    writeJson(response, error.status ?? 502, { error: error.message, code: error.code });
    return;
  }
  const message = error instanceof Error ? error.message : fallback;
  writeJson(response, 502, { error: message });
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body, (_key, value) => (value instanceof Date ? value.toISOString() : value)));
}

export { extractBearerToken };
