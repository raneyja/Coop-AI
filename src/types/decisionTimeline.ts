export type LineRange = { start: number; end: number };

export type DecisionCommit = {
  sha: string;
  author: string;
  date: string;
  message: string;
  htmlUrl?: string;
  /** Short Sources expand overview (AI or deterministic) — never the full body. */
  overview?: string;
};

export type DecisionReview = {
  id: string;
  author: string;
  body: string;
  path?: string;
  line?: number;
  createdAt: string;
  kind: "review" | "conversation";
};

export type DecisionAlternative = {
  option: string;
  reason_rejected: string;
  proposed_by: string;
  source: string;
};

export type DecisionSlackThread = {
  channelId: string;
  channelName?: string;
  threadTs: string;
  permalink?: string;
  messages: Array<{ user: string; text: string; ts: string }>;
  participants: string[];
  /** How confidently this thread relates to the traced code (weak matches are not attached). */
  relevance?: "direct" | "linked";
  /** Short Sources expand overview — never full thread dump. */
  overview?: string;
};

export type DecisionTeamsThread = {
  teamId: string;
  channelId: string;
  rootMessageId: string;
  messages: Array<{ user: string; text: string; date: string }>;
  participants: string[];
  /** Short Sources expand overview — never full thread dump. */
  overview?: string;
};

export type DecisionJiraTicket = {
  key: string;
  epic?: string;
  summary: string;
  description: string;
  acceptanceCriteria: string[];
  technicalDebt: boolean;
  htmlUrl: string;
  /** Short Sources expand overview — never full description dump. */
  overview?: string;
};

export type ChronologyEvent = {
  date: string;
  actor: string;
  event: string;
  evidence: string;
};

export type DecisionIntroducingDiffSummary = {
  filesChanged: number;
  insertions?: number;
  deletions?: number;
  /** Human-readable 1-2 sentence summary of the introducing change. */
  summary: string;
  /** Short excerpt of what was added in the introducing patch. */
  patchExcerpt?: string;
};

export type DecisionEvolution = {
  commitCountSinceIntroduction: number;
  lastModifiedAt?: string;
  lastModifiedAuthor?: string;
  /** Newest post-introduction commits (full-file traces) — already fetched with history. */
  recentCommits?: DecisionCommit[];
};

export type DecisionRationaleRank = {
  source: string;
  role: "rationale" | "provenance" | "background";
  label: string;
};

export type DecisionIntegrationSearch = {
  jira?: {
    issues: Array<{ key: string; summary: string; status: string; htmlUrl?: string }>;
    error?: string;
    matchStrategy?: string;
  };
  confluence?: {
    pages: Array<{ id: string; title: string; excerpt?: string; htmlUrl: string }>;
    error?: string;
  };
  notion?: {
    pages: Array<{ id: string; title: string; url?: string }>;
    error?: string;
  };
  googleDocs?: {
    documents: Array<{ id: string; title: string; url?: string }>;
    error?: string;
  };
  slack?: {
    messages: Array<{ channelName?: string; userName?: string; text: string; permalink?: string }>;
    error?: string;
    query?: string;
  };
  teams?: {
    messages: Array<{ text: string; fromUserName?: string }>;
    error?: string;
  };
  seedJiraKeys?: string[];
  seedSearchTerms?: string[];
};

export type DecisionTimeline = {
  file: string;
  /** Active Use-repo code host for this trace (GitHub / GitLab / Bitbucket). */
  provider?: import("../api/codeHosts/types").CodeHostProvider;
  targetLabel?: string;
  lineRange?: LineRange;
  codeSnippet?: string;
  /** First commit that introduced the file/selection (provenance / birth). */
  originalCommit?: DecisionCommit;
  /**
   * Commit used for PR/discussion enrichment and primary rationale.
   * Full-file traces prefer a recent evolution commit; line traces keep blame introduction.
   */
  focusCommit?: DecisionCommit;
  /**
   * How strongly focusCommit matches the user's ask.
   * aligned = message/symbol hit; weak = no ask match (do not force as "why");
   * unknown = no concrete ask terms.
   */
  focusDecisionQuality?: "aligned" | "weak" | "unknown";
  /** Mega drive-by focus — provenance only; never sole rationale under a concrete ask. */
  focusIsMegaDriveBy?: boolean;
  introducingDiffSummary?: DecisionIntroducingDiffSummary;
  evolution?: DecisionEvolution;
  rationaleRanking?: DecisionRationaleRank[];
  linkedPR?: {
    number: number;
    title: string;
    description: string;
    state: string;
    labels: string[];
    htmlUrl?: string;
    reviews: DecisionReview[];
    approvers: string[];
    updatedAt?: string;
    /** Short Sources expand overview — never full PR body dump. */
    overview?: string;
  };
  alternatives: DecisionAlternative[];
  slackThread?: DecisionSlackThread;
  teamsThread?: DecisionTeamsThread;
  jiraTickets?: DecisionJiraTicket[];
  integrationSearch?: DecisionIntegrationSearch;
  chronology: ChronologyEvent[];
  warnings: string[];
  fallbackMessage?: string;
  completeness: "full" | "partial" | "minimal";
};
