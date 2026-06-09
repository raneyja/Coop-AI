import React from "react";

function FileIcon(): React.ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0 opacity-80">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function basename(path: string): string {
  return path.split("/").pop() || path;
}

type ActiveFileLabelProps = {
  filePath: string;
  onOpen?: () => void;
};

export function ActiveFileLabel({ filePath, onOpen }: ActiveFileLabelProps): React.ReactElement {
  const label = basename(filePath);
  const className =
    "ml-auto inline-flex min-w-0 max-w-[min(100%,14rem)] items-center gap-1 rounded-md px-2 py-0.5 text-[11px] " +
    "bg-[var(--vscode-badge-background)] text-[var(--vscode-badge-foreground)]";

  if (!onOpen) {
    return (
      <span className={className} title={filePath}>
        <FileIcon />
        <span className="truncate">{label}</span>
      </span>
    );
  }

  return (
    <button
      type="button"
      className={`${className} cursor-pointer transition-opacity hover:opacity-85 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-[var(--vscode-focusBorder)]`}
      title={filePath}
      aria-label={`Open ${filePath} in editor`}
      onClick={onOpen}
    >
      <FileIcon />
      <span className="truncate underline decoration-transparent underline-offset-2 hover:decoration-current">
        {label}
      </span>
    </button>
  );
}
