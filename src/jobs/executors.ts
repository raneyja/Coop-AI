import type { DependencyEdge, GraphCache } from "../cache/graphCache";
import type { GraphConsistencyManager } from "../cache/graphConsistency";
import { chunkAndEmbed } from "../indexing/chunkAndEmbed";
import { RepoSymbolIndexStore } from "../indexing/repoSymbolIndexStore";
import {
  RepoDependencyEdgesStore,
  type RepoDependencyEdgeRow
} from "../indexing/repoDependencyEdgesStore";
import { extractImportEdges } from "../indexing/importGraphExtractor";
import { resolveCodeHostTokenForOrg } from "../server/codeHostCredentialResolver";
import { getConnector } from "../server/codeHostConnectors/registry";
import type { CodeHostProvider } from "../api/codeHosts/types";
import { getDbPool } from "../server/db";
import type { GitHubAppService } from "../server/githubAppService";
import { cloneRepository, parseRepoId, removeRepositoryClone } from "../server/gitCloneService";
import { canUseLightningPlan, type OrgStore } from "../server/orgStore";
import { JobType, type Job } from "./types";
import { detectRepoKnowledgeGaps } from "./knowledgeGapDetector";
import type { KnowledgeGapScanCoverage } from "../context/knowledgeGapScanCoverage";
import { RepoManifestStore } from "../manifest/repoManifestStore";
import {
  hydrateKnowledgeGapGraphSlice,
  knowledgeGapRepoIdCandidates,
  type KnowledgeGapGraphSlice
} from "./hydrateKnowledgeGapGraph";
import { buildPartialFailure, JobCancelledError, normalizeJobError } from "./errorHandling";
import { buildStructureManifest } from "./buildStructureManifest";
import { runScipIndexer } from "./runScipIndexer";
import { runZoektIndexer } from "./runZoektIndexer";
import { collectRepoStats } from "../workspace/collectRepoStats";
import { RepoStatsStore } from "../workspace/repoStatsStore";
import { verifyRepoBrowse } from "../indexing/verifyRepoBrowse";

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
  let scanCoverage: KnowledgeGapScanCoverage = "no_structured_gaps";
  let scannedFileCount = 0;

  for (let i = 0; i < repoIds.length; i += 1) {
    if (signal.aborted) {
      throw new Error("Job cancelled");
    }
    const repoId = repoIds[i];
    const progress = 15 + Math.round((i / repoIds.length) * 70);
    await report(progress, `Scanning ${repoId}`);

    try {
      // Never upsert an empty graph shell — that can persist over a durable snapshot.
      const slice = await loadKnowledgeGapScanSlice(ctx, repoId, job.params);
      const scan = scanRepoKnowledgeGaps(slice, job.params);
      gaps.push(...scan.gaps);
      scannedFileCount += scan.scannedFileCount;
      if (scan.scanCoverage === "gaps_found") {
        scanCoverage = "gaps_found";
      } else if (scanCoverage !== "gaps_found" && scan.scanCoverage === "scan_incomplete") {
        scanCoverage = "scan_incomplete";
      }
      completedRepos.push(repoId);
    } catch (error) {
      failedRepos.push(repoId);
      if (repoIds.length === 1) {
        throw error;
      }
    }
  }

  await report(95, "Summarizing scan results");
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
        gaps: gaps.slice(0, 200),
        scanCoverage,
        scannedFileCount
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
    scanCoverage,
    scannedRepos: completedRepos,
    scannedFileCount
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

  await report(50, "Loading durable dependency edges");
  const filePaths = new Set(graph.fileTree.map((f) => f.path));
  const merged = await loadDurableDependencyEdges(orgId, repoId, filePaths);
  const updated = ctx.cache.setDependencies(repoId, merged);
  graph = updated ?? graph;

  await report(85, "Building transitive index");
  const nodeCount = graph.fileTree.length;
  const edgeCount = graph.dependencies.length;

  return {
    repoId,
    nodeCount,
    edgeCount,
    // Sample only — never treat as file-specific dependents without filtering by `to`.
    dependentsSample: graph.dependencies.slice(0, 10),
    lastIndexedAt: graph.metadata.lastIndexedAt.toISOString(),
    indexVersion: graph.metadata.indexVersion,
    edgeSource: "durable"
  };
}

async function indexRepository(
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

  if (orgId && ctx.orgStore) {
    await ctx.orgStore.upsertOrgRepo(orgId, repoId, {
      indexStatus: "indexing",
      error: undefined,
      embeddingStatus: "pending",
      embeddingError: undefined,
      browseStatus: "pending",
      browseError: undefined,
      browseVerifiedAt: undefined
    });
  }

  await report(15, "Preparing repository clone");
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
    if (orgId && ctx.orgStore && !token) {
      throw new Error(
        `Cannot clone repository: no ${provider} installation token. ` +
          `Ensure the org has ${provider} connected and coop-worker has CREDENTIALS_ENCRYPTION_KEY ` +
          `(same value as Coop-AI), plus the matching ${provider} app credentials, then Reindex.`
      );
    }
    await report(30, "Cloning repository");
    const target = parseRepoId(repoId);
    const clone = await cloneRepository(target, token);
    cloneLocalPath = clone.localPath;

    let scipResult: Awaited<ReturnType<typeof runScipIndexer>> | undefined;
    let embedResult: Awaited<ReturnType<typeof chunkAndEmbed>> | undefined;
    let zoektResult: Awaited<ReturnType<typeof runZoektIndexer>> | undefined;
    let embeddingStatus: "complete" | "failed" | "skipped" = "skipped";
    let embeddingError: string | undefined;
    if (orgId) {
      const pool = await getDbPool();
      if (pool) {
        await report(42, "Running SCIP symbol indexing");
        scipResult = await runScipIndexer(repoId, orgId, undefined, clone.localPath, pool);

        await report(55, "Building Zoekt full-text index");
        zoektResult = await runZoektIndexer(repoId, orgId, clone.localPath);

        let shouldEmbed = false;
        if (ctx.orgStore) {
          const org = await ctx.orgStore.getOrganization(orgId);
          shouldEmbed = Boolean(org && canUseLightningPlan(org.plan));
        }
        if (shouldEmbed) {
          await report(65, "Embedding files without symbol coverage");
          try {
            embedResult = await chunkAndEmbed(repoId, orgId, clone.localPath, pool, {
              signal,
              onProgress: async (fraction) => {
                // Wide band (65–85) so large repos don't look stuck at 77–79.
                await report(65 + Math.round(fraction * 20), "Embedding files without symbol coverage");
              }
            });
            embeddingStatus = "complete";
          } catch (error) {
            if (error instanceof JobCancelledError) {
              throw error;
            }
            embeddingStatus = "failed";
            embeddingError = error instanceof Error ? error.message : String(error);
            await report(82, "Embeddings failed — symbols and full-text search remain available");
          }
        }
      }
    }

    await report(86, "Building file index");

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

    // Import graph while clone still exists — durable edges, no filename heuristics.
    // Zoekt is often unavailable in prod; Blast dependents depend on these rows.
    await report(87, "Extracting import graph");
    const filePathSet = new Set(graph.fileTree.map((file) => file.path));
    const importEdges = extractImportEdges(clone.localPath);
    const edgeRows: RepoDependencyEdgeRow[] = importEdges
      .filter((edge) => filePathSet.has(edge.from) && filePathSet.has(edge.to))
      .map((edge) => ({
        fromPath: edge.from,
        toPath: edge.to,
        kind: edge.kind,
        symbol: edge.symbol,
        line: edge.line,
        source: "import-parse" as const
      }));
    const filteredOut = importEdges.length - edgeRows.length;
    console.log(
      `[index] import-graph repo=${repoId} extracted=${importEdges.length} ` +
        `inFileTree=${edgeRows.length} filteredOut=${filteredOut} clone=${clone.localPath}`
    );

    if (orgId) {
      const pool = await getDbPool();
      if (pool) {
        try {
          const symbolStore = new RepoSymbolIndexStore(pool);
          const symbolEdges = await symbolStore.loadDependencyEdges(orgId, repoId);
          for (const edge of symbolEdges) {
            if (!filePathSet.has(edge.from) || !filePathSet.has(edge.to)) {
              continue;
            }
            edgeRows.push({
              fromPath: edge.from,
              toPath: edge.to,
              kind: edge.type || "reference",
              source: "scip"
            });
          }
        } catch (error) {
          console.warn(
            `[index] SCIP edge merge skipped: ${error instanceof Error ? error.message : String(error)}`
          );
        }

        try {
          await new RepoDependencyEdgesStore(pool).replaceEdges(orgId, repoId, edgeRows, now);
          console.log(
            `[index] import-graph persisted repo=${repoId} edges=${edgeRows.length}`
          );
        } catch (error) {
          console.error(
            `[index] Failed to persist dependency edges for ${repoId}: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
          throw error;
        }
      } else {
        console.warn(`[index] import-graph skipped persist — no DB pool for ${repoId}`);
      }
    } else {
      console.warn(`[index] import-graph skipped persist — missing orgId for ${repoId}`);
    }

    const cacheEdges = dedupeEdges(
      edgeRows.map((edge) => ({
        from: edge.fromPath,
        to: edge.toPath,
        type: edge.kind === "reference" ? ("reference" as const) : ("import" as const)
      }))
    );
    ctx.cache.setDependencies(repoId, cacheEdges);

    // Measure the repo while the clone still exists — chat answers counts from
    // this record instead of estimating from a retrieval sample.
    await report(88, "Recording repository inventory");
    const repoStats = collectRepoStats(clone.localPath, clone.files);
    if (orgId) {
      const pool = await getDbPool();
      if (pool) {
        await new RepoStatsStore(pool).upsertStats(orgId, repoId, {
          branch: clone.branch ?? target.branch,
          fileCount: repoStats.fileCount,
          lineCount: repoStats.lineCount,
          byteCount: repoStats.byteCount,
          languages: repoStats.languages,
          headCommit: clone.headCommit,
          indexedAt: now
        });
      }
    }

    let browseStatus: "pending" | "verified" | "failed" = "pending";
    let browseError: string | undefined;
    let browseVerifiedAt: Date | undefined;
    let defaultBranch = clone.branch ?? target.branch;
    if (orgId && ctx.orgStore && token) {
      await report(92, "Verifying developers can browse the repo");
      const browse = await verifyRepoBrowse({
        repoId,
        token,
        preferredBranch: defaultBranch
      });
      browseStatus = browse.browseStatus;
      browseError = browse.browseError;
      browseVerifiedAt = browse.browseVerifiedAt;
      defaultBranch = browse.defaultBranch ?? defaultBranch;
    } else if (orgId && ctx.orgStore && !token) {
      browseStatus = "failed";
      browseError = "No code-host token available to verify browse access.";
      browseVerifiedAt = new Date();
    }

    if (orgId && ctx.orgStore) {
      await ctx.orgStore.upsertOrgRepo(orgId, repoId, {
        lightningEnabled: true,
        indexStatus: "ready",
        embeddingStatus,
        lastIndexedAt: now,
        lastJobId: job.id,
        error: undefined,
        embeddingError,
        browseStatus,
        browseError,
        browseVerifiedAt,
        defaultBranch
      });
    }

    await report(95, "Index ready");
    return {
      repoId,
      fileCount: graph.fileTree.length,
      lineCount: repoStats.lineCount,
      byteCount: repoStats.byteCount,
      languages: repoStats.languages,
      indexVersion: graph.metadata.indexVersion,
      lastIndexedAt: graph.metadata.lastIndexedAt.toISOString(),
      headCommit: clone.headCommit,
      scipAvailable: scipResult?.scipAvailable ?? false,
      symbolCount: scipResult?.symbolCount ?? 0,
      indexSource: scipResult?.source ?? "none",
      indexQuality: scipResult?.indexQuality ?? "none",
      language: scipResult?.language,
      zoektAvailable: zoektResult?.zoektAvailable ?? false,
      dependencyEdgeCount: edgeRows.length,
      embeddingCount: embedResult?.chunkCount ?? 0,
      embeddedFiles: embedResult?.embeddedFiles ?? 0,
      embeddingStatus,
      embeddingError,
      browseStatus,
      defaultBranch
    };
  } catch (error) {
    let message = normalizeJobError(error);
    if (/repository .* not found/i.test(message)) {
      const target = parseRepoId(repoId);
      message =
        `GitHub returned "repository not found" for ${target.owner}/${target.repo}. ` +
        "The connected GitHub App install may not include this repo " +
        "(for example, personal repos when Coop is linked to a company org). " +
        "Turn off Deep-Index for this repo, or install the app on the account that owns it.";
    }
    if (orgId && ctx.orgStore) {
      await ctx.orgStore.upsertOrgRepo(orgId, repoId, {
        indexStatus: "error",
        lastJobId: job.id,
        error: message,
        browseStatus: "failed",
        browseError: message,
        browseVerifiedAt: new Date()
      });
    }
    throw error instanceof Error ? new Error(message) : error;
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

async function loadKnowledgeGapScanSlice(
  ctx: JobExecutionContext,
  repoId: string,
  params: Record<string, unknown>
): Promise<KnowledgeGapGraphSlice | undefined> {
  const orgId = params.orgId ? String(params.orgId) : undefined;
  const memory = ctx.cache.getGraph(repoId);
  const candidateIds = knowledgeGapRepoIdCandidates(repoId, params);
  let manifestPaths: string[] = [];
  let durableEdges: DependencyEdge[] = [];
  if (orgId) {
    const pool = await getDbPool();
    if (pool) {
      const store = new RepoManifestStore(pool);
      for (const candidate of candidateIds) {
        const rows = await store.loadManifest(orgId, candidate);
        if (rows.length > 0) {
          manifestPaths = rows.map((row) => row.filePath);
          break;
        }
      }
      for (const candidate of candidateIds) {
        const edges = await loadDurableDependencyEdges(orgId, candidate, new Set(), {
          includeWhenTreeEmpty: true
        });
        if (edges.length > 0) {
          durableEdges = edges;
          break;
        }
      }
    }
  }
  return hydrateKnowledgeGapGraphSlice({
    fileTree: memory?.fileTree,
    memoryEdges: memory?.dependencies,
    manifestPaths,
    durableEdges,
    owners: memory?.owners
  });
}

function scanRepoKnowledgeGaps(
  graph: KnowledgeGapGraphSlice | undefined,
  params: Record<string, unknown>
): {
  gaps: Array<Record<string, unknown>>;
  scanCoverage: KnowledgeGapScanCoverage;
  scannedFileCount: number;
} {
  const file = params.file ? String(params.file) : undefined;
  const detected = detectRepoKnowledgeGaps(graph, { file });
  return {
    gaps: detected.gaps,
    scanCoverage: detected.scanCoverage,
    scannedFileCount: detected.scannedFileCount
  };
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

/**
 * Load durable edges from Postgres. Never invent filename-heuristic edges.
 * Empty means impact unverified — not "zero impact."
 */
async function loadDurableDependencyEdges(
  orgId: string | undefined,
  repoId: string,
  filePaths: Set<string>,
  options?: { includeWhenTreeEmpty?: boolean }
): Promise<DependencyEdge[]> {
  if (!orgId) {
    return [];
  }
  const pool = await getDbPool();
  if (!pool) {
    return [];
  }
  try {
    const store = new RepoDependencyEdgesStore(pool);
    const rows = await store.loadAllEdges(orgId, repoId);
    const mapped = rows.map((edge) => ({
      from: edge.fromPath,
      to: edge.toPath,
      type:
        edge.kind === "reference"
          ? ("reference" as const)
          : edge.kind === "require"
            ? ("require" as const)
            : ("import" as const)
    }));
    if (filePaths.size === 0) {
      return options?.includeWhenTreeEmpty ? dedupeEdges(mapped) : [];
    }
    return dedupeEdges(
      mapped.filter((edge) => filePaths.has(edge.from) && filePaths.has(edge.to))
    );
  } catch (error) {
    console.warn(
      `[deps] loadDurableDependencyEdges failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return [];
  }
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
