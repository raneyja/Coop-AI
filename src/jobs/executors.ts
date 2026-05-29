import type { GraphCache } from "../cache/graphCache";
import type { GraphConsistencyManager } from "../cache/graphConsistency";
import { JobType, type Job } from "./types";
import { buildPartialFailure } from "./errorHandling";

export type JobExecutionContext = {
  cache: GraphCache;
  consistency?: GraphConsistencyManager;
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
  if (!repoId) {
    throw new Error("Invalid parameters: repoId is required");
  }
  await report(20, "Loading repository graph");
  if (signal.aborted) {
    throw new Error("Job cancelled");
  }

  let graph = ctx.cache.getGraph(repoId);
  if (!graph) {
    const parts = repoId.split(":");
    const slug = parts.length > 1 ? parts[1] : repoId;
    const [owner, repo] = slug.split("/");
    graph = ctx.cache.upsertRepository({
      repoId,
      owner: owner ?? "unknown",
      repo: repo ?? slug,
      provider: parts[0] === "gitlab" ? "gitlab" : "github"
    });
  }

  await report(50, "Rebuilding dependency edges");
  const filePaths = new Set(graph.fileTree.map((f) => f.path));
  const edges = graph.dependencies.filter((edge) => filePaths.has(edge.from) && filePaths.has(edge.to));
  const inferred = inferDependenciesFromPaths(graph.fileTree.map((f) => f.path));
  const merged = dedupeEdges([...edges, ...inferred]);
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
  await report(30, "Refreshing repository index");
  const graph = ctx.cache.getGraph(repoId);
  if (!graph) {
    throw new Error(`404: Repository graph not found for ${repoId}`);
  }
  graph.metadata.lastIndexedAt = new Date();
  graph.metadata.indexVersion += 1;
  ctx.cache.setGraph(graph);
  return {
    repoId,
    fileCount: graph.fileTree.length,
    indexVersion: graph.metadata.indexVersion,
    lastIndexedAt: graph.metadata.lastIndexedAt.toISOString()
  };
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
  const parts = repoId.split(":");
  const slug = parts.length > 1 ? parts[1] : repoId;
  const [owner, repo] = slug.split("/");
  ctx.cache.upsertRepository({
    repoId,
    owner: String(params.owner ?? owner ?? "unknown"),
    repo: String(params.repo ?? repo ?? slug),
    provider: parts[0] === "gitlab" ? "gitlab" : "github"
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
