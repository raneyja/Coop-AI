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
        <div className="w-full max-w-[320px]">
          <h2 className="mx-auto max-w-[280px] text-center text-lg font-semibold leading-relaxed tracking-tight text-[var(--coop-panel-foreground)] sm:text-xl">
            CoopAI
          </h2>

          <div className="mt-6">
            <QuickActionGrid context={context} disabled={disabled} featureStatuses={featureStatuses} onAction={onAction} />
          </div>
        </div>
      </div>
    </div>
  );
}
