import React from "react";
import { QUICK_ACTION_SLASH_HINTS } from "../../context/slashCommands";
import { QuickActionGrid } from "./QuickActionGrid";
import { shouldPromptForAgentsMd } from "../lib/agentsMdStatus";
import { QuickActionId, RepoContext } from "../types";

type EmptyStateProps = {
  context: RepoContext;
  disabled?: boolean;
  onAction: (actionId: QuickActionId, prompt: string) => void;
  onSlashCommand?: (command: (typeof QUICK_ACTION_SLASH_HINTS)[number]) => void;
  launchIntroDone?: boolean;
  onAttachAgentsMd?: () => void;
  onStartFromAgentsMdTemplate?: () => void;
};

export function EmptyState({
  context,
  disabled,
  onAction,
  onSlashCommand,
  launchIntroDone = true,
  onAttachAgentsMd,
  onStartFromAgentsMdTemplate
}: EmptyStateProps): React.ReactElement {
  return (
    <div className="flex min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
      <div
        className={`flex w-full min-h-full flex-col items-center justify-center px-3 py-5${
          launchIntroDone ? " coop-empty-state--launch-ready" : " coop-empty-state--launch-pending"
        }`}
      >
        <div className="w-full max-w-[320px]">
          <h2 className="mx-auto max-w-[280px] text-center text-lg font-semibold leading-relaxed tracking-tight text-[var(--coop-panel-foreground)] sm:text-xl">
            CoopAI
          </h2>

          {shouldPromptForAgentsMd(context.projectInstructions) ? (
            <div className="mt-4 text-center">
              <button
                type="button"
                disabled={disabled || !onStartFromAgentsMdTemplate}
                className="coop-settings-action-btn"
                onClick={onStartFromAgentsMdTemplate}
              >
                Create AGENTS.md
              </button>
              {onAttachAgentsMd ? (
                <button
                  type="button"
                  disabled={disabled}
                  className="coop-text-btn mt-2 block w-full"
                  onClick={onAttachAgentsMd}
                >
                  Upload AGENTS.md
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="mt-6">
            <QuickActionGrid
              context={context}
              disabled={disabled}
              onAction={onAction}
              launchStagger={launchIntroDone}
            />
            <p className="mt-4 text-center text-[11px] leading-relaxed text-[var(--coop-panel-muted)]">
              Or type{" "}
              {QUICK_ACTION_SLASH_HINTS.map((command, index) => (
                <React.Fragment key={command}>
                  {index > 0 ? ", " : null}
                  <button
                    type="button"
                    disabled={disabled || !onSlashCommand}
                    className="coop-slash-hint-command inline cursor-pointer border-0 bg-transparent p-0 font-medium disabled:cursor-default disabled:opacity-40"
                    onClick={() => onSlashCommand?.(command)}
                  >
                    /{command}
                  </button>
                </React.Fragment>
              ))}
              {" "}
              in chat for the same actions.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
