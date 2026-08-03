import React from "react";
import type { PatchDiffLine, PatchPreviewFile, PatchPreviewHunk } from "../chat/types";
import { IntegrationResultNested, IntegrationResultText } from "./components/IntegrationResultCard";

type PatchDiffViewProps = {
  files: PatchPreviewFile[];
  onOpenFile?: (path: string) => void;
  onApplyHunk?: (hunkId: string) => void;
  onRejectHunk?: (hunkId: string) => void;
};

export function PatchDiffView({
  files,
  onOpenFile,
  onApplyHunk,
  onRejectHunk
}: PatchDiffViewProps): React.ReactElement {
  return (
    <div className="coop-patch-diff-stack">
      {files.map((file) => (
        <PatchFileDiff
          key={file.relativePath}
          file={file}
          onOpenFile={onOpenFile}
          onApplyHunk={onApplyHunk}
          onRejectHunk={onRejectHunk}
        />
      ))}
    </div>
  );
}

function PatchFileDiff({
  file,
  onOpenFile,
  onApplyHunk,
  onRejectHunk
}: {
  file: PatchPreviewFile;
  onOpenFile?: (path: string) => void;
  onApplyHunk?: (hunkId: string) => void;
  onRejectHunk?: (hunkId: string) => void;
}): React.ReactElement {
  return (
    <div className="coop-patch-file">
      <div className="coop-patch-file-header">
        <span className="coop-patch-file-path">{file.relativePath}</span>
        {onOpenFile ? (
          <button type="button" className="coop-text-btn" onClick={() => onOpenFile(file.relativePath)}>
            Open file
          </button>
        ) : null}
      </div>
      <IntegrationResultNested className="coop-patch-file-body">
        {file.hunks.map((hunk) => (
          <PatchHunkDiff
            key={hunk.id}
            hunk={hunk}
            onApplyHunk={onApplyHunk}
            onRejectHunk={onRejectHunk}
          />
        ))}
      </IntegrationResultNested>
    </div>
  );
}

function PatchHunkDiff({
  hunk,
  onApplyHunk,
  onRejectHunk
}: {
  hunk: PatchPreviewHunk;
  onApplyHunk?: (hunkId: string) => void;
  onRejectHunk?: (hunkId: string) => void;
}): React.ReactElement {
  const status = hunk.status ?? "pending";
  const showActions = status === "pending" && (onApplyHunk || onRejectHunk);

  return (
    <div className={`coop-patch-hunk${status !== "pending" ? ` coop-patch-hunk--${status}` : ""}`}>
      {hunk.matchStatus !== "matched" ? (
        <IntegrationResultText muted>
          {hunk.matchStatus === "ambiguous"
            ? "SEARCH block matches multiple locations in the file."
            : "SEARCH block not found — review before applying."}
        </IntegrationResultText>
      ) : null}
      {status === "applied" ? (
        <IntegrationResultText muted>Applied</IntegrationResultText>
      ) : null}
      {status === "rejected" ? (
        <IntegrationResultText muted>Rejected</IntegrationResultText>
      ) : null}
      <pre className="coop-patch-diff">
        <code>
          {hunk.lines.map((line, index) => (
            <PatchDiffLineRow key={`${hunk.id}-${index}`} line={line} />
          ))}
        </code>
      </pre>
      {showActions ? (
        <div className="coop-patch-hunk-actions">
          {onApplyHunk ? (
            <button
              type="button"
              className="coop-settings-action-btn"
              onClick={() => onApplyHunk(hunk.id)}
              disabled={hunk.matchStatus !== "matched"}
            >
              Apply
            </button>
          ) : null}
          {onRejectHunk ? (
            <button type="button" className="coop-text-btn" onClick={() => onRejectHunk(hunk.id)}>
              Reject
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function PatchDiffLineRow({ line }: { line: PatchDiffLine }): React.ReactElement {
  const prefix = line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " ";
  const lineLabel = line.lineNumber !== undefined ? String(line.lineNumber).padStart(4, " ") : "    ";

  return (
    <div className={`coop-patch-line coop-patch-line--${line.kind}`}>
      <span className="coop-patch-gutter">{lineLabel}</span>
      <span className="coop-patch-marker">{prefix}</span>
      <span className="coop-patch-text">{line.text || " "}</span>
    </div>
  );
}
