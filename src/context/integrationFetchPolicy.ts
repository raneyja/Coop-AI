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

export function isBlastRadiusQuickAction(quickAction: string | undefined): boolean {
  return quickAction === "blast-radius";
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
 * specific gate (blast-radius / knowledge-gaps) says otherwise.
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
 * Trace, Blast Radius, and Knowledge Gaps can skip when core evidence is already strong.
 */
export function shouldFetchSoftDocIntegrations(
  request: ContextFetchRequest,
  options?: {
    timeline?: Pick<DecisionTimeline, "originalCommit" | "linkedPR">;
    blastEvidence?: BlastRadiusGraphEvidence;
    knowledgeGapScan?: KnowledgeGapsScanEvidence;
  }
): boolean {
  if (isBlastRadiusQuickAction(request.params.quickAction)) {
    return shouldFetchBlastRadiusSoftDocIntegrations(request, options?.blastEvidence);
  }
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
  if (quickAction === "blast-radius") {
    return BLAST_RADIUS_INTEGRATION_BUDGET_MS;
  }
  if (quickAction === "knowledge-gaps") {
    return KNOWLEDGE_GAPS_INTEGRATION_BUDGET_MS;
  }
  return undefined;
}
