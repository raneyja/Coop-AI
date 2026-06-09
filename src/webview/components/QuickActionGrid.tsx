import React, { useMemo } from "react";
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

function requiresOpenFile(action: ActionConfig): boolean {
  return action.id !== "understand-repo";
}

function isDisabled(action: ActionConfig, context: RepoContext): boolean {
  if (!context.file && requiresOpenFile(action)) {
    return true;
  }
  return false;
}

function isDimmed(action: ActionConfig, context: RepoContext): boolean {
  if (!context.file) {
    return requiresOpenFile(action);
  }
  if (action.id === "trace-decision") {
    return !context.selectedLines;
  }
  if (action.id === "find-owner") {
    return !/\.(ts|tsx|js|jsx|go|py|rb|java|kt|cs|rs)$/i.test(context.file);
  }
  return false;
}

function actionHint(action: ActionConfig, context: RepoContext, dimmed: boolean): string {
  if (!context.file && requiresOpenFile(action)) {
    return "Open a file in the editor first.";
  }
  if (dimmed) {
    return "Open a file for full context.";
  }
  return action.description;
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
        const hint = actionHint(action, context, action.dimmed);
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
