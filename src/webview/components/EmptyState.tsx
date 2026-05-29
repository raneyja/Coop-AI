import React from "react";
import { QuickActionGrid } from "./QuickActionGrid";
import { DegradationFeatureStatusPayload, QuickActionId, RepoContext } from "../types";

type EmptyStateProps = {
  context: RepoContext;
  disabled?: boolean;
  featureStatuses?: Record<string, DegradationFeatureStatusPayload>;
  onAction: (actionId: QuickActionId, prompt: string) => void;
};

export function EmptyState({ context, disabled, featureStatuses, onAction }: EmptyStateProps): React.ReactElement {
  return (
    <div className="flex min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
      <div className="flex w-full min-h-full flex-col items-center justify-center px-3 py-5">
        <header className="w-full max-w-[320px] text-center">
          <h2 className="text-lg font-semibold tracking-tight text-[var(--coop-panel-foreground)] sm:text-xl">
            How can Coop help?
          </h2>
          <p className="mx-auto mt-2 max-w-[280px] text-sm leading-relaxed text-[var(--coop-panel-muted)]">
            Ask about architecture, ownership, incidents, or change risk.
          </p>
        </header>

        <div className="mt-5 w-full max-w-[320px] shrink-0">
          <QuickActionGrid context={context} disabled={disabled} featureStatuses={featureStatuses} onAction={onAction} />
        </div>
      </div>
    </div>
  );
}
