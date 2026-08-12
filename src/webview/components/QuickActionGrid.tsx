import React, { useMemo } from "react";
import { resolveQuickActionItems } from "../lib/quickActionItems";
import { QuickActionId, RepoContext } from "../types";

type QuickActionGridProps = {
  context: RepoContext;
  disabled?: boolean;
  onAction: (actionId: QuickActionId, prompt: string) => void;
  launchStagger?: boolean;
};

/** @deprecated Prefer WorkflowsMenu in the chat header. Kept for any residual callers. */
export function QuickActionGrid({
  context,
  disabled,
  onAction,
  launchStagger = false
}: QuickActionGridProps): React.ReactElement {
  const actions = useMemo(() => resolveQuickActionItems(context), [context]);

  return (
    <ul className="w-full min-w-0 list-none p-0 m-0" aria-label="Quick actions">
      {actions.map((action) => (
        <li key={action.id}>
          <button
            type="button"
            disabled={disabled || action.blocked}
            title={action.hint}
            aria-label={`${action.label}: ${action.hint}`}
            onClick={() => onAction(action.id, action.prompt(context))}
            className={`coop-quick-action-row${launchStagger ? " coop-quick-action-row--launch-stagger" : ""}`}
          >
            {action.label}
          </button>
        </li>
      ))}
    </ul>
  );
}
