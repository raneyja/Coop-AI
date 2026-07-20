import type { ContextFetchRequest } from "./requestBatcher";
import type { DecisionTimeline } from "../types/decisionTimeline";

/** Quick actions that auto-fetch all connected doc/discussion integrations. */
export const REPO_WIDE_INTEGRATION_QUICK_ACTIONS = [
  "knowledge-gaps",
  "understand-repo",
  "blast-radius"
] as const;

export type RepoWideIntegrationQuickAction = (typeof REPO_WIDE_INTEGRATION_QUICK_ACTIONS)[number];

/** Trace Decision runs targeted doc/discussion search seeded from file and commit evidence. */
export const TRACE_DECISION_INTEGRATION_QUICK_ACTIONS = ["trace-decision"] as const;

export type TraceDecisionIntegrationQuickAction = (typeof TRACE_DECISION_INTEGRATION_QUICK_ACTIONS)[number];

/**
 * Time budget for Trace Decision's connected-tool search. Mirrors Understand Repo:
 * whatever completes within this window is included; slower tools are dropped.
 */
export const TRACE_DECISION_INTEGRATION_BUDGET_MS = 10_000;

export function isRepoWideIntegrationQuickAction(
  quickAction: string | undefined
): quickAction is RepoWideIntegrationQuickAction {
  return (
    quickAction === "knowledge-gaps" ||
    quickAction === "understand-repo" ||
    quickAction === "blast-radius"
  );
}

export function isTraceDecisionIntegrationQuickAction(
  quickAction: string | undefined
): quickAction is TraceDecisionIntegrationQuickAction {
  return quickAction === "trace-decision";
}

export function shouldFetchRepoWideIntegrations(request: ContextFetchRequest): boolean {
  return isRepoWideIntegrationQuickAction(request.params.quickAction);
}

export function shouldFetchTraceDecisionIntegrations(request: ContextFetchRequest): boolean {
  return isTraceDecisionIntegrationQuickAction(request.params.quickAction);
}

/** Slack / Teams also run on Find Owner for discussion-based ownership signals. */
export function shouldFetchDiscussionIntegrations(request: ContextFetchRequest): boolean {
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

/**
 * True when GitHub (or code-host) commit + PR evidence is already enough that title-only
 * Notion / Google Docs waits are unlikely to improve the first-turn answer.
 */
export function timelineHasSufficientCodeHostEvidence(
  timeline: Pick<DecisionTimeline, "originalCommit" | "linkedPR"> | undefined
): boolean {
  return Boolean(timeline?.originalCommit && timeline.linkedPR);
}

/**
 * Soft title-only doc tools (Notion / Google Docs) for Trace Decision when code-host
 * evidence is already strong. Repo-wide actions always keep them.
 */
export function shouldFetchTraceDecisionSoftDocIntegrations(
  request: ContextFetchRequest,
  timeline?: Pick<DecisionTimeline, "originalCommit" | "linkedPR">
): boolean {
  if (!shouldFetchTraceDecisionIntegrations(request)) {
    return shouldFetchTraceDecisionDocIntegrations(request);
  }
  if (timelineHasSufficientCodeHostEvidence(timeline)) {
    return false;
  }
  return true;
}
