export type QuickActionId =
  | "understand-repo"
  | "trace-decision"
  | "find-owner"
  | "blast-radius"
  | "knowledge-gaps";

export type RepoContextFileSource = "workspace" | "git" | "remote" | "external";

export type CodeHostProviderPreference = "github" | "gitlab" | "bitbucket";

export type RepoContext = {
  provider?: CodeHostProviderPreference;
  owner?: string;
  repo?: string;
  branch?: string;
  scope?: "repo" | "file";
  file?: string;
  fileSource?: RepoContextFileSource;
  contextWarning?: string;
  selectedLines?: [number, number];
  languageId?: string;
};

export type IntentFeedbackState = {
  status: "idle" | "loading" | "warning" | "rate-limited" | "complete" | "error";
  intent?: string;
  actionId?: string;
  title: string;
  message?: string;
  /** Rotating status lines while context is loading. */
  activityMessages?: string[];
  progress?: number;
  stale?: boolean;
};

export type ConflictActionId = "accept-authoritative" | "dismiss" | "escalate";

export type ConflictSummary = {
  id: string;
  type: string;
  severity: "low" | "medium" | "high" | "critical";
  title: string;
  message: string;
  recommendation: string;
  authoritative: {
    source: string;
    value: unknown;
    score: number;
    reason: string;
  };
  alternatives: Array<{
    source: string;
    value: unknown;
    score: number;
  }>;
  actionRequired: boolean;
  detectedAt: string;
  file?: string;
  repoId?: string;
};

export type ConflictResolutionState = {
  status: "idle" | "detected" | "resolved";
  conflicts: ConflictSummary[];
  updatedAt: string;
};

export type JobProgressState = {
  jobId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled" | "partial";
  title: string;
  message?: string;
  progress: number;
  estimatedWaitTime?: string;
  estimatedTimeRemaining?: string;
  deliverable?: "chat" | "standalone";
  showViewResults?: boolean;
  resultSummary?: {
    foundGaps?: number;
    highPriority?: number;
    mediumPriority?: number;
    lowPriority?: number;
  };
};

export type DegradationNotificationPayload = {
  id: string;
  severity: "info" | "warning" | "critical";
  title: string;
  message: string;
  provider?: string;
  feature?: string;
  action?: "retry" | "refresh";
};
