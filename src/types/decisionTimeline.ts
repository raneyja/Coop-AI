export type LineRange = { start: number; end: number };

export type DecisionCommit = {
  sha: string;
  author: string;
  date: string;
  message: string;
  htmlUrl?: string;
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
};

export type DecisionTeamsThread = {
  teamId: string;
  channelId: string;
  rootMessageId: string;
  messages: Array<{ user: string; text: string; date: string }>;
  participants: string[];
};

export type DecisionJiraTicket = {
  key: string;
  epic?: string;
  summary: string;
  description: string;
  acceptanceCriteria: string[];
  technicalDebt: boolean;
  htmlUrl: string;
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
};

export type DecisionRationaleRank = {
  source: string;
  role: "rationale" | "provenance" | "background";
  label: string;
};

export type DecisionTimeline = {
  file: string;
  targetLabel?: string;
  lineRange?: LineRange;
  codeSnippet?: string;
  originalCommit?: DecisionCommit;
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
  };
  alternatives: DecisionAlternative[];
  slackThread?: DecisionSlackThread;
  teamsThread?: DecisionTeamsThread;
  jiraTickets?: DecisionJiraTicket[];
  chronology: ChronologyEvent[];
  warnings: string[];
  fallbackMessage?: string;
  completeness: "full" | "partial" | "minimal";
};
