/**
 * Resolve how handleChatSend should apply a ChatIntentPlan (Phase 2).
 */
import { offerFromActionId, type SuggestQuickActionsResult } from "../quickActionSuggestIntent";
import type { ChatIntentPlan } from "./types";

export type ChatIntentExecutionDecision =
  | { kind: "none" }
  | {
      kind: "silent-workflow";
      workflow: NonNullable<ChatIntentPlan["workflow"]>;
      tools: ChatIntentPlan["tools"];
      focus: string;
      plan: ChatIntentPlan;
    }
  | {
      kind: "confirm-workflow";
      offer: SuggestQuickActionsResult;
      tools: ChatIntentPlan["tools"];
      plan: ChatIntentPlan;
    }
  | {
      kind: "tools-only";
      tools: ChatIntentPlan["tools"];
      plan: ChatIntentPlan;
    };

export function resolveChatIntentExecution(plan: ChatIntentPlan): ChatIntentExecutionDecision {
  // Locked local explain — never promote workflow or tools.
  if (plan.mode === "plain") {
    return { kind: "none" };
  }

  if (plan.mode === "none" || plan.execution === "none") {
    if (plan.tools.length > 0 && plan.mode === "tools-only") {
      return { kind: "tools-only", tools: plan.tools, plan };
    }
    if (plan.tools.length > 0 && !plan.workflow) {
      return { kind: "tools-only", tools: plan.tools, plan };
    }
    return { kind: "none" };
  }

  if (plan.workflow && plan.execution === "silent" && plan.mode === "run-workflow") {
    return {
      kind: "silent-workflow",
      workflow: plan.workflow,
      tools: plan.tools,
      focus: plan.focus,
      plan
    };
  }

  if (plan.workflow && (plan.execution === "confirm" || plan.mode === "suggest-chips")) {
    return {
      kind: "confirm-workflow",
      offer: offerFromActionId(plan.workflow, plan.confidence),
      tools: plan.tools,
      plan
    };
  }

  if (plan.tools.length > 0) {
    return { kind: "tools-only", tools: plan.tools, plan };
  }

  return { kind: "none" };
}

/**
 * Merge planner tools into an existing plan when silently promoting a workflow
 * so Blast/Gaps still force named tools (e.g. "also check Jira").
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
