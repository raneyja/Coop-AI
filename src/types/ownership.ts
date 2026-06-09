export type OwnershipTier = "primary" | "secondary" | "familiar";

export type MapOwnershipParams = {
  provider?: import("../api/codeHosts/types").CodeHostProvider;
  owner: string;
  repo: string;
  path: string;
  branch?: string;
  isDirectory?: boolean;
};

export type TimeBucketCounts = {
  sixMonths: number;
  oneYear: number;
  allTime: number;
};

export type CommitPatternStats = {
  author: string;
  authorLogin?: string;
  counts: TimeBucketCounts;
  recencyScore: number;
  lastCommitDate?: string;
  messages: string[];
};

export type ReviewAuthorityStats = {
  author: string;
  approvals: number;
  reviews: number;
  recencyScore: number;
  lastReviewDate?: string;
  isReviewerOnly: boolean;
};

export type IssueOwnershipStats = {
  author: string;
  assigned: number;
  resolved: number;
  lastActivityDate?: string;
};

export type ActivityWindow = {
  author: string;
  lastActiveDate?: string;
  weight: number;
  inactive: boolean;
};

export type SpecialtySignal = {
  author: string;
  specialty: string;
  keywordHits: number;
};

export type SlackPresenceState = "active" | "away" | "dnd" | "offline" | "unknown";

export type SlackPresenceStatus = {
  state: SlackPresenceState;
  label: string;
  timezone?: string;
  lastActive?: string;
  slackUserId?: string;
};

export type OwnershipScore = {
  owner: string;
  githubLogin?: string;
  score: number;
  tier: OwnershipTier;
  specialty?: string;
  commitCount: number;
  reviewApprovals: number;
  issueResolutions: number;
  activityWeight: number;
  presence?: SlackPresenceStatus;
  role: "author" | "reviewer" | "both";
};

export type OwnershipRisk = {
  singlePointOfFailure: boolean;
  expertUnavailable: boolean;
  orphaned: boolean;
  highTurnover: boolean;
  teamDispersion: boolean;
};

export type OwnershipEvolution = {
  period: string;
  label: string;
  primaryOwner: string;
  secondaryOwners: string[];
  narrative: string;
};

export type TeamMemberRole = {
  owner: string;
  role: "primary" | "secondary" | "backup" | "contributor";
  score: number;
  available: boolean;
};

export type TeamDomainGraph = {
  members: TeamMemberRole[];
  escalationPath: string;
  crossTeamNote?: string;
};

export type OrgTeamContext = {
  teamName: string;
  teamSlug?: string;
  members: string[];
  manager?: string;
  slackChannel?: string;
  htmlUrl?: string;
  source: "codeowners" | "github_teams";
};

export type OwnerMessageDraft = {
  recipient: string;
  text: string;
  subject?: string;
};

export type OwnershipCompleteness = "full" | "partial" | "minimal";

export type OwnershipSignals = {
  commits: CommitPatternStats[];
  reviews: ReviewAuthorityStats[];
  issues: IssueOwnershipStats[];
  activity: ActivityWindow[];
  specialties: SpecialtySignal[];
  graphCachePrimary?: string;
  graphCacheSecondaries?: string[];
};

export type OwnershipReport = {
  path: string;
  owner: string;
  repo: string;
  scores: OwnershipScore[];
  teamGraph: TeamDomainGraph;
  orgContext?: OrgTeamContext;
  risk: OwnershipRisk;
  history: OwnershipEvolution[];
  messageDraft: OwnerMessageDraft;
  warnings: string[];
  completeness: OwnershipCompleteness;
  signals?: OwnershipSignals;
};

export type OwnerMessageContext = {
  moduleName?: string;
  briefContext?: string;
  userQuestion?: string;
};
