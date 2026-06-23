import { toRepositoryRelativePath } from "../context/repoFilePath";
import { getDecisionArchaeologyEngine } from "./decisionArchaeologyRegistry";
import { CodeHostSecrets } from "../api/codeHosts/codeHostSecrets";
import { codeHostRequestJson } from "../api/codeHosts/codeHostHttp";
import type { CodeHostRouter } from "../api/codeHosts/codeHostRouter";
import type { BlameLine, CodeHostProvider, CommitInfo, PullRequestComment, RepoCoordinates } from "../api/codeHosts/types";
import { IntegrationSecrets } from "../api/integrations/integrationSecrets";
import { JiraClient } from "../api/jira/jiraClient";
import { createJiraClientFromCredentials } from "../api/integrations/buildIntegrationClients";
import { SlackClient, type SlackThread } from "../api/slack/slackClient";
import { TeamsClient } from "../api/teams/teamsClient";
import {
  buildSlackSearchQueries,
  extractGitHubIssueNumbers,
  integrationRelevanceFromHit,
  isIntegrationSearchHitRelevant,
  parseGithubPullUrl,
  threadMeetsRelevanceBar,
  type TraceEvidenceMatchOptions
} from "./traceEvidenceRelevance";
import type {
  DecisionAlternative,
  DecisionCommit,
  DecisionRationaleRank,
  DecisionReview,
  DecisionTimeline,
  LineRange
} from "../types/decisionTimeline";

export type {
  ChronologyEvent,
  DecisionAlternative,
  DecisionCommit,
  DecisionEvolution,
  DecisionIntroducingDiffSummary,
  DecisionJiraTicket,
  DecisionRationaleRank,
  DecisionReview,
  DecisionSlackThread,
  DecisionTeamsThread,
  DecisionTimeline,
  LineRange
} from "../types/decisionTimeline";

export type TraceDecisionOptions = {
  codeHostRouter: CodeHostRouter;
  codeHostSecrets: CodeHostSecrets;
  integrationSecrets: IntegrationSecrets;
  slackClient?: SlackClient;
  teamsClient?: TeamsClient;
  jiraClient?: JiraClient;
};

export type TraceDecisionParams = {
  provider?: CodeHostProvider;
  owner: string;
  repo: string;
  file: string;
  lineRange?: LineRange;
  branch?: string;
  codeSnippet?: string;
};

type PullRequestDetail = {
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
  owner: string;
  repo: string;
};

type GitHubPullDetail = PullRequestDetail;

type IntroducingDiffStats = {
  filesChanged: number;
  insertions?: number;
  deletions?: number;
  patchExcerpt?: string;
};

export class DecisionArchaeologyEngine {
  public constructor(private readonly options: TraceDecisionOptions) {}

  public async traceDecision(params: TraceDecisionParams): Promise<DecisionTimeline> {
    const { owner, repo, lineRange, branch, codeSnippet } = params;
    const file = toRepositoryRelativePath(params.file);
    const coords = await this.options.codeHostRouter.resolveCoordinates({
      provider: params.provider,
      owner,
      repo,
      branch
    });

    const timeline: DecisionTimeline = {
      file,
      targetLabel: formatTargetLabel(file, lineRange),
      lineRange,
      codeSnippet,
      alternatives: [],
      chronology: [],
      warnings: [],
      completeness: "minimal"
    };

    let blameLines: BlameLine[] = [];
    try {
      const blame = await this.options.codeHostRouter.getBlameData(file, coords);
      blameLines = filterBlameForRange(blame.lines, lineRange);
      if (blameLines.length === 0 && lineRange) {
        timeline.warnings.push("No blame data for the selected line range; using full file blame.");
        blameLines = blame.lines;
      }
    } catch (error) {
      timeline.warnings.push(`Blame unavailable: ${errorMessage(error)}`);
      timeline.fallbackMessage = "Could not load git blame. Showing commit search only.";
    }

    if (blameLines.length === 0 && !timeline.fallbackMessage) {
      timeline.warnings.push(
        `No blame lines for ${file} on ${coords.provider} (${owner}/${repo}${branch ? `@${branch}` : ""}).`
      );
    }

    const introduction = await this.findOriginalIntroduction(coords, file, blameLines, lineRange);
    if (!introduction) {
      let recent: CommitInfo | undefined;
      try {
        recent = await this.tryRecentFileHistory(coords, file);
      } catch (error) {
        timeline.warnings.push(`File history lookup failed: ${errorMessage(error)}`);
      }
      if (!recent) {
        timeline.fallbackMessage = `Could not load commit history for ${file} on ${coords.provider} (${owner}/${repo}${branch ? `@${branch}` : ""}). Check settings and that the file exists on the remote repo.`;
        return timeline;
      }
      timeline.originalCommit = mapCommit(recent);
      pushChronology(timeline, recent.date, recent.author, "Recent commit on file", recent.message);
    } else {
      timeline.originalCommit = mapCommit(introduction);
      pushChronology(
        timeline,
        introduction.date,
        introduction.author,
        "Code originally introduced",
        introduction.message
      );
    }

    const commit = timeline.originalCommit;
    if (!commit) {
      return timeline;
    }

    await this.enrichIntroducingDiffSummary(timeline, coords, file, commit).catch((error) => {
      timeline.warnings.push(`Introducing diff summary unavailable: ${errorMessage(error)}`);
    });

    await this.enrichEvolution(timeline, coords, file, commit).catch((error) => {
      timeline.warnings.push(`File evolution lookup unavailable: ${errorMessage(error)}`);
    });

    const refs = parseReferences(commit.message);
    let prNumber: number | undefined = refs.prNumbers[0];
    if (!prNumber) {
      prNumber = await this.findPrForCommit(coords, commit.sha);
    }

    let prBody = "";
    if (prNumber) {
      let pr: Awaited<ReturnType<DecisionArchaeologyEngine["fetchPullRequest"]>> | undefined;
      try {
        pr = await this.fetchPullRequest(coords, prNumber, file, commit.sha);
      } catch (error) {
        timeline.warnings.push(`PR #${prNumber} could not be loaded: ${errorMessage(error)}`);
      }

      if (pr) {
        prBody = pr.body ?? "";
        const commentCoords: RepoCoordinates = {
          ...coords,
          owner: pr.owner,
          repo: pr.repo
        };
        let comments: import("../api/codeHosts/types").PullRequestComment[] = [];
        try {
          comments = await this.options.codeHostRouter.getPRComments(prNumber, commentCoords);
        } catch (error) {
          timeline.warnings.push(`PR #${prNumber} comments could not be loaded: ${errorMessage(error)}`);
        }
        const reviews = mapPrComments(comments);
        const approvers = extractApprovers(prBody, reviews);

        timeline.linkedPR = {
          number: pr.number,
          title: pr.title,
          description: prBody,
          state: pr.merged ? "merged" : pr.state,
          labels: pr.labels,
          htmlUrl: pr.htmlUrl,
          reviews,
          approvers
        };

        timeline.alternatives.push(...extractAlternativesFromText(prBody, "PR description"));
        for (const review of reviews) {
          timeline.alternatives.push(...extractAlternativesFromText(review.body, `@${review.author} review`));
        }

        pushChronology(
          timeline,
          pr.createdAt,
          pr.author ?? "unknown",
          `Opened PR #${pr.number}: ${pr.title}`,
          pr.htmlUrl ?? `PR #${pr.number}`
        );

        for (const approver of approvers) {
          pushChronology(timeline, pr.updatedAt, approver, "Approved pull request", `PR #${pr.number}`);
        }

        timeline.completeness = "partial";
      }
    } else {
      timeline.warnings.push("No linked pull request found for the introducing commit.");
    }

    const issueKeys = [
      ...refs.jiraKeys,
      ...JiraClient.extractIssueKeys(commit.message),
      ...JiraClient.extractIssueKeys(prBody)
    ];
    const uniqueIssues = [...new Set(issueKeys)];

    const slack = await this.resolveSlackClient();
    const teams = await this.resolveTeamsClient();
    const jira = await this.resolveJiraClient();

    if (slack) {
      await this.correlateSlack(timeline, slack, prNumber, uniqueIssues, prBody, file, timeline.linkedPR);
    } else {
      timeline.warnings.push("Slack integration not configured; skipping thread correlation.");
    }

    if (teams && !timeline.slackThread) {
      await this.correlateTeams(timeline, teams, prNumber, uniqueIssues, file);
    }

    if (jira && uniqueIssues.length > 0) {
      timeline.jiraTickets = [];
      for (const issueKey of uniqueIssues.slice(0, 5)) {
        await this.correlateJiraTicket(timeline, jira, issueKey);
      }
    } else if (uniqueIssues.length > 0) {
      timeline.warnings.push("Jira integration not configured; ticket IDs found in references only.");
    }

    timeline.rationaleRanking = buildRationaleRanking(
      timeline,
      isHighSignalCommitMessage(commit.message)
    );
    if (!timeline.rationaleRanking.length) {
      delete timeline.rationaleRanking;
    }

    const hasJira = (timeline.jiraTickets?.length ?? 0) > 0;
    if (timeline.linkedPR && hasJira) {
      timeline.completeness = "full";
    } else if (timeline.linkedPR || hasJira || timeline.slackThread) {
      timeline.completeness = "partial";
    }

    timeline.chronology.sort((a, b) => a.date.localeCompare(b.date));
    return timeline;
  }

  private async enrichIntroducingDiffSummary(
    timeline: DecisionTimeline,
    coords: RepoCoordinates,
    file: string,
    introducingCommit: DecisionCommit
  ): Promise<void> {
    let filesChanged = 0;
    let insertions: number | undefined;
    let deletions: number | undefined;
    let patchExcerpt: string | undefined;

    const commitDetail = await this.fetchCommitDetail(coords, introducingCommit.sha).catch(() => undefined);
    if (commitDetail?.filesChanged?.length) {
      filesChanged = commitDetail.filesChanged.length;
    }

    const providerStats =
      coords.provider === "github"
        ? await this.fetchGithubCommitDiffStats(coords, introducingCommit.sha, file).catch(() => undefined)
        : coords.provider === "gitlab"
          ? await this.fetchGitLabCommitDiffStats(coords, introducingCommit.sha, file).catch(() => undefined)
          : undefined;

    if (providerStats) {
      filesChanged = providerStats.filesChanged || filesChanged;
      insertions = providerStats.insertions ?? insertions;
      deletions = providerStats.deletions ?? deletions;
      patchExcerpt = providerStats.patchExcerpt ?? patchExcerpt;
    }

    if (!filesChanged && insertions === undefined && deletions === undefined && !patchExcerpt) {
      return;
    }

    const resolvedFilesChanged = Math.max(1, filesChanged || 1);
    timeline.introducingDiffSummary = {
      filesChanged: resolvedFilesChanged,
      insertions,
      deletions,
      summary: summarizeIntroducingDiff({
        filesChanged: resolvedFilesChanged,
        insertions,
        deletions,
        patchExcerpt
      }),
      patchExcerpt
    };
  }

  private async enrichEvolution(
    timeline: DecisionTimeline,
    coords: RepoCoordinates,
    file: string,
    introducingCommit: DecisionCommit
  ): Promise<void> {
    const history = await this.options.codeHostRouter.getFileHistory(file, 250, coords);
    if (!history.length) {
      return;
    }

    const newest = history[0];
    const introducingIndex = history.findIndex((entry) => entry.sha === introducingCommit.sha);

    let commitCountSinceIntroduction: number;
    if (introducingIndex >= 0) {
      commitCountSinceIntroduction = introducingIndex + 1;
    } else {
      const introducingAtMs = Date.parse(introducingCommit.date);
      if (Number.isFinite(introducingAtMs)) {
        commitCountSinceIntroduction = history.filter((entry) => Date.parse(entry.date) >= introducingAtMs).length;
      } else {
        commitCountSinceIntroduction = history.length;
      }
    }

    timeline.evolution = {
      commitCountSinceIntroduction: Math.max(1, commitCountSinceIntroduction || 1),
      lastModifiedAt: newest.date,
      lastModifiedAuthor: formatCommitAuthor(newest)
    };
  }

  private async fetchGithubCommitDiffStats(
    coords: RepoCoordinates,
    sha: string,
    file: string
  ): Promise<IntroducingDiffStats | undefined> {
    const creds = await this.options.codeHostSecrets.getCredentials();
    if (!creds.githubToken) {
      return undefined;
    }

    const url = `https://api.github.com/repos/${encodeURIComponent(coords.owner)}/${encodeURIComponent(coords.repo)}/commits/${encodeURIComponent(sha)}`;
    const commit = await codeHostRequestJson<{
      stats?: { additions?: number; deletions?: number };
      files?: Array<{ filename: string; patch?: string }>;
    }>(url, {
      headers: githubHeaders(creds.githubToken),
      provider: "github"
    });

    const files = commit.files ?? [];
    const targetFile = files.find((entry) => filePathMatchesTarget(file, entry.filename));
    return {
      filesChanged: files.length,
      insertions: commit.stats?.additions,
      deletions: commit.stats?.deletions,
      patchExcerpt: targetFile?.patch ? extractPatchExcerpt(targetFile.patch) : undefined
    };
  }

  private async fetchGitLabCommitDiffStats(
    coords: RepoCoordinates,
    sha: string,
    file: string
  ): Promise<IntroducingDiffStats | undefined> {
    const creds = await this.options.codeHostSecrets.getCredentials();
    if (!creds.gitlabToken) {
      return undefined;
    }

    const apiBase = (coords.baseUrl?.trim() || "https://gitlab.com/api/v4").replace(/\/$/, "");
    const headers = {
      "PRIVATE-TOKEN": creds.gitlabToken,
      "User-Agent": "coop-ai-extension"
    };
    const project = await codeHostRequestJson<{ id: number }>(
      `${apiBase}/projects/${encodeURIComponent(`${coords.owner}/${coords.repo}`)}`,
      {
        headers,
        provider: "gitlab"
      }
    );

    const [commitDetail, commitDiff] = await Promise.all([
      codeHostRequestJson<{
        stats?: { additions?: number; deletions?: number };
      }>(`${apiBase}/projects/${project.id}/repository/commits/${encodeURIComponent(sha)}?stats=true`, {
        headers,
        provider: "gitlab"
      }),
      codeHostRequestJson<
        Array<{
          old_path?: string;
          new_path?: string;
          diff?: string;
        }>
      >(`${apiBase}/projects/${project.id}/repository/commits/${encodeURIComponent(sha)}/diff`, {
        headers,
        provider: "gitlab"
      })
    ]);

    const files = commitDiff ?? [];
    const targetFile = files.find((entry) =>
      filePathMatchesTarget(file, entry.new_path ?? entry.old_path ?? "")
    );
    return {
      filesChanged: files.length,
      insertions: commitDetail.stats?.additions,
      deletions: commitDetail.stats?.deletions,
      patchExcerpt: targetFile?.diff ? extractPatchExcerpt(targetFile.diff) : undefined
    };
  }

  private async findOriginalIntroduction(
    coords: RepoCoordinates,
    file: string,
    blameLines: BlameLine[],
    lineRange?: LineRange
  ): Promise<CommitInfo | undefined> {
    const uniqueShas = [...new Set(blameLines.map((line) => line.commitSha))].slice(0, 10);
    if (uniqueShas.length === 0) {
      return undefined;
    }

    const commits = (
      await Promise.all(
        uniqueShas.map((sha) => this.fetchCommitDetail(coords, sha).catch(() => undefined))
      )
    ).filter((commit): commit is CommitInfo => Boolean(commit));

    if (commits.length === 0) {
      return undefined;
    }

    if (lineRange) {
      // Line-specific trace: follow blame for the selection, not the file's first commit.
      commits.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      return commits[0];
    }

    commits.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const oldest = commits[0];
    const history = await this.options.codeHostRouter.getFileHistory(file, 25, coords).catch(() => []);
    const oldestInHistory = history.length > 0 ? history[history.length - 1] : undefined;

    if (oldestInHistory && new Date(oldestInHistory.date) < new Date(oldest.date)) {
      return oldestInHistory;
    }
    return oldest;
  }

  private async tryRecentFileHistory(coords: RepoCoordinates, file: string): Promise<CommitInfo | undefined> {
    const history = await this.options.codeHostRouter.getFileHistory(file, 5, coords);
    return history[0];
  }

  private async fetchCommitDetail(coords: RepoCoordinates, sha: string): Promise<CommitInfo> {
    return this.options.codeHostRouter.getCommitBySha(sha, coords);
  }

  private async findPrForCommit(coords: RepoCoordinates, sha: string): Promise<number | undefined> {
    if (coords.provider === "github") {
      return this.findGithubPrForCommit(coords, sha);
    }
    return undefined;
  }

  private async findGithubPrForCommit(coords: RepoCoordinates, sha: string): Promise<number | undefined> {
    const pulls = await this.options.codeHostRouter.getPullRequestsForCommit(sha, coords).catch(() => []);
    if (pulls[0]?.number) {
      return pulls[0].number;
    }
    const creds = await this.options.codeHostSecrets.getCredentials();
    if (!creds.githubToken) {
      return undefined;
    }
    const url = `https://api.github.com/repos/${encodeURIComponent(coords.owner)}/${encodeURIComponent(coords.repo)}/commits/${sha}/pulls`;
    const legacyPulls = await codeHostRequestJson<Array<{ number: number }>>(url, {
      headers: githubHeaders(creds.githubToken),
      provider: "github"
    }).catch(() => []);
    return legacyPulls[0]?.number;
  }

  private async fetchPullRequest(
    coords: RepoCoordinates,
    prNumber: number,
    file: string,
    commitSha?: string
  ): Promise<PullRequestDetail> {
    if (commitSha) {
      const linked = await this.options.codeHostRouter.getPullRequestsForCommit(commitSha, coords).catch(() => []);
      const fromCommit = linked.find((pull) => pull.number === prNumber);
      if (fromCommit) {
        return {
          number: fromCommit.number,
          title: fromCommit.title,
          body: fromCommit.body ?? "",
          state: fromCommit.merged ? "merged" : fromCommit.state,
          merged: fromCommit.merged,
          author: fromCommit.author,
          createdAt: fromCommit.createdAt,
          updatedAt: fromCommit.updatedAt,
          htmlUrl: fromCommit.htmlUrl,
          labels: fromCommit.labels,
          owner: fromCommit.owner,
          repo: fromCommit.repo
        };
      }
    }

    try {
      const pr = await this.options.codeHostRouter.getPullRequestDetail(prNumber, coords, {
        commitSha
      });
      const prWithRepo = pr as typeof pr & { owner?: string; repo?: string };
      return {
        number: pr.number,
        title: pr.title,
        body: pr.body ?? "",
        state: pr.merged ? "merged" : pr.state,
        merged: pr.merged,
        author: pr.author,
        createdAt: pr.createdAt,
        updatedAt: pr.updatedAt,
        htmlUrl: pr.htmlUrl,
        labels: pr.labels,
        owner: prWithRepo.owner ?? coords.owner,
        repo: prWithRepo.repo ?? coords.repo
      };
    } catch {
      try {
        const prs = await this.options.codeHostRouter.getPRsForFile(file, 50, coords);
        const summary = prs.find((pr) => pr.number === prNumber);
        if (!summary) {
          throw new Error(
            `Pull request #${prNumber} is not on ${coords.owner}/${coords.repo}. It may refer to an upstream repository.`
          );
        }
        return {
          number: summary.number,
          title: summary.title,
          body: "",
          state: summary.state,
          merged: summary.merged,
          author: summary.author,
          createdAt: summary.createdAt,
          updatedAt: summary.updatedAt,
          htmlUrl: summary.htmlUrl,
          labels: [],
          owner: coords.owner,
          repo: coords.repo
        };
      } catch (inner) {
        throw inner instanceof Error ? inner : new Error(String(inner));
      }
    }
  }

  private async correlateSlack(
    timeline: DecisionTimeline,
    slack: SlackClient,
    prNumber: number | undefined,
    issueKeys: string[],
    prBody: string,
    file: string,
    linkedPR?: DecisionTimeline["linkedPR"]
  ): Promise<void> {
    const pullCoords = parseGithubPullUrl(linkedPR?.htmlUrl);
    const githubIssueNumbers = extractGitHubIssueNumbers(prBody, prNumber);
    const matchOptions: TraceEvidenceMatchOptions = {
      prNumber,
      file,
      issueKeys,
      githubIssueNumbers
    };

    const slackUrl = extractSlackThreadUrl(prBody);
    if (slackUrl) {
      const parsed = slack.parseSlackThreadUrl(slackUrl);
      if (parsed) {
        try {
          const channel = await slack.getChannelInfo(parsed.channelId);
          const thread = await slack.getThread(parsed.channelId, parsed.threadTs);
          this.applySlackThread(timeline, thread, channel.name, slackUrl, "direct");
          this.ingestSlackSignals(timeline, slack, thread);
          return;
        } catch (error) {
          timeline.warnings.push(`Slack thread URL found but could not be loaded: ${errorMessage(error)}`);
        }
      }
    }

    const queries = buildSlackSearchQueries({
      prNumber,
      prTitle: linkedPR?.title,
      prBody,
      pullOwner: pullCoords.owner,
      pullRepo: pullCoords.repo,
      issueKeys
    });

    let lastSearchError: string | undefined;
    let sawAnyHit = false;

    for (const query of queries) {
      try {
        const hits = await slack.searchMessages(query, { limit: 10 });
        if (hits.length > 0) {
          sawAnyHit = true;
        }
        const hit = hits.find((candidate) =>
          isIntegrationSearchHitRelevant(candidate.text, matchOptions)
        );
        if (!hit?.channelId) {
          continue;
        }
        const threadTs = hit.threadTs ?? hit.ts;
        const thread = await slack.getThread(hit.channelId, threadTs);
        if (!threadMeetsRelevanceBar(thread.messages, matchOptions)) {
          continue;
        }
        this.applySlackThread(
          timeline,
          thread,
          hit.channelName,
          hit.permalink,
          integrationRelevanceFromHit(hit.text, file)
        );
        this.ingestSlackSignals(timeline, slack, thread);
        return;
      } catch (error) {
        lastSearchError = errorMessage(error);
      }
    }

    if (lastSearchError && /missing_scope|not_allowed|invalid_auth|token/i.test(lastSearchError)) {
      timeline.warnings.push(
        `Slack search unavailable (${lastSearchError}). Reconnect Slack with user token scopes: search:read, channels:history, groups:history.`
      );
      return;
    }

    if (prNumber) {
      const scopeHint =
        pullCoords.owner && pullCoords.repo
          ? ` on ${pullCoords.owner}/${pullCoords.repo}`
          : "";
      if (sawAnyHit) {
        timeline.warnings.push(
          `Slack messages were found but none mentioned PR #${prNumber}${scopeHint} or linked issues (${githubIssueNumbers.join(", ") || "none"}).`
        );
      } else {
        timeline.warnings.push(
          `No Slack thread mentioning PR #${prNumber}${scopeHint} was found in your connected workspace.`
        );
      }
    } else if (issueKeys.length > 0) {
      timeline.warnings.push(`No Slack thread mentioning ${issueKeys[0]} was found.`);
    }
  }

  private ingestSlackSignals(timeline: DecisionTimeline, slack: SlackClient, thread: SlackThread): void {
    const signals = slack.extractDecisionSignals(thread);
    for (const signal of signals) {
      timeline.alternatives.push(...extractAlternativesFromText(signal.text, `Slack (@${signal.user})`));
      pushChronology(timeline, signal.ts, signal.user, "Slack decision signal", truncate(signal.text, 120));
    }
  }

  private applySlackThread(
    timeline: DecisionTimeline,
    thread: SlackThread,
    channelName: string | undefined,
    permalink?: string,
    relevance: "direct" | "linked" = "linked"
  ): void {
    timeline.slackThread = {
      channelId: thread.channelId,
      channelName,
      threadTs: thread.threadTs,
      permalink,
      messages: thread.messages.map((m) => ({
        user: m.userName ?? m.userId,
        text: m.text,
        ts: m.ts
      })),
      participants: thread.participants,
      relevance
    };
  }

  private async correlateTeams(
    timeline: DecisionTimeline,
    teams: TeamsClient,
    prNumber: number | undefined,
    issueKeys: string[],
    file: string
  ): Promise<void> {
    const matchOptions: TraceEvidenceMatchOptions = { prNumber, file, issueKeys };
    const queries = [prNumber ? `PR ${prNumber}` : undefined, ...issueKeys].filter(Boolean) as string[];
    for (const query of queries) {
      try {
        const hits = await teams.searchMessages(query, { limit: 5 });
        const hit = hits.find(
          (candidate) =>
            candidate.body &&
            isIntegrationSearchHitRelevant(candidate.body, matchOptions)
        );
        if (!hit?.teamId || !hit.channelId || !hit.messageId) {
          continue;
        }
        const thread = await teams.getThread(hit.teamId, hit.channelId, hit.messageId);
        if (!threadMeetsRelevanceBar(thread.messages.map((m) => ({ text: m.body })), matchOptions)) {
          continue;
        }
        timeline.teamsThread = {
          teamId: hit.teamId,
          channelId: hit.channelId,
          rootMessageId: hit.messageId,
          messages: thread.messages.map((m) => ({
            user: m.fromUserName ?? "unknown",
            text: m.body,
            date: m.createdAt
          })),
          participants: thread.participants
        };
        const signals = teams.extractDecisionSignals(thread);
        for (const signal of signals) {
          timeline.alternatives.push(...extractAlternativesFromText(signal.text, `Teams (@${signal.user})`));
          pushChronology(timeline, signal.date, signal.user, "Teams decision signal", truncate(signal.text, 120));
        }
        return;
      } catch {
        /* try next */
      }
    }
    if (prNumber) {
      timeline.warnings.push(`No Teams thread mentioning PR #${prNumber} was found.`);
    }
  }

  private async correlateJiraTicket(timeline: DecisionTimeline, jira: JiraClient, issueKey: string): Promise<void> {
    try {
      const issue = await jira.getIssue(issueKey);
      const ticket = {
        key: issue.key,
        epic: issue.epicName ?? issue.epicKey,
        summary: issue.summary,
        description: issue.description ?? "",
        acceptanceCriteria: issue.acceptanceCriteria,
        technicalDebt: issue.technicalDebt,
        htmlUrl: issue.htmlUrl
      };
      timeline.jiraTickets = [...(timeline.jiraTickets ?? []), ticket];
      pushChronology(
        timeline,
        issue.created,
        issue.reporter ?? "Jira",
        `Ticket ${issue.key} created: ${issue.summary}`,
        issue.htmlUrl
      );

      const transitions = await jira.getTransitionHistory(issueKey).catch(() => []);
      for (const transition of transitions.slice(-5)) {
        pushChronology(
          timeline,
          transition.date,
          transition.author ?? "Jira",
          `Status → ${transition.toStatus}`,
          issueKey
        );
      }

      timeline.alternatives.push(...extractAlternativesFromText(issue.description ?? "", `Jira ${issue.key}`));
    } catch (error) {
      timeline.warnings.push(`Jira ticket ${issueKey}: ${errorMessage(error)}`);
    }
  }

  private async resolveSlackClient(): Promise<SlackClient | undefined> {
    if (this.options.slackClient) {
      return this.options.slackClient;
    }
    const creds = await this.options.integrationSecrets.getCredentials();
    if (!creds.slackToken) {
      return undefined;
    }
    return new SlackClient({ token: creds.slackToken });
  }

  private async resolveTeamsClient(): Promise<TeamsClient | undefined> {
    if (this.options.teamsClient) {
      return this.options.teamsClient;
    }
    const creds = await this.options.integrationSecrets.getCredentials();
    if (!creds.teamsToken) {
      return undefined;
    }
    return new TeamsClient({ accessToken: creds.teamsToken });
  }

  private async resolveJiraClient(): Promise<JiraClient | undefined> {
    if (this.options.jiraClient) {
      return this.options.jiraClient;
    }
    const creds = await this.options.integrationSecrets.getCredentials();
    return createJiraClientFromCredentials(creds);
  }
}

export function createDecisionArchaeologyEngine(options: TraceDecisionOptions): DecisionArchaeologyEngine {
  return new DecisionArchaeologyEngine(options);
}

/**
 * Traces a code selection back through commits, PRs, Slack/Teams, and Jira.
 * Requires `registerDecisionArchaeologyEngine()` during extension activation.
 */
export async function traceDecision(
  owner: string,
  repo: string,
  file: string,
  lineRange?: LineRange,
  branch?: string,
  options?: Partial<TraceDecisionParams>
): Promise<DecisionTimeline> {
  const engine = getDecisionArchaeologyEngine();
  if (!engine) {
    throw new Error("Decision archaeology engine is not initialized.");
  }
  return engine.traceDecision({
    provider: options?.provider,
    owner,
    repo,
    file,
    lineRange,
    branch,
    codeSnippet: options?.codeSnippet
  });
}

function githubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "coop-ai-extension"
  };
}

function filterBlameForRange(lines: BlameLine[], range?: LineRange): BlameLine[] {
  if (!range) {
    return lines;
  }
  return lines.filter((line) => line.lineNumber >= range.start && line.lineNumber <= range.end);
}

function mapCommit(commit: CommitInfo): DecisionCommit {
  return {
    sha: commit.sha,
    author: commit.authorLogin ? `@${commit.authorLogin}` : commit.author,
    date: commit.date,
    message: commit.message,
    htmlUrl: commit.htmlUrl
  };
}

function mapPrComments(comments: PullRequestComment[]): DecisionReview[] {
  return comments.map((comment) => ({
    id: comment.id,
    author: comment.author,
    body: comment.body,
    path: comment.path,
    line: comment.line,
    createdAt: comment.createdAt,
    kind: comment.path ? "review" : "conversation"
  }));
}

function parseReferences(text: string): { prNumbers: number[]; jiraKeys: string[] } {
  const prNumbers = [...text.matchAll(/\b(?:#|PR\s*#?|pull\/)(\d{1,6})\b/gi)].map((m) => Number(m[1]));
  const jiraKeys = JiraClient.extractIssueKeys(text);
  return { prNumbers: [...new Set(prNumbers)], jiraKeys };
}

const WEAK_DECISION_COMMIT_MESSAGE_RE = /^(wip|fix|update|changes?|misc|tmp|test|merge|refactor)\b/i;

function isHighSignalCommitMessage(message: string): boolean {
  const cleaned = message.replace(/\s+/g, " ").trim();
  const words = cleaned.split(" ").filter(Boolean).length;
  return words >= 6 && cleaned.length >= 30 && !WEAK_DECISION_COMMIT_MESSAGE_RE.test(cleaned);
}

function buildRationaleRanking(
  timeline: DecisionTimeline,
  hasHighSignalCommitMessage: boolean
): DecisionRationaleRank[] {
  const ranking: DecisionRationaleRank[] = [];

  if (timeline.linkedPR) {
    const pr = timeline.linkedPR;
    const hasDetailedPrContext =
      (pr.description?.trim().length ?? 0) >= 20 || pr.reviews.length > 0 || pr.approvers.length > 0;
    ranking.push({
      source: `pr:${pr.number}`,
      role: hasDetailedPrContext ? "rationale" : "provenance",
      label: `PR #${pr.number}`
    });
  }

  for (const [index, ticket] of (timeline.jiraTickets ?? []).entries()) {
    ranking.push({
      source: `jira:${ticket.key}`,
      role: index === 0 ? "rationale" : "provenance",
      label: `Jira ${ticket.key}`
    });
  }

  if (timeline.slackThread) {
    const channel = timeline.slackThread.channelName ?? timeline.slackThread.channelId;
    ranking.push({
      source: `slack:${channel}`,
      role: hasSubstantiveThreadMessages(timeline.slackThread.messages.map((message) => message.text))
        ? "rationale"
        : "provenance",
      label: `Slack #${channel}`
    });
  }

  if (timeline.teamsThread) {
    ranking.push({
      source: `teams:${timeline.teamsThread.channelId}`,
      role: hasSubstantiveThreadMessages(timeline.teamsThread.messages.map((message) => message.text))
        ? "rationale"
        : "provenance",
      label: "Teams thread"
    });
  }

  if (timeline.originalCommit) {
    const existingRicherSources = ranking.length > 0;
    ranking.push({
      source: `commit:${timeline.originalCommit.sha}`,
      role: hasHighSignalCommitMessage
        ? existingRicherSources
          ? "provenance"
          : "rationale"
        : existingRicherSources
          ? "background"
          : "provenance",
      label: `Commit ${timeline.originalCommit.sha.slice(0, 7)}`
    });
  }

  const deduped: DecisionRationaleRank[] = [];
  const seen = new Set<string>();
  for (const entry of ranking) {
    const key = `${entry.source}|${entry.label}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(entry);
  }
  return deduped;
}

function hasSubstantiveThreadMessages(messages: string[]): boolean {
  return messages.some((message) => message.replace(/\s+/g, " ").trim().length >= 80);
}

function formatTargetLabel(file: string, lineRange?: LineRange): string {
  if (!lineRange) {
    return file;
  }
  return lineRange.start === lineRange.end
    ? `${file}:${lineRange.start}`
    : `${file}:${lineRange.start}-${lineRange.end}`;
}

function summarizeIntroducingDiff(stats: IntroducingDiffStats): string {
  const filesPart = `${stats.filesChanged} file${stats.filesChanged === 1 ? "" : "s"}`;
  const changeParts = [
    typeof stats.insertions === "number" ? `+${stats.insertions}` : undefined,
    typeof stats.deletions === "number" ? `-${stats.deletions}` : undefined
  ].filter(Boolean);
  const deltaPart = changeParts.length ? ` (${changeParts.join(" / ")})` : "";
  const headline = `Introducing commit changed ${filesPart}${deltaPart}.`;
  if (stats.patchExcerpt) {
    return `${headline} Added code includes "${truncate(stats.patchExcerpt, 120)}".`;
  }
  return headline;
}

function filePathMatchesTarget(targetFile: string, candidatePath: string): boolean {
  const normalizedTarget = targetFile.replace(/^\/+/, "");
  const normalizedCandidate = candidatePath.replace(/^\/+/, "");
  return normalizedCandidate === normalizedTarget || normalizedCandidate.endsWith(`/${normalizedTarget}`);
}

function extractPatchExcerpt(patch: string): string | undefined {
  const addedLines = patch
    .split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .map((line) => line.slice(1).trim())
    .filter(Boolean);

  if (addedLines.length > 0) {
    return truncate(addedLines.slice(0, 2).join(" "), 180);
  }

  const contextLine = patch
    .split("\n")
    .find((line) => line.startsWith(" ") && line.trim().length > 1);
  return contextLine ? truncate(contextLine.trim(), 180) : undefined;
}

function formatCommitAuthor(commit: CommitInfo): string {
  return commit.authorLogin ? `@${commit.authorLogin}` : commit.author;
}

function extractApprovers(prBody: string, reviews: DecisionReview[]): string[] {
  const fromText = [...prBody.matchAll(/approved by @?([a-zA-Z0-9_-]+)/gi)].map((m) => m[1]);
  const fromReviews = reviews
    .filter((r) => /\b(lgtm|approved|ship it)\b/i.test(r.body))
    .map((r) => r.author);
  return [...new Set([...fromText, ...fromReviews])];
}

export function extractAlternativesFromText(text: string, source: string): DecisionAlternative[] {
  const alternatives: DecisionAlternative[] = [];
  const patterns = [
    /(?:considered|evaluated|tried)\s+(.+?)\s+but\s+(?:chose|picked|went with|selected)\s+(.+?)(?:\.|$)/gi,
    /(?:rejected|ruled out|decided against)\s+(.+?)\s+(?:because|due to)\s+(.+?)(?:\.|$)/gi,
    /instead of\s+(.+?),\s+(?:we|I|team)\s+(?:chose|used|went with)\s+(.+?)(?:\.|$)/gi
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      alternatives.push({
        option: match[1].trim(),
        reason_rejected: match[2].trim(),
        proposed_by: source,
        source
      });
    }
  }
  return alternatives;
}

function extractSlackThreadUrl(text: string): string | undefined {
  const match = /https:\/\/[^\s]*slack\.com\/archives\/[A-Z0-9]+\/p\d+/i.exec(text);
  return match?.[0];
}

function pushChronology(
  timeline: DecisionTimeline,
  date: string,
  actor: string,
  event: string,
  evidence: string
): void {
  timeline.chronology.push({ date, actor, event, evidence });
}

function truncate(value: string, max: number): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
