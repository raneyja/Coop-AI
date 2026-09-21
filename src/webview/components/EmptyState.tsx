import React from "react";
import { isExplicitRepoScope } from "../../context/contextScope";
import type { RepoContext } from "../types";

type EmptyStateProps = {
  context: RepoContext;
  launchIntroDone?: boolean;
};

export function EmptyState({
  context,
  launchIntroDone = true
}: EmptyStateProps): React.ReactElement {
  const hasSelectedRepo =
    isExplicitRepoScope(context) && Boolean(context.owner?.trim() && context.repo?.trim());
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
            {hasSelectedRepo ? "Ask anything about this repo." : "Ask a question, or pick a repo."}
            <br />
            <span className="coop-slash-hint-command font-medium">Type / for commands.</span>
          </p>
        </div>
      </div>
    </div>
  );
}
