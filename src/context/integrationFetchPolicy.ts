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

/**
 * Soft integration budget for Knowledge Gaps after the core gap scan is ready.
 * Notion / Docs / Jira / Slack must not dominate IDE wall clock.
 */
export const KNOWLEDGE_GAPS_INTEGRATION_BUDGET_MS = 10_000;

/**
 * Max time the IDE Knowledge Gaps path will wait on SCAN_KNOWLEDGE_GAPS.
 * The job's default estimate is ~180s — far too long for a sidebar quick action.
 * On timeout we fall through to the live heuristic scan.
 */
export const KNOWLEDGE_GAPS_JOB_POLL_BUDGET_MS = 15_000;

/** Alias used by CoopChatSession poll wiring. */
export const KNOWLEDGE_GAPS_JOB_POLL_TIMEOUT_MS = KNOWLEDGE_GAPS_JOB_POLL_BUDGET_MS;

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

export function isKnowledgeGapsQuickAction(quickAction: string | undefined): boolean {
  return quickAction === "knowledge-gaps";
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
 * evidence is already strong. Repo-wide actions keep them unless a more specific
 * soft-doc gate (knowledge-gaps) says otherwise — see shouldFetchSoftDocIntegrations.
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

/** Gap-scan payload used to decide whether soft docs are worth waiting on. */
export type KnowledgeGapsScanEvidence = {
  foundGaps?: number;
  gaps?: unknown[];
};

/** @deprecated Use KnowledgeGapsScanEvidence */
export type KnowledgeGapScanEvidence = KnowledgeGapsScanEvidence;

/**
 * True when the automated / heuristic gap scan already confirmed gaps — title-only
 * Notion / Google Docs waits are unlikely to improve the first-turn answer.
 */
export function knowledgeGapScanHasConfirmedGaps(
  scan: KnowledgeGapsScanEvidence | undefined
): boolean {
  if (!scan) {
    return false;
  }
  if (typeof scan.foundGaps === "number" && scan.foundGaps > 0) {
    return true;
  }
  return Array.isArray(scan.gaps) && scan.gaps.length > 0;
}

/**
 * Soft title-only doc tools (Notion / Google Docs) for Knowledge Gaps.
 * When the gap scan already has confirmed findings, skip them so soft APIs cannot
 * dominate IDE latency; attach remaining docs only via the hard budget window.
 */
export function shouldFetchKnowledgeGapsSoftDocIntegrations(
  request: ContextFetchRequest,
  scan?: KnowledgeGapsScanEvidence
): boolean {
  if (!isKnowledgeGapsQuickAction(request.params.quickAction)) {
    return shouldFetchTraceDecisionDocIntegrations(request);
  }
  if (knowledgeGapScanHasConfirmedGaps(scan)) {
    return false;
  }
  return true;
}

/**
 * Whether soft title-only docs should run for this enrichment pass.
 * Trace Decision and Knowledge Gaps can skip when core evidence is already strong.
 */
export function shouldFetchSoftDocIntegrations(
  request: ContextFetchRequest,
  options?: {
    timeline?: Pick<DecisionTimeline, "originalCommit" | "linkedPR">;
    knowledgeGapScan?: KnowledgeGapsScanEvidence;
  }
): boolean {
  if (isKnowledgeGapsQuickAction(request.params.quickAction)) {
    return shouldFetchKnowledgeGapsSoftDocIntegrations(request, options?.knowledgeGapScan);
  }
  if (shouldFetchTraceDecisionIntegrations(request)) {
    return shouldFetchTraceDecisionSoftDocIntegrations(request, options?.timeline);
  }
  return shouldFetchTraceDecisionDocIntegrations(request);
}

/** Resolve the integration time budget for a quick action, if any. */
export function integrationBudgetMsForQuickAction(quickAction: string | undefined): number | undefined {
  if (quickAction === "understand-repo") {
    // Historic Understand Repo window — keep in sync with prior 10s bound.
    return 10_000;
  }
  if (quickAction === "trace-decision") {
    return TRACE_DECISION_INTEGRATION_BUDGET_MS;
  }
  if (quickAction === "knowledge-gaps") {
    return KNOWLEDGE_GAPS_INTEGRATION_BUDGET_MS;
  }
  return undefined;
}
