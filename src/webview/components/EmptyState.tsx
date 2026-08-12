import React from "react";
import { shouldPromptForAgentsMd } from "../lib/agentsMdStatus";
import type { RepoContext } from "../types";

type EmptyStateProps = {
  context: RepoContext;
  disabled?: boolean;
  launchIntroDone?: boolean;
  onAttachAgentsMd?: () => void;
  onStartFromAgentsMdTemplate?: () => void;
};

export function EmptyState({
  context,
  disabled,
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

          <p className="mx-auto mt-3 max-w-[280px] text-center text-[12.5px] leading-relaxed text-[var(--coop-panel-muted)]">
            Ask anything about this repo.
            <br />
            <span className="coop-slash-hint-command font-medium">Type / for commands.</span>
          </p>

          {shouldPromptForAgentsMd(context.projectInstructions) ? (
            <div className="mt-5 text-center">
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
        </div>
      </div>
    </div>
  );
}
