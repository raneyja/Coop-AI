/**
 * Resolve how handleChatSend should apply a ChatIntentPlan (Phase 2).
 *
 * Unconstrained English never enters a quick-action pipeline. `silent-workflow`
 * / `confirm-workflow` are dead on the send path — only an explicit slash /
 * Workflows / grid `quickAction` may run those engines (via `handleChatSend`
 * args, not this resolver).
 */
import type { ChatIntentPlan } from "./types";

export type ChatIntentExecutionDecision =
  | { kind: "none" }
  | {
      kind: "tools-only";
      tools: ChatIntentPlan["tools"];
      plan: ChatIntentPlan;
    };

/**
 * Drop leftover workflow promotion on unconstrained turns so agent routing and
 * trust copy do not think a quick action is running.
 */
export function demoteUnconstrainedWorkflow(plan: ChatIntentPlan): ChatIntentPlan {
  const promoted =
    Boolean(plan.workflow) ||
    plan.mode === "run-workflow" ||
    plan.mode === "suggest-chips" ||
    plan.execution === "silent" ||
    plan.execution === "confirm";
  if (!promoted) {
    return plan;
  }
  const keepTools = plan.tools.length > 0 || (plan.jobs?.length ?? 0) > 0;
  const mode =
    plan.mode === "plain"
      ? "plain"
      : keepTools
        ? "tools-only"
        : plan.mode === "run-workflow" || plan.mode === "suggest-chips"
          ? "none"
          : plan.mode;
  return {
    ...plan,
    workflow: undefined,
    execution: "none",
    mode,
    reason: plan.reason
  };
}

export function resolveChatIntentExecution(plan: ChatIntentPlan): ChatIntentExecutionDecision {
  const unconstrained = demoteUnconstrainedWorkflow(plan);

  // Locked local explain — never promote workflow or tools.
  if (unconstrained.mode === "plain") {
    return { kind: "none" };
  }

  if (unconstrained.tools.length > 0) {
    return { kind: "tools-only", tools: unconstrained.tools, plan: unconstrained };
  }

  return { kind: "none" };
}

/**
 * Merge planner tools into an existing plan when an explicit workflow still
 * needs named tools (e.g. `/blast` plus "also check Jira").
 */
export function mergeForcedTools(
  baseTools: ChatIntentPlan["tools"],
  extra: ChatIntentPlan["tools"] | undefined
): ChatIntentPlan["tools"] {
  if (!extra?.length) {
    return baseTools;
  }
  const seen = new Set(baseTools);
  const out = [...baseTools];
  for (const tool of extra) {
    if (!seen.has(tool)) {
      seen.add(tool);
      out.push(tool);
    }
  }
  return out;
}
