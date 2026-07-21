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
 * Soft integration budget for Blast Radius after the core graph/CODEOWNERS path is ready.
 * Notion / Docs / Jira / Slack must not dominate IDE wall clock.
 */
export const BLAST_RADIUS_INTEGRATION_BUDGET_MS = 10_000;

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

export function isBlastRadiusQuickAction(quickAction: string | undefined): boolean {
  return quickAction === "blast-radius";
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
 * True when GitHub (or code-host) archaeology already grounds the first-turn Trace answer.
 * Commit alone is enough — Notion / Google Docs search never returns page bodies today.
 */
export function timelineHasSufficientCodeHostEvidence(
  timeline: Pick<DecisionTimeline, "originalCommit" | "linkedPR"> | undefined
): boolean {
  return Boolean(timeline?.originalCommit || timeline?.linkedPR);
}

/**
 * Soft title-only doc tools (Notion / Google Docs) for Trace Decision.
 * Always skip on Trace — search returns titles only (no body), so waiting adds latency
 * and invites "N reviewed" / "content was not retrievable" UX. Confluence (excerpts),
 * Jira, Slack, and Teams still run. Repo-wide actions keep soft docs unless a more
 * specific gate (blast-radius) says otherwise.
 */
export function shouldFetchTraceDecisionSoftDocIntegrations(
  request: ContextFetchRequest,
  _timeline?: Pick<DecisionTimeline, "originalCommit" | "linkedPR">
): boolean {
  if (!shouldFetchTraceDecisionIntegrations(request)) {
    return shouldFetchTraceDecisionDocIntegrations(request);
  }
  return false;
}

/** Graph-backed blast evidence that already supports a Strong / usable first answer. */
export type BlastRadiusGraphEvidence = {
  directDependents?: string[];
  transitiveDependents?: string[];
  dependentDetails?: unknown[];
  ownersByFile?: unknown[];
  completeness?: "full" | "partial" | "minimal";
};

/**
 * True when dependency graph (+ optional CODEOWNERS) already grounds blast-radius:
 * title-only Notion / Google Docs waits are unlikely to improve the first-turn answer.
 */
export function blastRadiusHasSufficientGraphEvidence(
  evidence: BlastRadiusGraphEvidence | undefined
): boolean {
  if (!evidence) {
    return false;
  }
  const direct = evidence.directDependents?.length ?? 0;
  const transitive = evidence.transitiveDependents?.length ?? 0;
  const details = evidence.dependentDetails?.length ?? 0;
  if (direct + transitive + details > 0) {
    return true;
  }
  // CODEOWNERS alone is not "Strong" graph, but with partial/full completeness
  // from the engine we still prefer not to stall on soft docs.
  return (
    (evidence.completeness === "full" || evidence.completeness === "partial") &&
    (evidence.ownersByFile?.length ?? 0) > 0
  );
}

/**
 * Soft title-only doc tools (Notion / Google Docs) for Blast Radius.
 * When graph dependents are already present, skip them so soft APIs cannot
 * dominate IDE latency; other actions keep prior behavior.
 */
export function shouldFetchBlastRadiusSoftDocIntegrations(
  request: ContextFetchRequest,
  evidence?: BlastRadiusGraphEvidence
): boolean {
  if (!isBlastRadiusQuickAction(request.params.quickAction)) {
    return shouldFetchTraceDecisionDocIntegrations(request);
  }
  if (blastRadiusHasSufficientGraphEvidence(evidence)) {
    return false;
  }
  return true;
}

/**
 * Whether soft title-only docs should run for this enrichment pass.
 * Trace Decision and Blast Radius can skip when core evidence is already strong.
 */
export function shouldFetchSoftDocIntegrations(
  request: ContextFetchRequest,
  options?: {
    timeline?: Pick<DecisionTimeline, "originalCommit" | "linkedPR">;
    blastEvidence?: BlastRadiusGraphEvidence;
  }
): boolean {
  if (isBlastRadiusQuickAction(request.params.quickAction)) {
    return shouldFetchBlastRadiusSoftDocIntegrations(request, options?.blastEvidence);
  }
  if (shouldFetchTraceDecisionIntegrations(request)) {
    return shouldFetchTraceDecisionSoftDocIntegrations(request, options?.timeline);
  }
  return shouldFetchTraceDecisionDocIntegrations(request);
}
