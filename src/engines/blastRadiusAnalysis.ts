import { toRepositoryRelativePath } from "../context/repoFilePath";
import type { CodeHostRouter } from "../api/codeHosts/codeHostRouter";
import type { ResolvedIntegrationScope } from "../integrationScope/types";
import type { CodeHostProvider, RepoCoordinates } from "../api/codeHosts/types";
import { repoIdFromCoordinates } from "../api/codeHosts/types";
import type { IntegrationSecrets } from "../api/integrations/integrationSecrets";
import { remainingContextGatherBudgetMs } from "../config/responseDeadline";
import { buildRepoSearchQuery, fetchSlackSearchContext } from "../context/slackContext";
import { fetchCodeHostSearchContext, type CodeHostPullRequestSnippet } from "../context/codeHostContext";
import { getOwnershipGraphEngine } from "./ownershipGraphRegistry";
import type { IndexBackend } from "../indexing/indexBackend";
import {
  type BlastRadiusDependentDetail,
  type GraphEdgeSource,
  codePathsFromDependentDetails,
  normalizeGraphRepoId,
  searchCiWorkflowReferences,
  searchCrossRepoConsumers,
  searchDependentsFallback,
  searchPublicExports,
  searchTestFilesReferencingTarget,
  sortDependentsProductionFirst,
  splitBlastRadiusDependents
} from "./blastRadiusDependentsFallback";

export type { BlastRadiusDependentDetail, GraphEdgeSource };

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
  /**
   * Turn clock for soft gather (responseDeadline.ts). When remaining soft budget
   * hits 0, skip secondary enrichment and return partial evidence for synthesis —
   * never hang, never schedule a hard 15s abort / timeout bubble.
   */
  gatherStartedAt?: number;
};

export class BlastRadiusAnalysisEngine {
  public constructor(private readonly options: BlastRadiusAnalysisOptions) {}

  public async analyzeImpact(params: BlastRadiusAnalysisParams): Promise<BlastRadiusReport> {
    const file = toRepositoryRelativePath(params.file);
    const warnings: string[] = [];
    // Soft gather only — remainingContextGatherBudgetMs from responseDeadline.ts.
    const gatherStartedAt = params.gatherStartedAt ?? Date.now();
    const softBudgetLeft = (): number => remainingContextGatherBudgetMs(gatherStartedAt);
    const softBudgetExhausted = (): boolean => softBudgetLeft() <= 0;
    // Soft gather is silent to users — do not push latency jargon into warnings
    // (those surface in evidence cards / synthesis). completeness already reflects partial.

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

          if (includeTransitive && directDependents.length > 0 && !softBudgetExhausted()) {
            const transitive = await this.collectTransitiveDependents(
              repoId,
              file,
              directDependents,
              gatherStartedAt
            );
            transitiveDependents = transitive.paths;
            dependentDetails = [...dependentDetails, ...transitive.details];
          }

          if (directDependents.length === 0 && !softBudgetExhausted()) {
            const fallback = await searchDependentsFallback(this.options.indexBackend, repoId, file);
            warnings.push(...fallback.warnings);
            if (fallback.dependents.length > 0) {
              directDependents = fallback.dependents.map((entry) => entry.path);
              dependentDetails = fallback.dependents;
              graphMeta = { ...graphMeta, source: fallback.source };
              warnings.push(
                `Dependents inferred via ${fallback.source} import-pattern search — verify before relying on impact list.`
              );
              if (includeTransitive && directDependents.length > 0 && !softBudgetExhausted()) {
                const transitive = await this.collectTransitiveDependents(
                  repoId,
                  file,
                  directDependents,
                  gatherStartedAt
                );
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

    let ownersByFile: BlastRadiusOwnerEntry[] = [];
    let openPullRequests: CodeHostPullRequestSnippet[] = [];
    let recentChanges: BlastRadiusRecentChange[] = [];
    let testFiles: BlastRadiusTestFile[] = [];
    let publicExports: BlastRadiusPublicExport[] = [];
    let ciWorkflows: BlastRadiusCiWorkflow[] = [];
    let crossRepoConsumers: BlastRadiusCrossRepoConsumer[] = [];
    let slackSearch: BlastRadiusReport["slackSearch"];

    // Secondary enrichment — skip when soft gather budget is gone so synthesis can start.
    if (!softBudgetExhausted()) {
      ownersByFile = await this.resolveOwners(resolved, impactedFiles, warnings, gatherStartedAt);

      if (!softBudgetExhausted()) {
        try {
          const impactedTerms = [file, ...directDependents.slice(0, 5)].join(" ");
          const search = await fetchCodeHostSearchContext({
            router: this.options.codeHostRouter,
            provider: resolved.provider,
            owner: resolved.owner,
            repo: resolved.repo,
            queryText: `open pull requests ${impactedTerms}`,
            limit: 30
          });
          if (search.error) {
            warnings.push(search.error);
          } else {
            openPullRequests = search.pullRequests.filter((pr) => pr.state === "open" || !pr.merged);
            recentChanges = filterRecentChangesForImpact(search.pullRequests, file, directDependents);
          }
        } catch (error) {
          warnings.push(`Open PR search failed: ${errorMessage(error)}`);
        }
      }

      if (this.options.indexBackend && lightningEnabled && !softBudgetExhausted()) {
        testFiles = await searchTestFilesReferencingTarget(this.options.indexBackend, repoId, file);
        if (!softBudgetExhausted()) {
          publicExports = await searchPublicExports(this.options.indexBackend, repoId, file);
        }
        if (!softBudgetExhausted()) {
          ciWorkflows = await searchCiWorkflowReferences(this.options.indexBackend, repoId, impactedFiles);
        }
        if (!softBudgetExhausted()) {
          crossRepoConsumers = await searchCrossRepoConsumers(this.options.indexBackend, repoId, file);
        }
      }

      if (!softBudgetExhausted()) {
        try {
          const fileStem = file.split("/").pop()?.replace(/\.[^.]+$/, "") ?? file;
          const repoQuery = buildRepoSearchQuery(resolved.owner, resolved.repo);
          const query = [
            repoQuery,
            fileStem,
            ...directDependents.slice(0, 3).map((dep) => dep.split("/").pop() ?? dep)
          ]
            .filter(Boolean)
            .join(" OR ");
          const slackScope = await this.options.resolveSlackScope?.();
          const slack = await fetchSlackSearchContext({
            secrets: this.options.integrationSecrets,
            owner: resolved.owner,
            repo: resolved.repo,
            queryText: query,
            integrationScope: slackScope
          });
          slackSearch = {
            query: slack.query,
            messages: slack.messages.slice(0, 15).map((message) => ({
              channelName: message.channelName,
              userName: message.userName,
              text: message.text,
              permalink: message.permalink
            })),
            error: slack.error
          };
          if (slack.error) {
            warnings.push(slack.error);
          }
        } catch (error) {
          warnings.push(`Slack search unavailable: ${errorMessage(error)}`);
        }
      }
    }
    // else: soft gather silent — skip secondary enrichment; return core evidence only.

    const completeness = assessCompleteness(directDependents, openPullRequests, slackSearch, warnings);

    const split = splitBlastRadiusDependents(dependentDetails);
    const rankedCode = sortDependentsProductionFirst(split.codeDependentDetails);
    const codePaths = codePathsFromDependentDetails(rankedCode);
    directDependents = codePaths.directDependents;
    transitiveDependents = codePaths.transitiveDependents;
    dependentDetails = rankedCode;
    const docsReferences = split.docsReferences;

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

  private async collectTransitiveDependents(
    repoId: string,
    rootFile: string,
    direct: string[],
    gatherStartedAt?: number
  ): Promise<{ paths: string[]; details: BlastRadiusDependentDetail[] }> {
    const seen = new Set<string>([rootFile, ...direct]);
    const queue = direct.map((path) => ({ path, depth: 1 }));
    const transitive: string[] = [];
    const details: BlastRadiusDependentDetail[] = [];

    while (queue.length > 0 && transitive.length < 50) {
      // Soft gather (responseDeadline): stop expanding when remaining budget is gone.
      if (
        gatherStartedAt !== undefined &&
        remainingContextGatherBudgetMs(gatherStartedAt) <= 0
      ) {
        break;
      }
      const current = queue.shift()!;
      try {
        const result = await this.options.indexBackend!.dependents(repoId, current.path);
        for (const dep of result.dependents) {
          if (!seen.has(dep)) {
            seen.add(dep);
            transitive.push(dep);
            const detail = {
              path: dep,
              depth: current.depth + 1,
              source: result.source as GraphEdgeSource
            };
            details.push(detail);
            queue.push({ path: dep, depth: current.depth + 1 });
          }
        }
      } catch {
        break;
      }
    }

    return { paths: transitive, details };
  }

  private async resolveOwners(
    coords: RepoCoordinates,
    files: string[],
    warnings: string[],
    gatherStartedAt?: number
  ): Promise<BlastRadiusOwnerEntry[]> {
    const engine = getOwnershipGraphEngine();
    if (!engine) {
      warnings.push("Ownership engine unavailable for dependent owners.");
      return [];
    }

    const owners: BlastRadiusOwnerEntry[] = [];
    for (const path of files.slice(0, 20)) {
      if (
        gatherStartedAt !== undefined &&
        remainingContextGatherBudgetMs(gatherStartedAt) <= 0
      ) {
        break;
      }
      try {
        const report = await engine.mapOwnership({
          provider: coords.provider,
          owner: coords.owner,
          repo: coords.repo,
          path,
          branch: coords.branch
        });
        const primary = report.scores.find((score) => score.tier === "primary") ?? report.scores[0];
        if (primary) {
          owners.push({
            file: path,
            owner: primary.owner,
            source: report.orgContext?.source === "codeowners" ? "codeowners" : "commits"
          });
        }
      } catch {
        /* skip individual file owner failures */
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

function filterRecentChangesForImpact(
  pullRequests: CodeHostPullRequestSnippet[],
  file: string,
  directDependents: string[]
): BlastRadiusRecentChange[] {
  const needles = [file, ...directDependents.slice(0, 10)].map((entry) => entry.toLowerCase());
  return pullRequests
    .filter((pr) => {
      const haystack = `${pr.title} ${pr.number}`.toLowerCase();
      return needles.some((needle) => haystack.includes(needle.split("/").pop() ?? needle));
    })
    .slice(0, 10)
    .map((pr) => ({
      number: pr.number,
      title: pr.title,
      state: pr.state,
      author: pr.author,
      updatedAt: pr.updatedAt,
      htmlUrl: pr.htmlUrl,
      kind: "pull_request" as const
    }));
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

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths.filter(Boolean))];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
