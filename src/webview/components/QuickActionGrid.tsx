import React, { useMemo } from "react";
import {
  isQuickActionBlocked,
  quickActionHoverHint,
  quickActionWorksWithoutFile
} from "../../context/quickActionScope";
import { quickActionModelPrompt } from "../../prompts/quickActionPrompts";
import { QuickActionId, RepoContext } from "../types";

type ActionConfig = {
  id: QuickActionId;
  label: string;
  description: string;
  prompt: (ctx: RepoContext) => string;
};

type QuickActionGridProps = {
  context: RepoContext;
  disabled?: boolean;
  onAction: (actionId: QuickActionId, prompt: string) => void;
  launchStagger?: boolean;
};

const ACTIONS: ActionConfig[] = [
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

function requiresFileTarget(action: ActionConfig): boolean {
  return !quickActionWorksWithoutFile(action.id);
}

function isDisabled(action: ActionConfig, context: RepoContext): boolean {
  return isQuickActionBlocked(action.id, context);
}

function isDimmed(action: ActionConfig, context: RepoContext): boolean {
  if (!context.file) {
    return requiresFileTarget(action.id);
  }
  if (action.id === "trace-decision") {
    return !context.selectedLines;
  }
  if (action.id === "find-owner" && context.file) {
    return !/\.(ts|tsx|js|jsx|go|py|rb|java|kt|cs|rs)$/i.test(context.file);
  }
  return false;
}

export function QuickActionGrid({
  context,
  disabled,
  onAction,
  launchStagger = false
}: QuickActionGridProps): React.ReactElement {
  const actions = useMemo(
    () =>
      ACTIONS.map((a) => ({
        ...a,
        dimmed: isDimmed(a, context),
        blocked: isDisabled(a, context)
      })),
    [context]
  );

  return (
    <ul className="w-full min-w-0 list-none p-0 m-0" aria-label="Quick actions">
      {actions.map((action) => {
        const hint = quickActionHoverHint(action.id, context, action.dimmed, action.description);
        return (
          <li key={action.id}>
            <button
              type="button"
              disabled={disabled || action.blocked}
              title={hint}
              aria-label={`${action.label}: ${hint}`}
              onClick={() => onAction(action.id, action.prompt(context))}
              className={`coop-quick-action-row${launchStagger ? " coop-quick-action-row--launch-stagger" : ""}`}
            >
              {action.label}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
