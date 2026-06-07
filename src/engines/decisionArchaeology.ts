import { toRepositoryRelativePath } from "../context/repoFilePath";
import { getDecisionArchaeologyEngine } from "./decisionArchaeologyRegistry";
import { CodeHostSecrets } from "../api/codeHosts/codeHostSecrets";
import { codeHostRequestJson } from "../api/codeHosts/codeHostHttp";
import type { CodeHostRouter } from "../api/codeHosts/codeHostRouter";
import type { BlameLine, CodeHostProvider, CommitInfo, PullRequestComment, RepoCoordinates } from "../api/codeHosts/types";
import { IntegrationSecrets } from "../api/integrations/integrationSecrets";
import { JiraClient } from "../api/jira/jiraClient";
import { SlackClient, type SlackThread } from "../api/slack/slackClient";
import { TeamsClient } from "../api/teams/teamsClient";
import type {
  DecisionAlternative,
  DecisionCommit,
  DecisionReview,
  DecisionTimeline,
  LineRange
} from "../types/decisionTimeline";

export type {
  ChronologyEvent,
  DecisionAlternative,
  DecisionCommit,
  DecisionJiraTicket,
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
};

type GitHubPullDetail = PullRequestDetail;

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

    const refs = parseReferences(commit.message);
    let prNumber: number | undefined = refs.prNumbers[0];
    if (!prNumber) {
      prNumber = await this.findPrForCommit(coords, commit.sha);
    }

    let prBody = "";
    if (prNumber) {
      try {
        const pr = await this.fetchPullRequest(coords, prNumber, file);
        prBody = pr.body ?? "";
        const comments = await this.options.codeHostRouter.getPRComments(prNumber, coords);
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
      } catch (error) {
        timeline.warnings.push(`PR #${prNumber} could not be loaded: ${errorMessage(error)}`);
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
      await this.correlateSlack(timeline, slack, prNumber, uniqueIssues, prBody);
    } else {
      timeline.warnings.push("Slack integration not configured; skipping thread correlation.");
    }

    if (teams && !timeline.slackThread) {
      await this.correlateTeams(timeline, teams, prNumber, uniqueIssues);
    }

    if (jira && uniqueIssues.length > 0) {
      await this.correlateJira(timeline, jira, uniqueIssues[0]);
    } else if (uniqueIssues.length > 0) {
      timeline.warnings.push("Jira integration not configured; ticket IDs found in references only.");
    }

    if (timeline.linkedPR && timeline.jiraTicket) {
      timeline.completeness = "full";
    } else if (timeline.linkedPR || timeline.jiraTicket || timeline.slackThread) {
      timeline.completeness = "partial";
    }

    timeline.chronology.sort((a, b) => a.date.localeCompare(b.date));
    return timeline;
  }

  private async findOriginalIntroduction(
    coords: RepoCoordinates,
    file: string,
    blameLines: BlameLine[],
    lineRange?: LineRange
  ): Promise<CommitInfo | undefined> {
    const uniqueShas = [...new Set(blameLines.map((line) => line.commitSha))];
    if (uniqueShas.length === 0) {
      return undefined;
    }

    const commits: CommitInfo[] = [];

    for (const sha of uniqueShas) {
      const detail = await this.fetchCommitDetail(coords, sha).catch(() => undefined);
      if (detail) {
        commits.push(detail);
      }
    }

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
    const history = await this.options.codeHostRouter.getFileHistory(file, 100, coords).catch(() => []);
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
    const creds = await this.options.codeHostSecrets.getCredentials();
    if (!creds.githubToken) {
      // TODO: Cloud mode — commit→PR linking needs a backend proxy for GET /repos/{owner}/{repo}/commits/{sha}/pulls.
      return undefined;
    }
    const url = `https://api.github.com/repos/${encodeURIComponent(coords.owner)}/${encodeURIComponent(coords.repo)}/commits/${sha}/pulls`;
    const pulls = await codeHostRequestJson<Array<{ number: number }>>(url, {
      headers: githubHeaders(creds.githubToken),
      provider: "github"
    }).catch(() => []);
    return pulls[0]?.number;
  }

  private async fetchPullRequest(
    coords: RepoCoordinates,
    prNumber: number,
    file: string
  ): Promise<PullRequestDetail> {
    if (coords.provider === "github") {
      const creds = await this.options.codeHostSecrets.getCredentials();
      if (creds.githubToken) {
        return this.fetchGithubPullRequestViaRest(coords, prNumber);
      }
    }

    const prs = await this.options.codeHostRouter.getPRsForFile(file, 50, coords);
    const summary = prs.find((pr) => pr.number === prNumber);
    if (!summary) {
      throw new Error(`Pull request #${prNumber} not found.`);
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
      labels: []
    };
  }

  private async fetchGithubPullRequestViaRest(
    coords: RepoCoordinates,
    prNumber: number
  ): Promise<GitHubPullDetail> {
    const creds = await this.options.codeHostSecrets.getCredentials();
    if (!creds.githubToken) {
      throw new Error("GitHub token required for PR details.");
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
      headers: githubHeaders(creds.githubToken),
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

  private async correlateSlack(
    timeline: DecisionTimeline,
    slack: SlackClient,
    prNumber: number | undefined,
    issueKeys: string[],
    prBody: string
  ): Promise<void> {
    const slackUrl = extractSlackThreadUrl(prBody);
    if (slackUrl) {
      const parsed = slack.parseSlackThreadUrl(slackUrl);
      if (parsed) {
        try {
          const channel = await slack.getChannelInfo(parsed.channelId);
          const thread = await slack.getThread(parsed.channelId, parsed.threadTs);
          this.applySlackThread(timeline, thread, channel.name, slackUrl);
          this.ingestSlackSignals(timeline, slack, thread);
          return;
        } catch (error) {
          timeline.warnings.push(`Slack thread URL found but could not be loaded: ${errorMessage(error)}`);
        }
      }
    }

    const queries = [
      prNumber ? `PR #${prNumber}` : undefined,
      prNumber ? `pull/${prNumber}` : undefined,
      ...issueKeys
    ].filter(Boolean) as string[];

    for (const query of queries) {
      try {
        const hits = await slack.searchMessages(query, { limit: 5 });
        const hit = hits.find((h) => h.threadTs || h.text.length > 20);
        if (!hit?.channelId) {
          continue;
        }
        const threadTs = hit.threadTs ?? hit.ts;
        const thread = await slack.getThread(hit.channelId, threadTs);
        this.applySlackThread(timeline, thread, hit.channelName, hit.permalink);
        this.ingestSlackSignals(timeline, slack, thread);
        return;
      } catch {
        /* try next query */
      }
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
    permalink?: string
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
      participants: thread.participants
    };
  }

  private async correlateTeams(
    timeline: DecisionTimeline,
    teams: TeamsClient,
    prNumber: number | undefined,
    issueKeys: string[]
  ): Promise<void> {
    const queries = [prNumber ? `PR ${prNumber}` : undefined, ...issueKeys].filter(Boolean) as string[];
    for (const query of queries) {
      try {
        const hits = await teams.searchMessages(query, { limit: 5 });
        const hit = hits[0];
        if (!hit?.teamId || !hit.channelId || !hit.messageId) {
          continue;
        }
        const thread = await teams.getThread(hit.teamId, hit.channelId, hit.messageId);
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
  }

  private async correlateJira(timeline: DecisionTimeline, jira: JiraClient, issueKey: string): Promise<void> {
    try {
      const issue = await jira.getIssue(issueKey);
      timeline.jiraTicket = {
        key: issue.key,
        epic: issue.epicName ?? issue.epicKey,
        summary: issue.summary,
        description: issue.description ?? "",
        acceptanceCriteria: issue.acceptanceCriteria,
        technicalDebt: issue.technicalDebt,
        htmlUrl: issue.htmlUrl
      };
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
    if (!creds.jiraToken || !creds.jiraEmail) {
      return undefined;
    }
    return new JiraClient({
      baseUrl: creds.jiraBaseUrl ?? "https://your-domain.atlassian.net",
      email: creds.jiraEmail,
      apiToken: creds.jiraToken
    });
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
