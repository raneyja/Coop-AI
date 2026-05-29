import type { ConflictSeverity, SourceSystem } from "../conflicts/conflictDetector";

export type ConflictTrustOrder = {
  ownership: SourceSystem[];
  decision: SourceSystem[];
  implementation: SourceSystem[];
};

export type ConflictConfig = {
  detectAndSurface: boolean;
  autoResolve: boolean;
  severityThreshold: ConflictSeverity;
  trustOrder: ConflictTrustOrder;
  auditTrail: boolean;
};

export type ConflictConfigInput = Partial<{
  detectAndSurface: boolean;
  autoResolve: boolean;
  severityThreshold: ConflictSeverity;
  trustOrder: Partial<ConflictTrustOrder>;
  auditTrail: boolean;
}>;

export const DEFAULT_CONFLICT_CONFIG: ConflictConfig = {
  detectAndSurface: true,
  autoResolve: false,
  severityThreshold: "medium",
  trustOrder: {
    ownership: ["github_commit_history", "slack_active_contributors", "jira_assignee"],
    decision: ["slack_recent_thread", "pr_comments", "actual_code"],
    implementation: ["actual_code", "pr_comments", "slack_thread"]
  },
  auditTrail: true
};

export function mergeConflictConfig(input: ConflictConfigInput = {}): ConflictConfig {
  return {
    detectAndSurface: input.detectAndSurface ?? DEFAULT_CONFLICT_CONFIG.detectAndSurface,
    autoResolve: input.autoResolve ?? DEFAULT_CONFLICT_CONFIG.autoResolve,
    severityThreshold: input.severityThreshold ?? DEFAULT_CONFLICT_CONFIG.severityThreshold,
    trustOrder: {
      ownership: input.trustOrder?.ownership ?? DEFAULT_CONFLICT_CONFIG.trustOrder.ownership,
      decision: input.trustOrder?.decision ?? DEFAULT_CONFLICT_CONFIG.trustOrder.decision,
      implementation: input.trustOrder?.implementation ?? DEFAULT_CONFLICT_CONFIG.trustOrder.implementation
    },
    auditTrail: input.auditTrail ?? DEFAULT_CONFLICT_CONFIG.auditTrail
  };
}

export function parseConflictSeverity(value: string | undefined, fallback: ConflictSeverity): ConflictSeverity {
  switch (value) {
    case "low":
    case "medium":
    case "high":
    case "critical":
      return value;
    default:
      return fallback;
  }
}
