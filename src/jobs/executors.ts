import type { GraphCache } from "../cache/graphCache";
import type { GraphConsistencyManager } from "../cache/graphConsistency";
import { chunkAndEmbed } from "../indexing/chunkAndEmbed";
import { RepoSymbolIndexStore } from "../indexing/repoSymbolIndexStore";
import { resolveCodeHostTokenForOrg } from "../server/codeHostCredentialResolver";
import { getConnector } from "../server/codeHostConnectors/registry";
import type { CodeHostProvider } from "../api/codeHosts/types";
import { getDbPool } from "../server/db";
import type { GitHubAppService } from "../server/githubAppService";
import { cloneRepository, parseRepoId, removeRepositoryClone } from "../server/gitCloneService";
import { canUseLightningPlan, type OrgStore } from "../server/orgStore";
import { JobType, type Job } from "./types";
import { buildPartialFailure } from "./errorHandling";
import { buildStructureManifest } from "./buildStructureManifest";
import { runScipIndexer } from "./runScipIndexer";

export type JobExecutionContext = {
  cache: GraphCache;
  consistency?: GraphConsistencyManager;
  orgStore?: OrgStore;
  githubApp?: GitHubAppService;
  allowPatFallback?: boolean;
};

export type ProgressReporter = (progress: number, message?: string) => Promise<void>;

export async function executeJob(
  job: Job,
  ctx: JobExecutionContext,
  report: ProgressReporter,
  signal: AbortSignal
): Promise<unknown> {
  if (signal.aborted) {
    throw new Error("Job cancelled");
  }
  switch (job.type) {
    case JobType.SCAN_KNOWLEDGE_GAPS:
      return executeKnowledgeGapScan(job, ctx, report, signal);
    case JobType.BUILD_DEPENDENCY_GRAPH:
      return buildDependencyGraph(job, ctx, report, signal);
    case JobType.BUILD_STRUCTURE_MANIFEST:
      return buildStructureManifest(job, ctx, report, signal);
    case JobType.INDEX_REPOSITORY:
      return indexRepository(job, ctx, report, signal);
    case JobType.ANALYZE_OWNERSHIP:
      return analyzeOwnership(job, ctx, report, signal);
    case JobType.GENERATE_REPO_SUMMARY:
      return generateRepoSummary(job, ctx, report, signal);
    default:
      throw new Error(`Unknown job type: ${job.type as string}`);
  }
}

export async function executeKnowledgeGapScan(
  job: Job,
  ctx: JobExecutionContext,
  report: ProgressReporter,
  signal: AbortSignal
): Promise<unknown> {
  const repoIds = normalizeRepoIds(job.params);
  const completedRepos: string[] = [];
  const failedRepos: string[] = [];
  const gaps: Array<Record<string, unknown>> = [];

  for (let i = 0; i < repoIds.length; i += 1) {
    if (signal.aborted) {
      throw new Error("Job cancelled");
    }
    const repoId = repoIds[i];
    const progress = 15 + Math.round((i / repoIds.length) * 70);
    await report(progress, `Scanning ${repoId}`);

    try {
      ensureRepoGraph(ctx, repoId, job.params);
      const scan = scanRepoKnowledgeGaps(ctx.cache, repoId, job.params);
      gaps.push(...scan.gaps);
      completedRepos.push(repoId);
    } catch (error) {
      failedRepos.push(repoId);
      if (repoIds.length === 1) {
        throw error;
      }
    }
  }

  await report(95, "Aggregating results");
  const summary = aggregateGaps(gaps);

  if (failedRepos.length > 0 && completedRepos.length > 0) {
    return buildPartialFailure(
      completedRepos,
      failedRepos,
      {
        foundGaps: summary.total,
        highPriority: summary.high,
        mediumPriority: summary.medium,
        lowPriority: summary.low,
        gaps: gaps.slice(0, 200)
      },
      `Scanned ${completedRepos.length}/${repoIds.length} repos. ${failedRepos.join(", ")} failed.`
    );
  }

  return {
    status: "completed",
    foundGaps: summary.total,
    highPriority: summary.high,
    mediumPriority: summary.medium,
    lowPriority: summary.low,
    gaps: gaps.slice(0, 200),
    scannedRepos: completedRepos
  };
}

export async function buildDependencyGraph(
  job: Job,
  ctx: JobExecutionContext,
  report: ProgressReporter,
  signal: AbortSignal
): Promise<unknown> {
  const repoId = String(job.params.repoId ?? "");
  const orgId = job.params.orgId ? String(job.params.orgId) : undefined;
  if (!repoId) {
    throw new Error("Invalid parameters: repoId is required");
  }
  await report(20, "Loading repository graph");
  if (signal.aborted) {
    throw new Error("Job cancelled");
  }

  let graph = ctx.cache.getGraph(repoId);
  if (!graph) {
    const target = parseRepoId(repoId);
    graph = ctx.cache.upsertRepository({
      repoId,
      owner: target.owner,
      repo: target.repo,
      provider: target.provider
    });
  }

  await report(50, "Rebuilding dependency edges");
  const filePaths = new Set(graph.fileTree.map((f) => f.path));
  const preserved = graph.dependencies.filter((edge) => filePaths.has(edge.from) && filePaths.has(edge.to));
  const merged = await resolveDependencyEdges(orgId, repoId, graph.fileTree.map((f) => f.path), preserved);
  const updated = ctx.cache.setDependencies(repoId, merged);
  graph = updated ?? graph;

  await report(85, "Building transitive index");
  const nodeCount = graph.fileTree.length;
  const edgeCount = graph.dependencies.length;

  return {
    repoId,
    nodeCount,
    edgeCount,
    dependentsSample: graph.dependencies.slice(0, 10),
    lastIndexedAt: graph.metadata.lastIndexedAt.toISOString(),
    indexVersion: graph.metadata.indexVersion
  };
}

async function indexRepository(
  job: Job,
  ctx: JobExecutionContext,
  report: ProgressReporter,
  _signal: AbortSignal
): Promise<unknown> {
  const repoId = String(job.params.repoId ?? "");
  const orgId = job.params.orgId ? String(job.params.orgId) : undefined;
  if (!repoId) {
    throw new Error("Invalid parameters: repoId is required");
  }

  if (orgId && ctx.orgStore) {
    await ctx.orgStore.upsertOrgRepo(orgId, repoId, { indexStatus: "indexing", error: undefined });
  }

  await report(20, "Preparing repository clone");
  let graph = ctx.cache.getGraph(repoId);
  if (!graph) {
    const target = parseRepoId(repoId);
    graph = ctx.cache.upsertRepository({
      repoId,
      owner: target.owner,
      repo: target.repo,
      provider: target.provider
    });
  }

  let cloneLocalPath: string | undefined;
  try {
    const provider = providerForRepo(repoId);
    const token =
      orgId && ctx.orgStore
        ? await resolveCodeHostTokenForOrg(orgId, provider, {
            orgStore: ctx.orgStore,
            connector: getConnector(provider),
            allowPatFallback: ctx.allowPatFallback ?? false
          })
        : undefined;
    await report(45, "Cloning repository");
    const target = parseRepoId(repoId);
    const clone = await cloneRepository(target, token);
    cloneLocalPath = clone.localPath;

    let scipResult: Awaited<ReturnType<typeof runScipIndexer>> | undefined;
    let embedResult: Awaited<ReturnType<typeof chunkAndEmbed>> | undefined;
    if (orgId) {
      const pool = await getDbPool();
      if (pool) {
        await report(60, "Running SCIP symbol indexing");
        scipResult = await runScipIndexer(repoId, orgId, undefined, clone.localPath, pool);

        let shouldEmbed = false;
        if (ctx.orgStore) {
          const org = await ctx.orgStore.getOrganization(orgId);
          shouldEmbed = Boolean(org && canUseLightningPlan(org.plan));
        }
        if (shouldEmbed) {
          await report(75, "Embedding files without symbol coverage");
          embedResult = await chunkAndEmbed(repoId, orgId, clone.localPath, pool);
        }
      }
    }

    await report(80, "Building file index");

    const now = new Date();
    graph.fileTree = clone.files.map((file) => ({
      path: file.path,
      size: file.size,
      lastModified: now,
      lastAuthor: "cloud-index",
      sha: clone.headCommit ?? "local"
    }));
    graph.metadata.lastIndexedAt = now;
    graph.metadata.indexVersion += 1;
    graph.lastUpdated = now;
    ctx.cache.setGraph(graph);

    if (orgId) {
      const pool = await getDbPool();
      if (pool) {
        const store = new RepoSymbolIndexStore(pool);
        const symbolCount = await store.countSymbols(orgId, repoId);
        if (symbolCount > 0) {
          const filePaths = new Set(graph.fileTree.map((file) => file.path));
          const symbolEdges = await store.loadDependencyEdges(orgId, repoId);
          ctx.cache.setDependencies(
            repoId,
            dedupeEdges(symbolEdges.filter((edge) => filePaths.has(edge.from) && filePaths.has(edge.to)))
          );
        }
      }
    }

    if (orgId && ctx.orgStore) {
      await ctx.orgStore.upsertOrgRepo(orgId, repoId, {
        lightningEnabled: true,
        indexStatus: "ready",
        lastIndexedAt: now,
        lastJobId: job.id,
        error: undefined
      });
    }

    await report(95, "Index ready");
    return {
      repoId,
      fileCount: graph.fileTree.length,
      indexVersion: graph.metadata.indexVersion,
      lastIndexedAt: graph.metadata.lastIndexedAt.toISOString(),
      headCommit: clone.headCommit,
      scipAvailable: scipResult?.scipAvailable ?? false,
      symbolCount: scipResult?.symbolCount ?? 0,
      indexSource: scipResult?.source ?? "none",
      embeddingCount: embedResult?.chunkCount ?? 0,
      embeddedFiles: embedResult?.embeddedFiles ?? 0
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "index failed";
    if (orgId && ctx.orgStore) {
      await ctx.orgStore.upsertOrgRepo(orgId, repoId, {
        indexStatus: "error",
        lastJobId: job.id,
        error: message
      });
    }
    throw error;
  } finally {
    if (cloneLocalPath) {
      removeRepositoryClone(cloneLocalPath);
    }
  }
}

function providerForRepo(repoId: string): CodeHostProvider {
  return parseRepoId(repoId).provider;
}

async function analyzeOwnership(
  job: Job,
  ctx: JobExecutionContext,
  report: ProgressReporter,
  _signal: AbortSignal
): Promise<unknown> {
  const repoId = String(job.params.repoId ?? "");
  await report(40, "Analyzing ownership");
  const graph = ctx.cache.getGraph(repoId);
  if (!graph) {
    throw new Error(`404: Repository graph not found for ${repoId}`);
  }
  const file = job.params.file ? String(job.params.file) : undefined;
  const owners = file
    ? graph.owners.filter((entry) => entry.file === file)
    : graph.owners.slice(0, 100);
  return {
    repoId,
    file,
    ownerCount: graph.owners.length,
    owners
  };
}

async function generateRepoSummary(
  job: Job,
  ctx: JobExecutionContext,
  report: ProgressReporter,
  _signal: AbortSignal
): Promise<unknown> {
  const repoId = String(job.params.repoId ?? "");
  await report(35, "Generating summary");
  const graph = ctx.cache.getGraph(repoId);
  if (!graph) {
    throw new Error(`404: Repository graph not found for ${repoId}`);
  }
  return {
    repoId,
    branch: job.params.branch ?? graph.defaultBranch ?? "main",
    fileCount: graph.fileTree.length,
    dependencyCount: graph.dependencies.length,
    ownerCount: graph.owners.length,
    recentCommitCount: graph.recentCommits.length,
    language: graph.metadata.language,
    framework: graph.metadata.framework,
    lastIndexedAt: graph.metadata.lastIndexedAt.toISOString()
  };
}

function ensureRepoGraph(ctx: JobExecutionContext, repoId: string, params: Record<string, unknown>): void {
  if (ctx.cache.getGraph(repoId)) {
    return;
  }
  const target = parseRepoId(repoId);
  ctx.cache.upsertRepository({
    repoId,
    owner: String(params.owner ?? target.owner),
    repo: String(params.repo ?? target.repo),
    provider: target.provider
  });
}

function scanRepoKnowledgeGaps(
  cache: GraphCache,
  repoId: string,
  params: Record<string, unknown>
): { gaps: Array<Record<string, unknown>> } {
  const graph = cache.getGraph(repoId);
  if (!graph) {
    throw new Error(`404: Repository graph not found for ${repoId}`);
  }

  const gaps: Array<Record<string, unknown>> = [];
  const focusFile = params.file ? String(params.file) : undefined;
  const files = focusFile ? graph.fileTree.filter((f) => f.path === focusFile) : graph.fileTree;

  for (const file of files) {
    const hasOwner = graph.owners.some((o) => o.file === file.path && o.primaryOwner !== "unknown");
    const hasDependents = graph.dependencies.some((d) => d.to === file.path);
    const staleDays = daysSince(file.lastModified);

    if (!hasOwner) {
      gaps.push({
        file: file.path,
        type: "missing_owner",
        priority: "high",
        message: "No clear code owner"
      });
    }
    if (!hasDependents && graph.fileTree.length > 20) {
      gaps.push({
        file: file.path,
        type: "orphaned_file",
        priority: "medium",
        message: "No inbound dependencies detected"
      });
    }
    if (staleDays > 365) {
      gaps.push({
        file: file.path,
        type: "stale_file",
        priority: "low",
        message: `Not modified in ${staleDays} days`
      });
    }
    if (file.path.includes("docs/") || file.path.endsWith(".md")) {
      gaps.push({
        file: file.path,
        type: "documentation_coverage",
        priority: "medium",
        message: "Documentation file — verify coverage against implementation"
      });
    }
  }

  return { gaps };
}

function aggregateGaps(gaps: Array<Record<string, unknown>>): {
  total: number;
  high: number;
  medium: number;
  low: number;
} {
  let high = 0;
  let medium = 0;
  let low = 0;
  for (const gap of gaps) {
    const priority = String(gap.priority ?? "low");
    if (priority === "high") {
      high += 1;
    } else if (priority === "medium") {
      medium += 1;
    } else {
      low += 1;
    }
  }
  return { total: gaps.length, high, medium, low };
}

function normalizeRepoIds(params: Record<string, unknown>): string[] {
  if (Array.isArray(params.repoIds)) {
    return params.repoIds.map(String);
  }
  if (params.repoId) {
    return [String(params.repoId)];
  }
  return [];
}

async function resolveDependencyEdges(
  orgId: string | undefined,
  repoId: string,
  filePaths: string[],
  preserved: Array<{ from: string; to: string; type: "import" | "reference" }>
): Promise<Array<{ from: string; to: string; type: "import" | "reference" }>> {
  const pathSet = new Set(filePaths);
  if (orgId) {
    const pool = await getDbPool();
    if (pool) {
      const store = new RepoSymbolIndexStore(pool);
      const symbolCount = await store.countSymbols(orgId, repoId);
      if (symbolCount > 0) {
        const symbolEdges = await store.loadDependencyEdges(orgId, repoId);
        return dedupeEdges([
          ...preserved,
          ...symbolEdges.filter((edge) => pathSet.has(edge.from) && pathSet.has(edge.to))
        ]);
      }
    }
  }

  const inferred = inferDependenciesFromPaths(filePaths);
  return dedupeEdges([...preserved, ...inferred]);
}

function inferDependenciesFromPaths(paths: string[]): Array<{ from: string; to: string; type: "import" }> {
  const edges: Array<{ from: string; to: string; type: "import" }> = [];
  const index = new Set(paths);
  for (const from of paths) {
    const base = from.replace(/\.[^.]+$/, "");
    for (const to of paths) {
      if (from === to) {
        continue;
      }
      if (to.startsWith(base) || from.includes(to.replace(/\.[^.]+$/, ""))) {
        if (index.has(to)) {
          edges.push({ from, to, type: "import" });
        }
      }
    }
  }
  return edges.slice(0, 500);
}

function dedupeEdges<T extends { from: string; to: string }>(edges: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const edge of edges) {
    const key = `${edge.from}->${edge.to}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(edge);
  }
  return result;
}

function daysSince(date: Date): number {
  return Math.floor((Date.now() - date.getTime()) / 86_400_000);
}
