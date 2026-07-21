import React from "react";
import { displayFileLabel, displayRepoLabel, isExplicitRepoScope } from "../../context/contextScope";
import type { RepoContext } from "../types";

function RepoIcon(): React.ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0 opacity-80">
      <path
        d="M4 7h16v10H4V7zM4 7l2-3h12l2 3M9 12h6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type ContextScopeLabelProps = {
  context: RepoContext;
  onOpenExplorer?: () => void;
  onOpenFile?: () => void;
};

function isLocalFileContext(context: RepoContext): boolean {
  return (
    context.fileSource === "workspace" ||
    context.fileSource === "git" ||
    context.fileSource === "external" ||
    !context.fileSource
  );
}

function fileSourceDetail(context: RepoContext): string {
  if (context.fileSource === "external") {
    return "Outside workspace";
  }
  if (isLocalFileContext(context)) {
    return "Local Workspace";
  }
  const owner = context.owner?.trim();
  const repo = context.repo?.trim();
  if (owner && repo) {
    return `${owner}/${repo}`;
  }
  return "Remote";
}

export function ContextScopeLabel({
  context,
  onOpenExplorer,
  onOpenFile
}: ContextScopeLabelProps): React.ReactElement | null {
  const filePath = context.file?.trim();
  const showRepoChip =
    !filePath && Boolean(context.owner?.trim() && context.repo?.trim()) && isExplicitRepoScope(context);

  if (!filePath && !showRepoChip) {
    return null;
  }

  if (filePath) {
    const label = displayFileLabel(filePath);
    const isLocal = isLocalFileContext(context);
    const sourceDetail = fileSourceDetail(context);
    const badge = isLocal ? "L" : "R";
    const title = `${filePath} · ${sourceDetail} — click to open in editor`;
    const className =
      "ml-auto inline-flex min-w-0 max-w-[min(100%,18rem)] items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] " +
      (isLocal
        ? "border-[var(--coop-pill-border)] bg-[var(--coop-pill-surface)] text-[var(--coop-panel-foreground)]"
        : "border-[var(--vscode-focusBorder)]/50 bg-[var(--coop-pill-surface)] text-[var(--coop-panel-foreground)]");

    const body = (
      <>
        <span
          className={`shrink-0 rounded px-1 text-[10px] font-semibold leading-none ${
            isLocal
              ? "bg-[var(--coop-pill-border)]/40 text-[var(--coop-panel-muted)]"
              : "bg-[var(--vscode-focusBorder)]/25 text-[var(--coop-panel-foreground)]"
          }`}
          aria-hidden="true"
        >
          {badge}
        </span>
        <span className="max-w-[120px] truncate font-medium">{label}</span>
        <span className="shrink-0 max-w-[100px] truncate text-[10px] text-[var(--coop-panel-muted)]">
          {sourceDetail}
        </span>
      </>
    );

    if (!onOpenFile) {
      return (
        <span className={className} title={title} data-context-source={isLocal ? "local" : "remote"}>
          {body}
        </span>
      );
    }

    return (
      <button
        type="button"
        className={`${className} cursor-pointer transition-opacity hover:opacity-85 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-[var(--vscode-focusBorder)]`}
        title={title}
        aria-label={
          isLocal ? `Open local file ${filePath}` : `Open remote file ${filePath} from ${sourceDetail}`
        }
        data-context-source={isLocal ? "local" : "remote"}
        onClick={onOpenFile}
      >
        <span className="inline-flex min-w-0 items-center gap-1 underline decoration-transparent underline-offset-2 hover:decoration-current">
          {body}
        </span>
      </button>
    );
  }

  const repoLabel = displayRepoLabel(context.owner, context.repo);
  const repoTitle = `${context.owner}/${context.repo}`;
  const className =
    "coop-source-chip ml-auto min-w-0 max-w-[min(100%,14rem)] !gap-1 !px-2 !py-0.5 leading-none font-normal";

  if (!onOpenExplorer) {
    return (
      <span className={className} title={repoTitle}>
        <RepoIcon />
        <span className="truncate">{repoLabel}</span>
      </span>
    );
  }

  return (
    <button
      type="button"
      className={`${className} cursor-pointer transition-opacity hover:opacity-85 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-[var(--vscode-focusBorder)]`}
      title={repoTitle}
      aria-label={`Open ${repoTitle} in explorer`}
      onClick={onOpenExplorer}
    >
      <RepoIcon />
      <span className="truncate underline decoration-transparent underline-offset-2 hover:decoration-current">
        {repoLabel}
      </span>
    </button>
  );
}
