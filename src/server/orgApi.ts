import type { ServerResponse } from "node:http";
import type { JobQueue } from "../jobs/jobQueue";
import { GitHubClient } from "../api/codeHosts/githubClient";
import { CodeHostError } from "../api/codeHosts/types";
import { parseRepoId } from "../jobs/buildStructureManifest";
import { RepoManifestStore } from "../manifest/repoManifestStore";
import { requireDbPool, getDbPool } from "./db";
import { JobType } from "../jobs/types";
import {
  authUserId,
  extractBearerToken,
  requireAuth,
  requireOrgPlan,
  resolveAuthContext,
  resolveOrgPlanFromDb
} from "./authMiddleware";
import { resolveGithubTokenForOrg } from "./codeHostCredentialResolver";
import type { GitHubAppService } from "./githubAppService";
import { canUseLightningPlan, type OrgStore } from "./orgStore";
import type { ServerConfig } from "./serverConfig";

export type OrgApiDeps = {
  orgStore?: OrgStore;
  jobQueue?: JobQueue;
  serverConfig: ServerConfig;
  githubApp?: GitHubAppService;
};

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
    deps.serverConfig.requireApiAuth
  );
  if (!requireAuth(auth, deps.serverConfig.requireApiAuth)) {
    writeJson(response, 401, { error: "unauthorized" });
    return true;
  }

  if (parsed.method === "GET" && parsed.pathname === "/v1/me") {
    const plan = (await resolveOrgPlanFromDb(deps.orgStore, auth!)) ?? auth!.plan;
    writeJson(response, 200, {
      orgId: auth!.orgId,
      orgName: auth!.orgName,
      plan,
      canUseLightning: canUseLightningPlan(plan),
      lightningBackend: "cloud"
    });
    return true;
  }

  if (!deps.orgStore || auth!.orgId === "legacy") {
    writeJson(response, 503, { error: "organization database not configured" });
    return true;
  }

  if (parsed.method === "POST" && parsed.pathname === "/v1/orgs/credentials/github") {
    await handleStoreGithubCredential(parsed, response, deps, auth!);
    return true;
  }

  if (parsed.method === "GET" && parsed.pathname === "/v1/orgs/repos") {
    const repos = await deps.orgStore.listOrgRepos(auth!.orgId);
    writeJson(response, 200, { repos });
    return true;
  }

  const enableMatch = parsed.pathname.match(/^\/v1\/orgs\/repos\/([^/]+)\/lightning\/enable$/);
  if (parsed.method === "POST" && enableMatch) {
    if (!(await requireOrgPlan(deps.orgStore, auth!, response, "pro", "enterprise"))) {
      return true;
    }
    const repoId = decodeURIComponent(enableMatch[1]);
    await handleEnableLightning(repoId, parsed, response, deps, auth!);
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
    return true;
  }

  writeJson(response, 404, { error: "not found" });
  return true;
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
  if (target.provider !== "github") {
    writeJson(response, 400, { error: "Only GitHub repositories are supported for cloud file fetch" });
    return;
  }

  const token = await resolveGithubTokenForOrg(auth.orgId, {
    orgStore: deps.orgStore!,
    githubApp: deps.githubApp,
    allowPatFallback: deps.serverConfig.devMode
  });
  if (!token) {
    writeJson(response, 401, {
      error: "GitHub App is not installed for this organization. Install it from CoopAI settings."
    });
    return;
  }

  const branch = parsed.query?.get("branch")?.trim() || undefined;
  const client = new GitHubClient({ token });
  try {
    const file = await client.getFileContent(
      { provider: "github", owner: target.owner, repo: target.repo, branch },
      filePath
    );
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

  await deps.orgStore!.upsertOrgRepo(auth.orgId, repoId, {
    lightningEnabled: true,
    indexStatus: "queued",
    error: undefined
  });

  const submit = await deps.jobQueue.createJob({
    type: JobType.INDEX_REPOSITORY,
    priority: "high",
    userId: authUserId(auth),
    params: {
      repoId,
      orgId: auth.orgId
    }
  });

  await deps.orgStore!.upsertOrgRepo(auth.orgId, repoId, {
    lightningEnabled: true,
    indexStatus: "queued",
    lastJobId: submit.jobId
  });

  writeJson(response, 202, {
    repoId,
    jobId: submit.jobId,
    status: "queued",
    estimatedWaitTime: submit.estimatedWaitTime
  });
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

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body, (_key, value) => (value instanceof Date ? value.toISOString() : value)));
}

export { extractBearerToken };
