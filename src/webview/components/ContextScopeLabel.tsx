import React from "react";
import { displayFileLabel, displayRepoLabel, isExplicitRepoScope } from "../../context/contextScope";
import { isRemoteChip } from "../../context/fileChipIdentity";
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

function ChipDismissButton({
  label,
  onClear
}: {
  label: string;
  onClear: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      className="coop-source-chip-dismiss shrink-0 rounded-full px-0.5 text-[11px] leading-none text-[var(--coop-panel-muted)] hover:text-[var(--coop-panel-foreground)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-[var(--vscode-focusBorder)]"
      title="Remove from this chat"
      aria-label={label}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClear();
      }}
    >
      ×
    </button>
  );
}

type ContextScopeLabelProps = {
  context: RepoContext;
  onOpenExplorer?: () => void;
  onOpenFile?: () => void;
  onClear?: () => void;
};

/**
 * Single active-file chip: always L or R + filename + Local / owner/repo.
 * Local = workspace / git / outside-workspace disk. Remote = codehost.
 * Absolute Downloads paths are never R even if a bad stamp slipped through.
 * Repo chip only when no file and explicit explorer "Use repo" scope.
 */
export function ContextScopeLabel({
  context,
  onOpenExplorer,
  onOpenFile,
  onClear
}: ContextScopeLabelProps): React.ReactElement | null {
  const filePath = context.file?.trim();
  const showRepoChip =
    !filePath && Boolean(context.owner?.trim() && context.repo?.trim()) && isExplicitRepoScope(context);

  if (!filePath && !showRepoChip) {
    return null;
  }

  if (filePath) {
    const label = displayFileLabel(filePath);
    const remote = isRemoteChip(context);
    const badge = remote ? "R" : "L";
    const sourceDetail = remote
      ? context.owner?.trim() && context.repo?.trim()
        ? `${context.owner}/${context.repo}`
        : "Remote"
      : "Local";
    const selection =
      context.selectedLines && context.selectedLines.length === 2
        ? context.selectedLines[0] === context.selectedLines[1]
          ? `L${context.selectedLines[0]}`
          : `L${context.selectedLines[0]}–${context.selectedLines[1]}`
        : undefined;
    const title = selection
      ? remote
        ? `${filePath} · ${selection} · ${sourceDetail}`
        : `${filePath} · ${selection} · Local`
      : remote
        ? `${filePath} · ${sourceDetail}`
        : `${filePath} · Local`;
    const className =
      "ml-auto inline-flex min-w-0 max-w-[min(100%,20rem)] items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] " +
      (remote
        ? "border-[var(--vscode-focusBorder)]/50 bg-[var(--coop-pill-surface)] text-[var(--coop-panel-foreground)]"
        : "border-[var(--coop-pill-border)] bg-[var(--coop-pill-surface)] text-[var(--coop-panel-foreground)]");

    const body = (
      <>
        <span
          className={`shrink-0 rounded px-1 text-[10px] font-semibold leading-none ${
            remote
              ? "bg-[var(--vscode-focusBorder)]/25 text-[var(--coop-panel-foreground)]"
              : "bg-[var(--coop-pill-border)]/40 text-[var(--coop-panel-muted)]"
          }`}
          aria-hidden="true"
        >
          {badge}
        </span>
        <span className="max-w-[100px] truncate font-medium">{label}</span>
        {selection ? (
          <span className="shrink-0 text-[10px] font-medium text-[var(--coop-panel-foreground)]">
            {selection}
          </span>
        ) : null}
        <span className="shrink-0 max-w-[90px] truncate text-[10px] text-[var(--coop-panel-muted)]">
          {sourceDetail}
        </span>
      </>
    );

    return (
      <span className={className} title={title} data-context-source={remote ? "remote" : "local"}>
        {onOpenFile ? (
          <button
            type="button"
            className="inline-flex min-w-0 cursor-pointer items-center gap-1 underline decoration-transparent underline-offset-2 hover:decoration-current focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-[var(--vscode-focusBorder)]"
            title={`${title} — click to open in editor`}
            aria-label={remote ? `Open remote file ${filePath}` : `Open local file ${filePath}`}
            onClick={onOpenFile}
          >
            {body}
          </button>
        ) : (
          body
        )}
        {onClear ? <ChipDismissButton label={`Remove ${label} from this chat`} onClear={onClear} /> : null}
      </span>
    );
  }

  const repoLabel = displayRepoLabel(context.owner, context.repo);
  const branch = context.branch?.trim();
  const repoTitle = branch
    ? `${context.owner}/${context.repo} · ${branch}`
    : `${context.owner}/${context.repo}`;
  const className =
    "coop-source-chip ml-auto min-w-0 max-w-[min(100%,16rem)] !gap-1 !px-2 !py-0.5 leading-none font-normal";

  const repoBody = (
    <>
      <RepoIcon />
      <span className="truncate underline decoration-transparent underline-offset-2 hover:decoration-current">
        {repoLabel}
      </span>
      {branch ? (
        <span className="shrink-0 max-w-[72px] truncate text-[10px] text-[var(--coop-panel-muted)]">
          {branch}
        </span>
      ) : null}
    </>
  );

  return (
    <span className={className} title={repoTitle} role="group">
      {onOpenExplorer ? (
        <button
          type="button"
          className="inline-flex min-w-0 cursor-pointer items-center gap-1 transition-opacity hover:opacity-85 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-[var(--vscode-focusBorder)]"
          title={repoTitle}
          aria-label={`Open ${repoTitle} in explorer`}
          onClick={onOpenExplorer}
        >
          {repoBody}
        </button>
      ) : (
        <span className="inline-flex min-w-0 items-center gap-1">
          <RepoIcon />
          <span className="truncate">{repoLabel}</span>
          {branch ? (
            <span className="shrink-0 max-w-[72px] truncate text-[10px] text-[var(--coop-panel-muted)]">
              {branch}
            </span>
          ) : null}
        </span>
      )}
      {onClear ? <ChipDismissButton label={`Remove ${repoTitle} from this chat`} onClear={onClear} /> : null}
    </span>
  );
}
