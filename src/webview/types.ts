export type QuickActionId =
  | "understand-repo"
  | "trace-decision"
  | "find-owner"
  | "blast-radius"
  | "knowledge-gaps";

export type RepoContext = {
  owner?: string;
  repo?: string;
  branch?: string;
  file?: string;
  selectedLines?: [number, number];
  languageId?: string;
};

export type IntentFeedbackState = {
  status: "idle" | "loading" | "warning" | "rate-limited" | "complete" | "error";
  intent?: string;
  actionId?: string;
  title: string;
  message?: string;
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

export type IntegrationHealthPayload = {
  provider: string;
  status: "healthy" | "degraded" | "offline";
  lastCheck: string;
  error?: string;
  recoveryStrategy: "retry" | "cache" | "skip";
  latency?: number;
  errorRate?: number;
};

export type DegradationFeatureStatusPayload = {
  feature: string;
  canonicalFeature: string;
  level: "full" | "partial" | "cached" | "unavailable";
  label: string;
  message: string;
  required: string[];
  optional: string[];
  unavailableProviders: string[];
  degradedProviders: string[];
};

export type JobProgressState = {
  jobId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled" | "partial";
  title: string;
  message?: string;
  progress: number;
  estimatedWaitTime?: string;
  estimatedTimeRemaining?: string;
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
