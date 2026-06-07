import React from "react";
import { QUICK_ACTION_SLASH_HINTS } from "../../context/slashCommands";
import { QuickActionGrid } from "./QuickActionGrid";
import { QuickActionId, RepoContext } from "../types";

type EmptyStateProps = {
  context: RepoContext;
  disabled?: boolean;
  onAction: (actionId: QuickActionId, prompt: string) => void;
  onSlashCommand?: (command: (typeof QUICK_ACTION_SLASH_HINTS)[number]) => void;
  launchIntroDone?: boolean;
};

export function EmptyState({
  context,
  disabled,
  onAction,
  onSlashCommand,
  launchIntroDone = true
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
