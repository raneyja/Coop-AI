import React from "react";
import type { PatchDiffLine, PatchPreviewFile, PatchPreviewHunk } from "../chat/types";
import { IntegrationResultNested, IntegrationResultText } from "./components/IntegrationResultCard";

type PatchDiffViewProps = {
  files: PatchPreviewFile[];
  onOpenFile?: (path: string) => void;
};

export function PatchDiffView({ files, onOpenFile }: PatchDiffViewProps): React.ReactElement {
  return (
    <div className="coop-patch-diff-stack">
      {files.map((file) => (
        <PatchFileDiff key={file.relativePath} file={file} onOpenFile={onOpenFile} />
      ))}
    </div>
  );
}

function PatchFileDiff({
  file,
  onOpenFile
}: {
  file: PatchPreviewFile;
  onOpenFile?: (path: string) => void;
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
          <PatchHunkDiff key={hunk.id} hunk={hunk} />
        ))}
      </IntegrationResultNested>
    </div>
  );
}

function PatchHunkDiff({ hunk }: { hunk: PatchPreviewHunk }): React.ReactElement {
  return (
    <div className="coop-patch-hunk">
      {hunk.matchStatus !== "matched" ? (
        <IntegrationResultText muted>
          {hunk.matchStatus === "ambiguous"
            ? "SEARCH block matches multiple locations in the file."
            : "SEARCH block not found — review before applying."}
        </IntegrationResultText>
      ) : null}
      <pre className="coop-patch-diff">
        <code>
          {hunk.lines.map((line, index) => (
            <PatchDiffLineRow key={`${hunk.id}-${index}`} line={line} />
          ))}
        </code>
      </pre>
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
