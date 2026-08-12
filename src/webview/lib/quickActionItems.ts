import {
  isQuickActionBlocked,
  quickActionHoverHint,
  quickActionWorksWithoutFile
} from "../../context/quickActionScope";
import { quickActionModelPrompt } from "../../prompts/quickActionPrompts";
import type { QuickActionId, RepoContext } from "../types";

export type QuickActionItemConfig = {
  id: QuickActionId;
  label: string;
  description: string;
  prompt: (ctx: RepoContext) => string;
};

/** Canonical quick-action list — keep Workflows menu, slash aliases, and docs in sync. */
export const QUICK_ACTION_ITEMS: readonly QuickActionItemConfig[] = [
  {
    id: "understand-repo",
    label: "Understand Repo",
    description: "Architecture, ownership & key files",
    prompt: (ctx) => quickActionModelPrompt("understand-repo", ctx)
  },
  {
    id: "trace-decision",
    label: "Trace Decision",
    description: "Why this code exists",
    prompt: (ctx) => quickActionModelPrompt("trace-decision", ctx)
  },
  {
    id: "find-owner",
    label: "Find Owner",
    description: "Who owns this & escalation path",
    prompt: (ctx) => quickActionModelPrompt("find-owner", ctx)
  },
  {
    id: "blast-radius",
    label: "Blast Radius",
    description: "Impact of changing this code",
    prompt: (ctx) => quickActionModelPrompt("blast-radius", ctx)
  },
  {
    id: "knowledge-gaps",
    label: "Knowledge Gaps",
    description: "Missing context & blind spots",
    prompt: (ctx) => quickActionModelPrompt("knowledge-gaps", ctx)
  }
];

export type ResolvedQuickActionItem = QuickActionItemConfig & {
  dimmed: boolean;
  blocked: boolean;
  hint: string;
};

function requiresFileTarget(action: QuickActionItemConfig): boolean {
  return !quickActionWorksWithoutFile(action.id);
}

function isDimmed(action: QuickActionItemConfig, context: RepoContext): boolean {
  if (!context.file) {
    return requiresFileTarget(action);
  }
  if (action.id === "trace-decision") {
    return !context.selectedLines;
  }
  if (action.id === "find-owner" && context.file) {
    return !/\.(ts|tsx|js|jsx|go|py|rb|java|kt|cs|rs)$/i.test(context.file);
  }
  return false;
}

/** Resolve enablement + hover copy for the current repo/file context. */
export function resolveQuickActionItems(context: RepoContext): ResolvedQuickActionItem[] {
  return QUICK_ACTION_ITEMS.map((action) => {
    const dimmed = isDimmed(action, context);
    const blocked = isQuickActionBlocked(action.id, context);
    return {
      ...action,
      dimmed,
      blocked,
      hint: quickActionHoverHint(action.id, context, dimmed, action.description)
    };
  });
}
