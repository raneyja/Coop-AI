import { codeHostRequestJson } from "./codeHostHttp";
import type { CodeHostRouter } from "./codeHostRouter";
import type { CommitInfo, PullRequestReview, RepoCoordinates } from "./types";
import type {
  ActivityWindow,
  CommitPatternStats,
  IssueOwnershipStats,
  OrgTeamContext,
  OwnerMessageContext,
  OwnerMessageDraft,
  OwnershipEvolution,
  OwnershipReport,
  OwnershipRisk,
  OwnershipScore,
  OwnershipSignals,
  OwnershipTier,
  ReviewAuthorityStats,
  TeamDomainGraph,
  TeamMemberRole
} from "../../types/ownership";

const MS_DAY = 86_400_000;
const MS_30D = 30 * MS_DAY;
const MS_90D = 90 * MS_DAY;
const MS_180D = 180 * MS_DAY;
const MS_365D = 365 * MS_DAY;
const MS_3Y = 3 * MS_365D;

export type ScoreWeights = {
  commit: number;
  review: number;
  issue: number;
};

export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = {
  commit: 1,
  review: 2.5,
  issue: 1.5
};

export type SpecialtyBucket = {
  label: string;
  keywords: RegExp;
};

export const SPECIALTY_BUCKETS: SpecialtyBucket[] = [
  { label: "async/networking", keywords: /\b(async|await|network|socket|http|grpc|websocket|tcp|udp)\b/i },
  { label: "database/migrations", keywords: /\b(migration|schema|sql|postgres|mysql|database|orm|prisma)\b/i },
  { label: "security/auth", keywords: /\b(auth|oauth|jwt|security|encrypt|permission|rbac|acl)\b/i },
  { label: "frontend/ui", keywords: /\b(ui|react|vue|css|component|frontend|webview|tailwind)\b/i },
  { label: "devops/infra", keywords: /\b(docker|k8s|kubernetes|ci|cd|deploy|terraform|infra)\b/i },
  { label: "testing", keywords: /\b(test|spec|mock|fixture|coverage|jest|vitest)\b/i },
  { label: "performance", keywords: /\b(perf|cache|latency|optimize|benchmark|memory)\b/i }
];

export type GitHubRepoTeam = {
  name: string;
  slug: string;
  htmlUrl?: string;
  members?: string[];
};

export type CodeownersMatch = {
  owners: string[];
  pattern: string;
};

export function authorKey(commit: CommitInfo): string {
  return commit.authorLogin ?? commit.author;
}

export function analyzeCommitPatterns(commits: CommitInfo[], now = Date.now()): CommitPatternStats[] {
  const byAuthor = new Map<string, CommitPatternStats>();

  for (const commit of commits) {
    const author = authorKey(commit);
    const entry = byAuthor.get(author) ?? {
      author,
      authorLogin: commit.authorLogin,
      counts: { sixMonths: 0, oneYear: 0, allTime: 0 },
      recencyScore: 0,
      messages: []
    };
    if (commit.authorLogin && !entry.authorLogin) {
      entry.authorLogin = commit.authorLogin;
    }
    const age = now - new Date(commit.date).getTime();
    entry.counts.allTime += 1;
    if (age <= MS_180D) {
      entry.counts.sixMonths += 1;
    }
    if (age <= MS_365D) {
      entry.counts.oneYear += 1;
    }
    entry.recencyScore += recencyWeightForAge(age);
    if (!entry.lastCommitDate || commit.date > entry.lastCommitDate) {
      entry.lastCommitDate = commit.date;
    }
    if (entry.messages.length < 20) {
      entry.messages.push(commit.message);
    }
    byAuthor.set(author, entry);
  }

  return [...byAuthor.values()].sort((a, b) => b.counts.allTime - a.counts.allTime);
}

export function analyzeReviewAuthority(
  reviews: Array<{ author: string; state: string; submittedAt: string; prAuthor?: string }>
): ReviewAuthorityStats[] {
  const byAuthor = new Map<string, ReviewAuthorityStats>();
  const now = Date.now();

  for (const review of reviews) {
    const author = review.author;
    const entry = byAuthor.get(author) ?? {
      author,
      approvals: 0,
      reviews: 0,
      recencyScore: 0,
      isReviewerOnly: true
    };
    entry.reviews += 1;
    if (/approved/i.test(review.state)) {
      entry.approvals += 1;
    }
    const age = now - new Date(review.submittedAt).getTime();
    entry.recencyScore += recencyWeightForAge(age) * ( /approved/i.test(review.state) ? 2 : 1);
    if (!entry.lastReviewDate || review.submittedAt > entry.lastReviewDate) {
      entry.lastReviewDate = review.submittedAt;
    }
    if (review.prAuthor && review.prAuthor === author) {
      entry.isReviewerOnly = false;
    }
    byAuthor.set(author, entry);
  }

  for (const entry of byAuthor.values()) {
    if (entry.approvals > 0 && entry.reviews === entry.approvals) {
      entry.isReviewerOnly = true;
    }
  }

  return [...byAuthor.values()].sort((a, b) => b.approvals - a.approvals);
}

export function analyzeIssueOwnership(issues: IssueOwnershipStats[]): IssueOwnershipStats[] {
  return [...issues].sort((a, b) => b.assigned + b.resolved - (a.assigned + a.resolved));
}

export function buildActivityWindows(
  commits: CommitPatternStats[],
  reviews: ReviewAuthorityStats[],
  issues: IssueOwnershipStats[],
  now = Date.now()
): ActivityWindow[] {
  const lastActive = new Map<string, string>();

  for (const c of commits) {
    if (c.lastCommitDate) {
      lastActive.set(c.author, maxDate(lastActive.get(c.author), c.lastCommitDate));
    }
  }
  for (const r of reviews) {
    if (r.lastReviewDate) {
      lastActive.set(r.author, maxDate(lastActive.get(r.author), r.lastReviewDate));
    }
  }
  for (const i of issues) {
    if (i.lastActivityDate) {
      lastActive.set(i.author, maxDate(lastActive.get(i.author), i.lastActivityDate));
    }
  }

  const authors = new Set([...commits.map((c) => c.author), ...reviews.map((r) => r.author), ...issues.map((i) => i.author)]);

  return [...authors].map((author) => {
    const date = lastActive.get(author);
    const weight = activityWeightForDate(date, now);
    return {
      author,
      lastActiveDate: date,
      weight,
      inactive: weight === 0
    };
  });
}

export function detectSpecialties(commits: CommitPatternStats[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const commit of commits) {
    const hits = new Map<string, number>();
    for (const msg of commit.messages) {
      for (const bucket of SPECIALTY_BUCKETS) {
        if (bucket.keywords.test(msg)) {
          hits.set(bucket.label, (hits.get(bucket.label) ?? 0) + 1);
        }
      }
    }
    const top = [...hits.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] >= 2) {
      result.set(commit.author, top[0]);
    }
  }
  return result;
}

export function calculateOwnershipScores(
  signals: OwnershipSignals,
  weights: ScoreWeights = DEFAULT_SCORE_WEIGHTS,
  now = Date.now()
): OwnershipScore[] {
  const commitMap = new Map(signals.commits.map((c) => [c.author, c]));
  const reviewMap = new Map(signals.reviews.map((r) => [r.author, r]));
  const issueMap = new Map(signals.issues.map((i) => [i.author, i]));
  const activityMap = new Map(signals.activity.map((a) => [a.author, a]));
  const specialtyMap = detectSpecialties(signals.commits);

  const authors = new Set([
    ...signals.commits.map((c) => c.author),
    ...signals.reviews.map((r) => r.author),
    ...signals.issues.map((i) => i.author)
  ]);

  const rawScores: Array<{
    author: string;
    authorLogin?: string;
    raw: number;
    commitCount: number;
    reviewApprovals: number;
    issueResolutions: number;
    activityWeight: number;
    role: OwnershipScore["role"];
  }> = [];

  for (const author of authors) {
    const activity = activityMap.get(author);
    if (activity?.inactive) {
      continue;
    }

    const commit = commitMap.get(author);
    const review = reviewMap.get(author);
    const issue = issueMap.get(author);
    const activityWeight = activity?.weight ?? 1;

    const commitCount = (commit?.counts.sixMonths ?? 0) * (commit?.recencyScore ?? 0);
    const reviewApprovals = (review?.approvals ?? 0) * (review?.recencyScore ?? 0);
    const issueResolutions = ((issue?.assigned ?? 0) + (issue?.resolved ?? 0)) * 1.5;

    const raw =
      (commitCount * weights.commit + reviewApprovals * weights.review + issueResolutions * weights.issue) *
      activityWeight;

    if (raw <= 0) {
      continue;
    }

    const isAuthor = Boolean(commit && commit.counts.allTime > 0);
    const isReviewer = Boolean(review && review.approvals > 0);
    const role: OwnershipScore["role"] = isAuthor && isReviewer ? "both" : isReviewer ? "reviewer" : "author";

    rawScores.push({
      author,
      authorLogin: commit?.authorLogin,
      raw,
      commitCount: commit?.counts.sixMonths ?? 0,
      reviewApprovals: review?.approvals ?? 0,
      issueResolutions: (issue?.assigned ?? 0) + (issue?.resolved ?? 0),
      activityWeight,
      role
    });
  }

  const maxRaw = Math.max(...rawScores.map((s) => s.raw), 1);
  const scores: OwnershipScore[] = rawScores
    .map((entry) => {
      const score = Math.round((entry.raw / maxRaw) * 100);
      return {
        owner: entry.author,
        githubLogin: entry.authorLogin,
        score,
        tier: tierForScore(score),
        specialty: specialtyMap.get(entry.author),
        commitCount: entry.commitCount,
        reviewApprovals: entry.reviewApprovals,
        issueResolutions: entry.issueResolutions,
        activityWeight: entry.activityWeight,
        role: entry.role
      };
    })
    .sort((a, b) => b.score - a.score);

  return scores;
}

export function computeOwnershipRisk(
  scores: OwnershipScore[],
  commits: CommitInfo[],
  activity: ActivityWindow[],
  now = Date.now()
): OwnershipRisk {
  const experts = scores.filter((s) => s.tier === "primary" || s.tier === "secondary");
  const activeExperts = experts.filter((s) => {
    const act = activity.find((a) => a.author === s.owner);
    return act && !act.inactive;
  });

  const sixMonthsAgo = now - MS_180D;
  const recentCommits = commits.filter((c) => new Date(c.date).getTime() >= sixMonthsAgo);
  const authorSet = new Set(commits.map(authorKey));

  const primaryCount = scores.filter((s) => s.tier === "primary").length;
  const secondaryCount = scores.filter((s) => s.tier === "secondary").length;

  const inactiveThreshold = now - 90 * MS_DAY;
  const allExpertsInactive =
    experts.length > 0 &&
    experts.every((s) => {
      const act = activity.find((a) => a.author === s.owner);
      if (!act?.lastActiveDate) {
        return true;
      }
      return new Date(act.lastActiveDate).getTime() < inactiveThreshold;
    });

  return {
    singlePointOfFailure: primaryCount === 1 && secondaryCount === 0,
    expertUnavailable: allExpertsInactive,
    orphaned: recentCommits.length === 0,
    highTurnover: authorSet.size >= 5 && primaryCount === 0,
    teamDispersion: activeExperts.length >= 3 && primaryCount === 0
  };
}

export function buildTeamDomainGraph(
  scores: OwnershipScore[],
  activity: ActivityWindow[] = []
): TeamDomainGraph {
  const primary = scores.find((s) => s.tier === "primary");
  const secondary = scores.filter((s) => s.tier === "secondary");
  const backup = scores.filter((s) => s.tier === "familiar" || (s.tier === "secondary" && s !== secondary[0]));

  const members: TeamMemberRole[] = scores.slice(0, 8).map((s, index) => {
    const act = activity.find((a) => a.author === s.owner);
    let role: TeamMemberRole["role"] = "contributor";
    if (s.tier === "primary") {
      role = "primary";
    } else if (s.tier === "secondary" && index <= 2) {
      role = "secondary";
    } else if (s.tier === "familiar" || s.tier === "secondary") {
      role = "backup";
    }
    return {
      owner: s.owner,
      role,
      score: s.score,
      available: act ? !act.inactive : true
    };
  });

  let escalationPath = "No clear escalation path identified.";
  if (primary) {
    const backupOwner = secondary[0] ?? backup[0];
    if (backupOwner && backupOwner.owner !== primary.owner) {
      escalationPath = `If @${primary.owner} is unavailable, reach out to @${backupOwner.owner} next.`;
    } else {
      escalationPath = `@${primary.owner} is the primary contact; no strong backup identified.`;
    }
  } else if (secondary[0]) {
    escalationPath = `No primary owner; @${secondary[0].owner} has the most context.`;
  }

  return { members, escalationPath };
}

export function buildOwnershipEvolution(commits: CommitInfo[], now = Date.now()): OwnershipEvolution[] {
  const buckets: Array<{ period: string; label: string; since: number }> = [
    { period: "3y", label: "3 years ago", since: now - MS_3Y },
    { period: "1y", label: "1 year ago", since: now - MS_365D },
    { period: "quarter", label: "Last quarter", since: now - 90 * MS_DAY },
    { period: "now", label: "Current", since: now - MS_180D }
  ];

  return buckets.map((bucket, index) => {
    const nextSince = buckets[index + 1]?.since ?? 0;
    const inBucket = commits.filter((c) => {
      const t = new Date(c.date).getTime();
      return t >= bucket.since && (index === 0 || t < (buckets[index - 1]?.since ?? Infinity));
    });
    const ranked = rankAuthors(inBucket);
    const primary = ranked[0]?.author ?? "unknown";
    const secondaryOwners = ranked.slice(1, 4).map((r) => r.author);
    const share = ranked[0] ? Math.round((ranked[0].count / Math.max(inBucket.length, 1)) * 100) : 0;
    const narrative =
      ranked.length === 0
        ? "No commits in this period."
        : `${primary} was primary (${share}% of commits)${secondaryOwners.length ? `; ${secondaryOwners.join(", ")} contributed` : ""}.`;
    return {
      period: bucket.period,
      label: bucket.label,
      primaryOwner: primary,
      secondaryOwners,
      narrative
    };
  });
}

export function draftOwnerMessage(report: OwnershipReport, context: OwnerMessageContext = {}): OwnerMessageDraft {
  const primary = report.scores.find((s) => s.tier === "primary") ?? report.scores[0];
  const recipient = primary?.owner ?? "team";
  const moduleName = context.moduleName ?? report.path.split("/").pop() ?? report.path;
  const brief = context.briefContext ?? context.userQuestion ?? "a change in this area";

  const commitPart =
    primary && primary.commitCount > 0 ? `${primary.commitCount}+ commits in last 6 months` : "recent activity on this path";
  const reviewPart =
    primary && primary.reviewApprovals > 0 ? `, ${primary.reviewApprovals} approved PRs` : "";

  const text = `@${recipient} I noticed you're the primary maintainer of this area (${commitPart}${reviewPart}).
I have a question about ${moduleName}: ${brief}
Are you available for a quick discussion?`;

  return { recipient, text };
}

export function parseCodeowners(content: string, targetPath: string): CodeownersMatch | undefined {
  const normalized = targetPath.replace(/^\/+/, "");
  const lines = content.split("\n");
  let best: CodeownersMatch | undefined;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const parts = trimmed.split(/\s+/);
    const pattern = parts[0];
    const owners = parts.slice(1).map((o) => o.replace(/^@/, ""));
    if (owners.length === 0) {
      continue;
    }
    if (codeownersPatternMatches(pattern, normalized)) {
      best = { owners, pattern };
    }
  }
  return best;
}

export async function fetchRepoTeams(
  owner: string,
  repo: string,
  token: string
): Promise<GitHubRepoTeam[]> {
  try {
    const teams = await codeHostRequestJson<
      Array<{ name: string; slug: string; html_url?: string; permission?: string }>
    >(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/teams`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "coop-ai-extension"
      },
      provider: "github"
    });
    return teams.map((team) => ({
      name: team.name,
      slug: team.slug,
      htmlUrl: team.html_url
    }));
  } catch {
    return [];
  }
}

export async function fetchPullRequestReviews(
  router: CodeHostRouter,
  coords: RepoCoordinates,
  prNumber: number
): Promise<PullRequestReview[]> {
  return router.getPullRequestReviews(prNumber, coords);
}

export function buildOrgContextFromCodeowners(
  match: CodeownersMatch,
  teams: GitHubRepoTeam[]
): OrgTeamContext | undefined {
  const teamOwner = match.owners.find((o) => teams.some((t) => t.slug === o || t.name === o));
  const team = teams.find((t) => t.slug === teamOwner || t.name === teamOwner);
  if (team) {
    return {
      teamName: team.name,
      teamSlug: team.slug,
      members: team.members ?? match.owners,
      htmlUrl: team.htmlUrl,
      source: "github_teams"
    };
  }
  return {
    teamName: match.owners.join(", "),
    members: match.owners,
    source: "codeowners"
  };
}

export function issuesFromSummaries(
  issues: Array<{
    assignee?: string;
    closedBy?: string;
    author?: string;
    updatedAt: string;
    state: string;
    body?: string;
    title: string;
  }>,
  path: string
): IssueOwnershipStats[] {
  const needle = path.toLowerCase();
  const byAuthor = new Map<string, IssueOwnershipStats>();

  for (const issue of issues) {
    const relevant =
      issue.title.toLowerCase().includes(needle) ||
      issue.body?.toLowerCase().includes(needle);
    if (!relevant) {
      continue;
    }
    const contributors = [issue.assignee, issue.closedBy, issue.author].filter(Boolean) as string[];
    for (const author of contributors) {
      const entry = byAuthor.get(author) ?? {
        author,
        assigned: 0,
        resolved: 0,
        lastActivityDate: issue.updatedAt
      };
      if (issue.assignee === author) {
        entry.assigned += 1;
      }
      if (issue.closedBy === author && issue.state === "closed") {
        entry.resolved += 1;
      }
      entry.lastActivityDate = maxDate(entry.lastActivityDate, issue.updatedAt);
      byAuthor.set(author, entry);
    }
  }

  return [...byAuthor.values()];
}

function tierForScore(score: number): OwnershipTier {
  if (score > 60) {
    return "primary";
  }
  if (score > 30) {
    return "secondary";
  }
  return "familiar";
}

function recencyWeightForAge(ageMs: number): number {
  if (ageMs <= MS_30D) {
    return 10;
  }
  if (ageMs <= MS_90D) {
    return 5;
  }
  if (ageMs <= MS_180D) {
    return 2;
  }
  return 0;
}

export function activityWeightForDate(date: string | undefined, now: number): number {
  if (!date) {
    return 0;
  }
  return recencyWeightForAge(now - new Date(date).getTime());
}

function rankAuthors(commits: CommitInfo[]): Array<{ author: string; count: number }> {
  const counts = new Map<string, number>();
  for (const commit of commits) {
    const author = authorKey(commit);
    counts.set(author, (counts.get(author) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([author, count]) => ({ author, count }))
    .sort((a, b) => b.count - a.count);
}

function maxDate(a: string | undefined, b: string): string {
  if (!a) {
    return b;
  }
  return a > b ? a : b;
}

function codeownersPatternMatches(pattern: string, path: string): boolean {
  if (pattern === "*") {
    return true;
  }
  let regex = pattern
    .replace(/\./g, "\\.")
    .replace(/\*\*/g, "§§")
    .replace(/\*/g, "[^/]*")
    .replace(/§§/g, ".*");
  if (regex.endsWith("/")) {
    regex = `${regex}.*`;
  }
  if (!regex.startsWith("/") && !regex.startsWith(".*")) {
    regex = `(^|/)${regex}`;
  }
  try {
    return new RegExp(`^${regex}$`).test(path) || path.startsWith(pattern.replace(/^\//, ""));
  } catch {
    return path.includes(pattern.replace(/^\//, ""));
  }
}
