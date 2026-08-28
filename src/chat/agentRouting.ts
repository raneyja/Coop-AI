import type { ChatIntentPlan } from "./intentPlanner/types";
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
 * Intent planner wins: explain / workflow / named-tool-only stays prefetch chat.
 * Agent is always on for locate / understand / change — there is no user toggle.
 */
export function shouldRunAgentToolLoop(options: {
  query: string;
  hasQuickAction: boolean;
  intentPlan?: ChatIntentPlan;
  isEditTurn?: boolean;
}): boolean {
  return agentTurnAction(options) !== "none";
}

/**
 * What the loop is for this turn: locate, understand, change, or none.
 *
 * `change` is what makes `propose_patch` reachable — the agent hunts for the
 * real code first, so the patch it writes is anchored to lines it actually read.
 */
export function agentTurnAction(options: {
  query: string;
  hasQuickAction: boolean;
  intentPlan?: ChatIntentPlan;
  isEditTurn?: boolean;
}): RepoCodeAction {
  if (options.isEditTurn) {
    return "none";
  }
  if (options.hasQuickAction) {
    return "none";
  }
  // Inventory / layout facts use IndexedRepoWorkspace, not list_directory samples.
  // How-to / product How-Why must not hunt even if the planner stamped "understand".
  if (isRepoStructureQuery(options.query) || isNonCodeHowWhyAsk(options.query)) {
    return "none";
  }
  if (!plannerAllowsAgentRepoLoop(options.intentPlan, options.query)) {
    return "none";
  }
  return (options.intentPlan?.codeIntent ?? classifyRepoCodeIntent(options.query)).action;
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
    extractNamedSourceFiles(query).length > 0 &&
    isRepoInvestigationQuery(query)
  ) {
    return true;
  }
  if (plan.mode === "plain" || plan.mode === "run-workflow" || plan.mode === "suggest-chips") {
    return false;
  }
  if (plan.mode === "tools-only") {
    // Named Slack/Jira/etc. only — no repo hunt unless the ask is also a hunt.
    return isRepoInvestigationQuery(query);
  }
  return true;
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
