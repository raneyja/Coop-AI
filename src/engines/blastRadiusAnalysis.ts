import { toRepositoryRelativePath } from "../context/repoFilePath";
import type { CodeHostRouter } from "../api/codeHosts/codeHostRouter";
import type { ResolvedIntegrationScope } from "../integrationScope/types";
import type { CodeHostProvider, RepoCoordinates } from "../api/codeHosts/types";
import { repoIdFromCoordinates } from "../api/codeHosts/types";
import { parseCodeowners } from "../api/codeHosts/ownershipAnalysis";
import type { IntegrationSecrets } from "../api/integrations/integrationSecrets";
import type { CodeHostPullRequestSnippet } from "../context/codeHostContext";
import type { IndexBackend } from "../indexing/indexBackend";
import {
  type BlastRadiusDependentDetail,
  type GraphEdgeSource,
  codePathsFromDependentDetails,
  normalizeGraphRepoId,
  searchDependentsFallback,
  splitBlastRadiusDependents
} from "./blastRadiusDependentsFallback";

export type { BlastRadiusDependentDetail, GraphEdgeSource };

const CODEOWNERS_CANDIDATES = [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"];
/** Expand at most this many direct edges for one parallel transitive hop. */
const TRANSITIVE_EXPAND_LIMIT = 5;
/** Cap transitive paths returned on the hot path. */
const TRANSITIVE_RESULT_LIMIT = 15;
/** CODEOWNERS lookup for target + a few top dependents only. */
const OWNER_PATH_LIMIT = 6;

export type BlastRadiusOwnerEntry = {
  file: string;
  owner: string;
  source: "codeowners" | "commits" | "unknown";
};

export type BlastRadiusTestFile = {
  path: string;
  source: GraphEdgeSource;
};

export type BlastRadiusPublicExport = {
  symbol: string;
  kind: string;
  line: number;
};

export type BlastRadiusRecentChange = {
  number: number;
  title: string;
  state: string;
  author?: string;
  updatedAt: string;
  htmlUrl?: string;
  kind: "pull_request" | "commit";
};

export type BlastRadiusCiWorkflow = {
  path: string;
  matchedPath: string;
};

export type BlastRadiusCrossRepoConsumer = {
  repoId: string;
  path: string;
  source: GraphEdgeSource;
};

export type BlastRadiusReport = {
  file: string;
  directDependents: string[];
  transitiveDependents: string[];
  dependentDetails: BlastRadiusDependentDetail[];
  docsReferences: BlastRadiusDependentDetail[];
  openPullRequests: CodeHostPullRequestSnippet[];
  recentChanges: BlastRadiusRecentChange[];
  testFiles: BlastRadiusTestFile[];
  publicExports: BlastRadiusPublicExport[];
  ciWorkflows: BlastRadiusCiWorkflow[];
  crossRepoConsumers: BlastRadiusCrossRepoConsumer[];
  ownersByFile: BlastRadiusOwnerEntry[];
  slackSearch?: {
    query: string;
    messages: Array<{ channelName?: string; userName?: string; text: string; permalink?: string }>;
    error?: string;
  };
  graphMeta?: {
    edgeCount?: number;
    lastIndexedAt?: string;
    source?: GraphEdgeSource;
    lightningEnabled?: boolean;
  };
  includeTransitive: boolean;
  warnings: string[];
  completeness: "full" | "partial" | "minimal";
};

export type BlastRadiusAnalysisOptions = {
  codeHostRouter: CodeHostRouter;
  integrationSecrets: IntegrationSecrets;
  indexBackend?: IndexBackend;
  resolveSlackScope?: () => Promise<ResolvedIntegrationScope | undefined>;
};

export type BlastRadiusAnalysisParams = {
  provider?: CodeHostProvider;
  owner: string;
  repo: string;
  file: string;
  branch?: string;
  includeTransitive?: boolean;
};

export class BlastRadiusAnalysisEngine {
  public constructor(private readonly options: BlastRadiusAnalysisOptions) {}

  public async analyzeImpact(params: BlastRadiusAnalysisParams): Promise<BlastRadiusReport> {
    const file = toRepositoryRelativePath(params.file);
    const warnings: string[] = [];
    const coords: RepoCoordinates = {
      provider: params.provider ?? "github",
      owner: params.owner,
      repo: params.repo,
      branch: params.branch
    };

    let resolved = coords;
    try {
      resolved = await this.options.codeHostRouter.resolveCoordinates(coords);
    } catch (error) {
      warnings.push(`Could not resolve repository: ${errorMessage(error)}`);
    }

    const repoId = normalizeGraphRepoId(repoIdFromCoordinates(resolved));
    const includeTransitive = params.includeTransitive !== false;

    let directDependents: string[] = [];
    let transitiveDependents: string[] = [];
    let dependentDetails: BlastRadiusDependentDetail[] = [];
    let graphMeta: BlastRadiusReport["graphMeta"];
    let lightningEnabled = false;

    if (this.options.indexBackend) {
      try {
        lightningEnabled = await this.options.indexBackend.isEnabledForRepo(repoId);
        graphMeta = { source: "remote", lightningEnabled };

        if (lightningEnabled) {
          const result = await this.options.indexBackend.dependents(repoId, file);
          directDependents = uniquePaths(result.dependents);
          graphMeta = { ...graphMeta, source: result.source as GraphEdgeSource };
          dependentDetails = directDependents.map((path) => ({
            path,
            depth: 1,
            source: result.source as GraphEdgeSource
          }));

          if (includeTransitive && directDependents.length > 0) {
            const transitive = await this.collectTransitiveDependents(repoId, file, directDependents);
            transitiveDependents = transitive.paths;
            dependentDetails = [...dependentDetails, ...transitive.details];
          }

          if (directDependents.length === 0) {
            const fallback = await searchDependentsFallback(this.options.indexBackend, repoId, file);
            warnings.push(...fallback.warnings);
            if (fallback.dependents.length > 0) {
              directDependents = fallback.dependents.map((entry) => entry.path);
              dependentDetails = fallback.dependents;
              graphMeta = { ...graphMeta, source: fallback.source };
              warnings.push(
                `Dependents inferred via ${fallback.source} import-pattern search — verify before relying on impact list.`
              );
              if (includeTransitive && directDependents.length > 0) {
                const transitive = await this.collectTransitiveDependents(repoId, file, directDependents);
                transitiveDependents = transitive.paths;
                dependentDetails = [...dependentDetails, ...transitive.details];
              }
            } else {
              warnings.push("No dependents found in index or import-pattern search for this file.");
            }
          }
        } else {
          warnings.push("Deep index not enabled — run Lightning Mode to map dependents.");
        }
      } catch (error) {
        warnings.push(`Dependency graph unavailable: ${errorMessage(error)}`);
      }
    } else {
      warnings.push("Index backend unavailable — showing PR and ownership signals only.");
    }

    const impactedFiles = uniquePaths([file, ...directDependents, ...transitiveDependents]).slice(0, 30);
    // CODEOWNERS only — never mapOwnership (commit/PR history per file) on this hot path.
    const ownersByFile = await this.resolveOwnersFromCodeowners(resolved, impactedFiles, warnings);

    // Open PRs / CI / cross-repo / export scans are deferred off the critical path.
    // Dependents + CODEOWNERS are enough to start synthesis in seconds, not minutes.
    const openPullRequests: CodeHostPullRequestSnippet[] = [];
    const recentChanges: BlastRadiusRecentChange[] = [];
    const publicExports: BlastRadiusPublicExport[] = [];
    const ciWorkflows: BlastRadiusCiWorkflow[] = [];
    const crossRepoConsumers: BlastRadiusCrossRepoConsumer[] = [];
    const slackSearch: BlastRadiusReport["slackSearch"] = undefined;

    const completeness = assessCompleteness(directDependents, openPullRequests, slackSearch, warnings);

    const split = splitBlastRadiusDependents(dependentDetails);
    const codePaths = codePathsFromDependentDetails(split.codeDependentDetails);
    directDependents = codePaths.directDependents;
    transitiveDependents = codePaths.transitiveDependents;
    dependentDetails = split.codeDependentDetails;
    const docsReferences = split.docsReferences;
    const testFiles = testFilesFromDependentDetails(dependentDetails);

    return {
      file,
      directDependents,
      transitiveDependents,
      dependentDetails,
      docsReferences,
      openPullRequests,
      recentChanges,
      testFiles,
      publicExports,
      ciWorkflows,
      crossRepoConsumers,
      ownersByFile,
      slackSearch,
      graphMeta,
      includeTransitive,
      warnings,
      completeness
    };
  }

  /**
   * One parallel hop from the top direct dependents — no serial BFS of 50 nodes.
   * Keeps SCIP depth-2 signals (tests) without multi-minute fan-out.
   */
  private async collectTransitiveDependents(
    repoId: string,
    rootFile: string,
    direct: string[]
  ): Promise<{ paths: string[]; details: BlastRadiusDependentDetail[] }> {
    const seen = new Set<string>([rootFile, ...direct]);
    const toExpand = direct.slice(0, TRANSITIVE_EXPAND_LIMIT);
    const results = await Promise.all(
      toExpand.map(async (path) => {
        try {
          return await this.options.indexBackend!.dependents(repoId, path);
        } catch {
          return { dependents: [] as string[], source: "heuristic" as GraphEdgeSource };
        }
      })
    );

    const transitive: string[] = [];
    const details: BlastRadiusDependentDetail[] = [];
    for (const result of results) {
      for (const dep of result.dependents) {
        if (seen.has(dep) || transitive.length >= TRANSITIVE_RESULT_LIMIT) {
          continue;
        }
        seen.add(dep);
        transitive.push(dep);
        details.push({
          path: dep,
          depth: 2,
          source: result.source as GraphEdgeSource
        });
      }
    }

    return { paths: transitive, details };
  }

  /** Single CODEOWNERS file read + parse — no per-file commit history. */
  private async resolveOwnersFromCodeowners(
    coords: RepoCoordinates,
    files: string[],
    warnings: string[]
  ): Promise<BlastRadiusOwnerEntry[]> {
    let content: string | undefined;
    for (const candidate of CODEOWNERS_CANDIDATES) {
      try {
        const file = await this.options.codeHostRouter.getFileContent(candidate, coords);
        content = file.content;
        break;
      } catch {
        /* try next path */
      }
    }

    if (!content) {
      warnings.push("No CODEOWNERS file found — owner notify list omitted.");
      return [];
    }

    const owners: BlastRadiusOwnerEntry[] = [];
    for (const path of files.slice(0, OWNER_PATH_LIMIT)) {
      const match = parseCodeowners(content, path);
      const owner = match?.owners[0];
      if (owner) {
        owners.push({ file: path, owner, source: "codeowners" });
      }
    }
    return owners;
  }
}

export function createBlastRadiusAnalysisEngine(
  options: BlastRadiusAnalysisOptions
): BlastRadiusAnalysisEngine {
  return new BlastRadiusAnalysisEngine(options);
}

function assessCompleteness(
  directDependents: string[],
  openPullRequests: CodeHostPullRequestSnippet[],
  slackSearch: BlastRadiusReport["slackSearch"] | undefined,
  warnings: string[]
): BlastRadiusReport["completeness"] {
  if (directDependents.length > 0 && (openPullRequests.length > 0 || (slackSearch?.messages.length ?? 0) > 0)) {
    return "full";
  }
  if (directDependents.length > 0 || openPullRequests.length > 0 || (slackSearch?.messages.length ?? 0) > 0) {
    return "partial";
  }
  return warnings.length <= 1 ? "partial" : "minimal";
}

function testFilesFromDependentDetails(details: BlastRadiusDependentDetail[]): BlastRadiusTestFile[] {
  return details
    .filter((entry) => isTestPath(entry.path))
    .slice(0, 10)
    .map((entry) => ({ path: entry.path, source: entry.source }));
}

function isTestPath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  return (
    /\.(test|spec)\.[a-z0-9]+$/i.test(normalized) ||
    /(^|\/)__tests__\//i.test(normalized) ||
    /(^|\/)tests?\//i.test(normalized)
  );
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths.filter(Boolean))];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
