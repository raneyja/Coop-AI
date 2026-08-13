import type { ContextFetchResult } from "../context/requestBatcher";
import type { ChatIntentPlan } from "./intentPlanner/types";

const REPO_HUNT_KEYWORDS =
  /\b(where|find|across|codebase|repo|which file|how does|enforced|callers?|defined in)\b/i;

const LOCAL_EXPLAIN =
  /^(?:(?:can\s+you|could\s+you|please)\s+)?(?:what\s+does\s+this\s+(?:function|method|class|file)\s+do\b|explain\s+this\s+(?:function|method|class|file|code)\b|summarize\s+this\s+(?:function|method|class|file|code)\b|walk\s+me\s+through\s+this\s+(?:function|method|class|file|code)\b|thanks\b|thank you\b|ok\b|okay\b)/i;

export type AgentModeSetting = "off" | "auto" | "on";

export function isRepoInvestigationQuery(query: string): boolean {
  const trimmed = query.trim();
  if (trimmed.length < 20) {
    return false;
  }
  if (LOCAL_EXPLAIN.test(trimmed)) {
    return false;
  }
  return REPO_HUNT_KEYWORDS.test(trimmed);
}

/**
 * Permission from the setting only. `on` does not mean every turn loops —
 * {@link shouldRunAgentToolLoop} still requires a repo hunt + planner allow.
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
  if (options.isEditTurn) {
    return false;
  }
  if (!shouldUseAgentMode(options)) {
    return false;
  }
  if (!plannerAllowsAgentRepoLoop(options.intentPlan, options.query)) {
    return false;
  }
  return isRepoInvestigationQuery(options.query);
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
