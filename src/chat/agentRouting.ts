import type { ContextFetchResult } from "../context/requestBatcher";
import type { ChatIntentPlan } from "./intentPlanner/types";
import { classifyRepoCodeIntent, needsRepoCode, type RepoCodeAction } from "./repoCodeIntent";

export type AgentModeSetting = "off" | "auto" | "on";

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
 * Permission from the setting only. Product default is **on**.
 * `on` does not mean every turn loops — {@link shouldRunAgentToolLoop} still
 * requires a repo hunt + planner allow (workflows / explain / Slack-only stay out).
 * Compound hunt + Slack is allowed: tools-only with a repo hunt still loops.
 */
export function shouldUseAgentMode(options: {
  query: string;
  hasQuickAction: boolean;
  agentModeSetting: AgentModeSetting;
  contextBundle?: ContextFetchResult[];
}): boolean {
  if (options.agentModeSetting === "off") {
    return false;
  }
  if (options.hasQuickAction) {
    return false;
  }
  if (options.agentModeSetting === "on") {
    return true;
  }
  // auto: never because the bundle was empty (that was too eager).
  return isRepoInvestigationQuery(options.query);
}

/**
 * Whether this turn may run the LLM repo-tool loop.
 * Intent planner wins: explain / workflow / named-tool-only stays prefetch chat.
 */
export function shouldRunAgentToolLoop(options: {
  query: string;
  hasQuickAction: boolean;
  agentModeSetting: AgentModeSetting;
  intentPlan?: ChatIntentPlan;
  isEditTurn?: boolean;
  contextBundle?: ContextFetchResult[];
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
  agentModeSetting: AgentModeSetting;
  intentPlan?: ChatIntentPlan;
  isEditTurn?: boolean;
  contextBundle?: ContextFetchResult[];
}): RepoCodeAction {
  if (options.isEditTurn) {
    return "none";
  }
  if (!shouldUseAgentMode(options)) {
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
 * When Agent is on/auto and the ask is a repo hunt, do not steal the turn
 * with Blast/Owner chips. Just answer must still be able to run the loop.
 */
export function shouldSuppressSuggestChipsForAgentHunt(options: {
  query: string;
  agentModeSetting: AgentModeSetting;
}): boolean {
  if (options.agentModeSetting === "off") {
    return false;
  }
  return isRepoInvestigationQuery(options.query);
}
