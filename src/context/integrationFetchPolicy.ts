import type { ContextFetchRequest } from "./requestBatcher";
import { looksLikeAbsoluteDiskPath } from "./outsideWorkspaceFile";

/**
 * Quick actions that auto-fetch connected doc/discussion integrations.
 * Blast Radius is intentionally excluded — it is code-impact-first (dependents,
 * CODEOWNERS, optional PRs) and must not wait on Notion/Jira/Slack/etc.
 */
export const REPO_WIDE_INTEGRATION_QUICK_ACTIONS = [
  "knowledge-gaps",
  "understand-repo"
] as const;

export type RepoWideIntegrationQuickAction = (typeof REPO_WIDE_INTEGRATION_QUICK_ACTIONS)[number];

/** Trace Decision runs targeted doc/discussion search seeded from file and commit evidence. */
export const TRACE_DECISION_INTEGRATION_QUICK_ACTIONS = ["trace-decision"] as const;

export type TraceDecisionIntegrationQuickAction = (typeof TRACE_DECISION_INTEGRATION_QUICK_ACTIONS)[number];

export function isRepoWideIntegrationQuickAction(
  quickAction: string | undefined
): quickAction is RepoWideIntegrationQuickAction {
  return quickAction === "knowledge-gaps" || quickAction === "understand-repo";
}

export function isTraceDecisionIntegrationQuickAction(
  quickAction: string | undefined
): quickAction is TraceDecisionIntegrationQuickAction {
  return quickAction === "trace-decision";
}

function isOutsideWorkspaceTarget(request: ContextFetchRequest): boolean {
  if (looksLikeAbsoluteDiskPath(request.params.file)) {
    return true;
  }
  // External editor focused — do not auto-fetch integrations for any quick action.
  return request.params.fileSource === "external";
}

export function shouldFetchRepoWideIntegrations(request: ContextFetchRequest): boolean {
  if (isOutsideWorkspaceTarget(request)) {
    return false;
  }
  return isRepoWideIntegrationQuickAction(request.params.quickAction);
}

export function shouldFetchTraceDecisionIntegrations(request: ContextFetchRequest): boolean {
  if (isOutsideWorkspaceTarget(request)) {
    return false;
  }
  return isTraceDecisionIntegrationQuickAction(request.params.quickAction);
}

/** Slack / Teams also run on Find Owner for discussion-based ownership signals. */
export function shouldFetchDiscussionIntegrations(request: ContextFetchRequest): boolean {
  if (isOutsideWorkspaceTarget(request)) {
    return false;
  }
  const action = request.params.quickAction;
  return (
    action === "find-owner" ||
    shouldFetchRepoWideIntegrations(request) ||
    shouldFetchTraceDecisionIntegrations(request)
  );
}

/** Confluence / Notion / Google Docs / Jira search for trace-decision and repo-wide quick actions. */
export function shouldFetchTraceDecisionDocIntegrations(request: ContextFetchRequest): boolean {
  return shouldFetchRepoWideIntegrations(request) || shouldFetchTraceDecisionIntegrations(request);
}
