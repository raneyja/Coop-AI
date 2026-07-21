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

function FileIcon(): React.ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0 opacity-80">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

type ContextScopeLabelProps = {
  context: RepoContext;
  onOpenExplorer?: () => void;
  onOpenFile?: () => void;
};

function remoteFileDetail(context: RepoContext): string | undefined {
  if (context.fileSource !== "remote") {
    return undefined;
  }
  const owner = context.owner?.trim();
  const repo = context.repo?.trim();
  if (owner && repo) {
    return `${owner}/${repo}`;
  }
  return "remote";
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
    const remoteDetail = remoteFileDetail(context);
    const title = remoteDetail ? `${filePath} · ${remoteDetail}` : filePath;
    const className = remoteDetail
      ? "coop-source-chip ml-auto min-w-0 max-w-[min(100%,18rem)] !gap-1 !px-2 !py-0.5 leading-none font-normal"
      : "ml-auto inline-flex min-w-0 max-w-[min(100%,14rem)] items-center gap-1 rounded-md px-2 py-0.5 text-[11px] " +
        "bg-[var(--vscode-badge-background)] text-[var(--vscode-badge-foreground)]";

    const body = (
      <>
        {remoteDetail ? <RepoIcon /> : <FileIcon />}
        <span className="truncate">{label}</span>
        {remoteDetail ? (
          <span className="shrink-0 truncate text-[10px] opacity-80">{remoteDetail}</span>
        ) : null}
      </>
    );

    if (!onOpenFile) {
      return (
        <span className={className} title={title}>
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
          remoteDetail ? `Open ${filePath} from ${remoteDetail}` : `Open ${filePath} in editor`
        }
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
