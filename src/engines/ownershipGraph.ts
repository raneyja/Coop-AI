import { toRepositoryRelativePath } from "../context/repoFilePath";
import type { GraphQueryApi } from "../api/graphQuery";
import { CodeHostSecrets } from "../api/codeHosts/codeHostSecrets";
import type { CodeHostRouter } from "../api/codeHosts/codeHostRouter";
import {
  analyzeCommitPatterns,
  analyzeReviewAuthority,
  buildActivityWindows,
  buildOrgContextFromCodeowners,
  buildOwnershipEvolution,
  buildTeamDomainGraph,
  calculateOwnershipScores,
  computeOwnershipRisk,
  draftOwnerMessage,
  fetchRepoTeams,
  issuesFromSummaries,
  parseCodeowners
} from "../api/codeHosts/ownershipAnalysis";
import type { CommitInfo, RepoCoordinates } from "../api/codeHosts/types";
import { repoIdFromCoordinates } from "../api/codeHosts/types";
import { IntegrationSecrets } from "../api/integrations/integrationSecrets";
import { SlackClient } from "../api/slack/slackClient";
import { enrichScoresWithPresence } from "../api/slack/presenceCheck";
import { getIdentityDirectory } from "../identity/identityDirectoryRegistry";
import type {
  MapOwnershipParams,
  OrgTeamContext,
  OwnershipCompleteness,
  OwnershipReport,
  OwnershipSignals
} from "../types/ownership";
import { getOwnershipGraphEngine } from "./ownershipGraphRegistry";

export type OwnershipGraphEngineOptions = {
  codeHostRouter: CodeHostRouter;
  codeHostSecrets: CodeHostSecrets;
  integrationSecrets: IntegrationSecrets;
  graphQuery?: GraphQueryApi;
  slackClient?: SlackClient;
};

const CODEOWNERS_PATHS = [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"];
const COMMIT_LIMIT = 500;

export class OwnershipGraphEngine {
  public constructor(private readonly options: OwnershipGraphEngineOptions) {}

  public async mapOwnership(params: MapOwnershipParams): Promise<OwnershipReport> {
    const path = toRepositoryRelativePath(params.path);
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
      warnings.push(`Could not resolve repository coordinates: ${errorMessage(error)}`);
    }

    const historyPath = params.isDirectory ? `${path}/` : path;
    let commits: CommitInfo[] = [];
    try {
      commits = params.isDirectory
        ? await this.options.codeHostRouter.getCommitHistory({
            ...resolved,
            path: historyPath.replace(/\/$/, "") || undefined,
            limit: COMMIT_LIMIT
          })
        : await this.options.codeHostRouter.getFileHistory(historyPath, COMMIT_LIMIT, resolved);
      if (commits.length >= COMMIT_LIMIT) {
        warnings.push(`Commit history truncated at ${COMMIT_LIMIT} commits.`);
      }
    } catch (error) {
      warnings.push(`Commit history unavailable: ${errorMessage(error)}`);
    }

    const commitStats = analyzeCommitPatterns(commits);
    let reviewInput: Array<{ author: string; state: string; submittedAt: string; prAuthor?: string }> = [];
    try {
      const prs = await this.options.codeHostRouter.getPRsForFile(path, 30, resolved);
      const reviewBatches = await Promise.all(
        prs.slice(0, 15).map(async (pr) => {
          const reviews = await this.options.codeHostRouter.getPullRequestReviews(pr.number, resolved);
          return reviews.map((r) => ({
            author: r.author,
            state: r.state,
            submittedAt: r.submittedAt,
            prAuthor: pr.author
          }));
        })
      );
      reviewInput = reviewBatches.flat();
    } catch (error) {
      warnings.push(`PR review data unavailable: ${errorMessage(error)}`);
    }
    const reviewStats = analyzeReviewAuthority(reviewInput);

    let issueStats = issuesFromSummaries([], path);
    try {
      const issues = await this.options.codeHostRouter.getIssuesForFile(path, resolved);
      issueStats = issuesFromSummaries(issues, path);
    } catch (error) {
      warnings.push(`Issue data unavailable: ${errorMessage(error)}`);
    }

    await this.mergeGraphCacheSignals(resolved, path, commitStats, warnings);

    const activity = buildActivityWindows(commitStats, reviewStats, issueStats);
    const signals: OwnershipSignals = {
      commits: commitStats,
      reviews: reviewStats,
      issues: issueStats,
      activity,
      specialties: []
    };

    const identityDirectory = await getIdentityDirectory().catch(() => undefined);
    let scores = calculateOwnershipScores(signals, undefined, undefined, { identityDirectory });
    if (scores.length === 0 && commitStats.length > 0) {
      warnings.push("All contributors appear inactive for 6+ months; showing historical owners with reduced confidence.");
      const fallbackActivity = commitStats.map((c) => ({
        author: c.author,
        lastActiveDate: c.lastCommitDate,
        weight: 1,
        inactive: false
      }));
      signals.activity = fallbackActivity;
      scores = calculateOwnershipScores(signals, undefined, undefined, { identityDirectory });
    }

    const slack = await this.resolveSlackClient();
    if (slack) {
      try {
        scores = await enrichScoresWithPresence(scores, slack, { identityDirectory });
      } catch (error) {
        warnings.push(`Slack presence lookup failed: ${errorMessage(error)}`);
      }
    } else {
      warnings.push("Slack not configured; availability status unavailable.");
    }

    const orgContext = await this.loadOrgContext(resolved, path, warnings);
    const teamGraph = buildTeamDomainGraph(scores, activity);
    if (orgContext && !scores.some((s) => orgContext.members.includes(s.owner))) {
      teamGraph.crossTeamNote = `This path is owned by ${orgContext.teamName}; your team may need to reach out cross-team.`;
    }

    const risk = computeOwnershipRisk(scores, commits, activity);
    const history = buildOwnershipEvolution(commits);
    const completeness = this.assessCompleteness(warnings, scores, commits);
    const latestCommit = commits[0];
    const pathEvolution =
      commits.length > 0
        ? {
            recentCommitCount: commits.length,
            lastModifiedAt: latestCommit?.date,
            lastModifiedAuthor: latestCommit?.authorLogin ? `@${latestCommit.authorLogin}` : latestCommit?.author
          }
        : undefined;

    const report: OwnershipReport = {
      path,
      owner: params.owner,
      repo: params.repo,
      scores,
      teamGraph,
      orgContext,
      risk,
      history,
      messageDraft: draftOwnerMessage(
        {
          path,
          owner: params.owner,
          repo: params.repo,
          scores,
          teamGraph,
          risk,
          history,
          messageDraft: { recipient: "", text: "" },
          warnings,
          completeness
        },
        { moduleName: path.split("/").pop() }
      ),
      warnings,
      completeness,
      signals,
      pathEvolution
    };

    report.messageDraft = draftOwnerMessage(report);
    return report;
  }

  private async mergeGraphCacheSignals(
    coords: RepoCoordinates,
    path: string,
    commitStats: ReturnType<typeof analyzeCommitPatterns>,
    warnings: string[]
  ): Promise<void> {
    if (!this.options.graphQuery) {
      return;
    }
    try {
      const repoId = repoIdFromCoordinates(coords);
      const cached = (await this.options.graphQuery.queryGraph({
        repoId,
        query: "getOwnership",
        filters: { file: path }
      })) as { primaryOwner?: string; secondaryOwners?: string[]; stale?: boolean } | undefined;
      if (!cached?.primaryOwner) {
        return;
      }
      const existing = commitStats.find((c) => c.author === cached.primaryOwner);
      if (existing) {
        existing.counts.allTime += 2;
        existing.recencyScore += 1;
      } else {
        commitStats.push({
          author: cached.primaryOwner,
          counts: { sixMonths: 1, oneYear: 2, allTime: 3 },
          recencyScore: 2,
          messages: []
        });
      }
      if (cached.stale) {
        warnings.push("Webhook graph ownership data may be stale.");
      }
    } catch {
      // Graph cache is optional.
    }
  }

  private async loadOrgContext(
    coords: RepoCoordinates,
    path: string,
    warnings: string[]
  ): Promise<OrgTeamContext | undefined> {
    let codeownersContent: string | undefined;
    for (const candidate of CODEOWNERS_PATHS) {
      try {
        const file = await this.options.codeHostRouter.getFileContent(candidate, coords);
        codeownersContent = file.content;
        break;
      } catch {
        // try next path
      }
    }

    if (!codeownersContent) {
      return undefined;
    }

    const match = parseCodeowners(codeownersContent, path);
    if (!match) {
      return undefined;
    }

    if (coords.provider !== "github") {
      return buildOrgContextFromCodeowners(match, []);
    }

    try {
      const creds = await this.options.codeHostSecrets.getCredentials();
      if (!creds.githubToken) {
        return buildOrgContextFromCodeowners(match, []);
      }
      const teams = await fetchRepoTeams(coords.owner, coords.repo, creds.githubToken);
      return buildOrgContextFromCodeowners(match, teams);
    } catch (error) {
      warnings.push(`GitHub team lookup unavailable: ${errorMessage(error)}`);
      return buildOrgContextFromCodeowners(match, []);
    }
  }

  private async resolveSlackClient(): Promise<SlackClient | undefined> {
    if (this.options.slackClient) {
      return this.options.slackClient;
    }
    const token = await this.options.integrationSecrets.getCredentials();
    if (!token.slackToken) {
      return undefined;
    }
    return new SlackClient({ token: token.slackToken });
  }

  private assessCompleteness(
    warnings: string[],
    scores: OwnershipReport["scores"],
    commits: CommitInfo[]
  ): OwnershipCompleteness {
    if (scores.length > 0 && commits.length > 5 && warnings.length <= 1) {
      return "full";
    }
    if (scores.length > 0 || commits.length > 0) {
      return "partial";
    }
    return "minimal";
  }
}

export function createOwnershipGraphEngine(options: OwnershipGraphEngineOptions): OwnershipGraphEngine {
  return new OwnershipGraphEngine(options);
}

export async function mapOwnership(
  owner: string,
  repo: string,
  path: string,
  branch?: string,
  provider?: import("../api/codeHosts/types").CodeHostProvider
): Promise<OwnershipReport> {
  const engine = getOwnershipGraphEngine();
  if (!engine) {
    throw new Error("Ownership graph engine is not registered.");
  }
  return engine.mapOwnership({ owner, repo, path, branch, provider });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
