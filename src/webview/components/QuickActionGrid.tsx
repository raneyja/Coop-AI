import React, { useMemo } from "react";
import { DegradationFeatureStatusPayload, QuickActionId, RepoContext } from "../types";

type ActionConfig = {
  id: QuickActionId;
  label: string;
  description: string;
  prompt: (ctx: RepoContext) => string;
};

type QuickActionGridProps = {
  context: RepoContext;
  disabled?: boolean;
  featureStatuses?: Record<string, DegradationFeatureStatusPayload>;
  onAction: (actionId: QuickActionId, prompt: string) => void;
};

const ACTIONS: ActionConfig[] = [
  {
    id: "understand-repo",
    label: "Understand Repo",
    description: "Architecture, ownership & key files",
    prompt: (ctx) =>
      `Understand this repository quickly.\nContext:\n- file: ${ctx.file || "unknown"}\n- branch: ${ctx.branch || "unknown"}\n- language: ${ctx.languageId || "unknown"}\nFocus on architecture, key systems, and likely risks.`
  },
  {
    id: "trace-decision",
    label: "Trace Decision",
    description: "Why this code exists",
    prompt: (ctx) => {
      const lineHint = ctx.selectedLines ? `${ctx.selectedLines[0]}-${ctx.selectedLines[1]}` : "none";
      return `Trace the likely engineering decision behind this code.\nContext:\n- file: ${ctx.file || "unknown"}\n- selected lines: ${lineHint}\nProvide likely rationale, tradeoffs, and alternatives.`;
    }
  },
  {
    id: "find-owner",
    label: "Find Owner",
    description: "Who owns this & escalation path",
    prompt: (ctx) =>
      `Find likely owner(s) for this area.\nContext:\n- file: ${ctx.file || "unknown"}\n- repo: ${ctx.owner || "unknown"}/${ctx.repo || "unknown"}\nInclude confidence and fallback contacts.`
  },
  {
    id: "blast-radius",
    label: "Blast Radius",
    description: "Impact of changing this code",
    prompt: (ctx) =>
      `Estimate blast radius for modifying this area.\nContext:\n- file: ${ctx.file || "unknown"}\n- language: ${ctx.languageId || "unknown"}\nInclude integration, API, and operational risks.`
  },
  {
    id: "knowledge-gaps",
    label: "Knowledge Gaps",
    description: "Missing context & blind spots",
    prompt: (ctx) =>
      `List key unknowns in this code area.\nContext:\n- file: ${ctx.file || "unknown"}\n- branch: ${ctx.branch || "unknown"}\nReturn open questions and what evidence is needed.`
  }
];

function isDimmed(action: ActionConfig, context: RepoContext): boolean {
  if (!context.file) {
    return action.id !== "understand-repo";
  }
  if (action.id === "trace-decision") {
    return !context.selectedLines;
  }
  if (action.id === "find-owner") {
    return !/\.(ts|tsx|js|jsx|go|py|rb|java|kt|cs|rs)$/i.test(context.file);
  }
  return false;
}

export function QuickActionGrid({
  context,
  disabled,
  featureStatuses = {},
  onAction
}: QuickActionGridProps): React.ReactElement {
  const actions = useMemo(() => ACTIONS.map((a) => ({ ...a, dimmed: isDimmed(a, context) })), [context]);

  return (
    <ul className="w-full min-w-0 list-none p-0 m-0" aria-label="Quick actions">
      {actions.map((action) => {
        const status = featureStatuses[action.id];
        const unavailable = status?.level === "unavailable";
        const hint = action.dimmed ? "Open a file for full context." : action.description;
        return (
          <li key={action.id}>
            <button
              type="button"
              disabled={disabled || unavailable}
              title={status?.message || hint}
              aria-label={`${action.label}: ${status?.label || hint}`}
              onClick={() => onAction(action.id, action.prompt(context))}
              className="coop-quick-action-row"
            >
              {action.label}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
