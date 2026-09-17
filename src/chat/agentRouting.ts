import type { IntegrationChatProvider } from "./types";
import type { ChatIntentJob, ChatIntentPlan } from "./intentPlanner/types";
import { locateJobTerms } from "./intentPlanner/planChatJobs";
import { isFileCallerQuery } from "../context/fileCallerIntent";
import { isFileHistoryQuery } from "../context/fileHistoryIntent";
import { classifyRepoCodeIntent, isNonCodeHowWhyAsk, needsRepoCode, type RepoCodeAction } from "./repoCodeIntent";
import { isFeatureAddAsk } from "../context/existingCapabilityGrounding";
import { extractNamedSourceFiles } from "../api/agent/searchQuery";
import { isRepoStructureQuery } from "../workspace/repoFactIntent";

/**
 * Whether answering needs the repository's own code.
 *
 * Delegates to {@link classifyRepoCodeIntent}; this used to be a ten-word
 * keyword regex that routed on incidental vocabulary.
 */
export function isRepoInvestigationQuery(query: string): boolean {
  return needsRepoCode(query);
}

/**
 * Whether this turn may run the LLM repo-tool loop.
 * Intent planner wins: explain / workflow / integration-only stays prefetch chat.
 * Agent is always on for locate / understand / change — including compound
 * hunt + decision/docs/code-host. There is no user toggle.
 */
export function shouldRunAgentToolLoop(options: {
  query: string;
  hasQuickAction: boolean;
  intentPlan?: ChatIntentPlan;
  isEditTurn?: boolean;
  /** Slash /docs /slack /jira etc. — answer from that tool, never a repo hunt. */
  integrationSlash?: boolean;
}): boolean {
  return agentTurnAction(options) !== "none";
}

/**
 * What the loop is for this turn: locate, understand, change, or none.
 *
 * `change` is what makes `propose_patch` reachable — the agent hunts for the
 * real code first, so the patch it writes is anchored to lines it actually read.
 * Named-product / slash turns return `understand` so Search → Open can run;
 * {@link agentTurnAllowsRepoTools} keeps hunt tools off unless locate is also asked.
 */
export function agentTurnAction(options: {
  query: string;
  hasQuickAction: boolean;
  intentPlan?: ChatIntentPlan;
  isEditTurn?: boolean;
  /** Slash /docs /slack /jira etc. — vendor loop, never a repo hunt. */
  integrationSlash?: boolean;
}): RepoCodeAction {
  if (options.isEditTurn) {
    return "none";
  }
  if (options.hasQuickAction) {
    return "none";
  }
  if (options.integrationSlash) {
    return "understand";
  }
  // Inventory / layout facts use IndexedRepoWorkspace, not list_directory samples.
  // How-to / product How-Why must not hunt even if the planner stamped "understand".
  if (isRepoStructureQuery(options.query) || isNonCodeHowWhyAsk(options.query)) {
    return "none";
  }
  if (!plannerAllowsAgentRepoLoop(options.intentPlan, options.query)) {
    return "none";
  }
  const classified = options.intentPlan?.codeIntent ?? classifyRepoCodeIntent(options.query);
  if (classified.action === "none" && (options.intentPlan?.tools.length ?? 0) > 0) {
    return "understand";
  }
  return classified.action;
}

/**
 * Repo hunt tools (`search_code`, `read_file`, …). Named-product and slash
 * turns are a padlock on extra vendors — not “skip the vendor loop.”
 * Locate / change in the same ask still hunts.
 */
export function agentTurnAllowsRepoTools(options: {
  intentPlan?: ChatIntentPlan;
  integrationSlash?: boolean;
}): boolean {
  if (options.integrationSlash) {
    return false;
  }
  const jobs = options.intentPlan?.jobs ?? [];
  if (jobs.some((job) => job.capability === "locate")) {
    return true;
  }
  const action = options.intentPlan?.codeIntent?.action;
  return action === "locate" || action === "change";
}

/**
 * Compound locate+decision still needs a repo search. Prefetch reserves locate
 * when the turn stays on the gather path (integration-only, slash, workflows).
 */
export function jobsGuaranteeLocatePrefetch(jobs: ChatIntentJob[] | undefined): boolean {
  return locateJobTerms(jobs).length > 0;
}

export function plannerAllowsAgentRepoLoop(
  plan: ChatIntentPlan | undefined,
  query: string
): boolean {
  if (!plan) {
    return isRepoInvestigationQuery(query);
  }
  // Follow-up "Read src/server/authMiddleware.ts" is a file hunt even when the
  // planner locks the turn as local explain / plain chat.
  if (
    plan.mode === "plain" &&
    isRepoInvestigationQuery(query) &&
    (extractNamedSourceFiles(query).length > 0 ||
      isFileCallerQuery(query) ||
      isFileHistoryQuery(query))
  ) {
    return true;
  }
  if (plan.mode === "plain" || plan.mode === "run-workflow" || plan.mode === "suggest-chips") {
    return false;
  }
  if (plan.mode === "tools-only") {
    // Named Slack/Jira/Notion: vendor loop (90s wall). Locate in the same ask
    // still hunts. Prefetch gather is skipped because the loop owns the turn.
    if (locateJobTerms(plan.jobs).length > 0) {
      return isRepoInvestigationQuery(query);
    }
    if (plan.codeIntent?.action === "locate" || plan.codeIntent?.action === "change") {
      return isRepoInvestigationQuery(query);
    }
    return plan.tools.length > 0;
  }
  return true;
}

/**
 * Integrations the agent may call. Never the full connected list.
 * Named-product and implied-job turns stay on plan.tools (I3 jira+slack,
 * I30 docs, Notion-only). Code-only locate has empty plan.tools — allow none.
 */
export function integrationsForAgentLoop(options: {
  connected: IntegrationChatProvider[];
  plan?: ChatIntentPlan;
}): IntegrationChatProvider[] {
  return options.plan?.tools ?? [];
}

/**
 * When the ask is a repo hunt, do not steal the turn with Blast/Owner chips.
 * Just answer must still be able to run the loop.
 */
export function shouldSuppressSuggestChipsForAgentHunt(options: { query: string }): boolean {
  return isRepoInvestigationQuery(options.query);
}

/**
 * Open-file "we're adding X this sprint" must use A10 grounding on the chip
 * file. Agent locate hunts for the new token (blocked_by) and posts INDEX_HUNT_MISS.
 */
export function shouldSkipAgentHuntForOpenFileFeatureAdd(options: {
  message: string;
  openFile?: string;
}): boolean {
  return Boolean(options.openFile?.trim()) && isFeatureAddAsk(options.message);
}
