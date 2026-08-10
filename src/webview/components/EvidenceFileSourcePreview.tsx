import React from "react";
import {
  buildCodeSnippetPreview,
  CODE_SNIPPET_PREVIEW_MAX_LINES
} from "../../context/evidenceBodyPreview";
import { extractTraceSymbolTerms } from "../../engines/traceFileGrounding";
import { IntegrationResultCode } from "./IntegrationResultCard";
import { useChatLinks } from "./ChatLinkContext";

/**
 * Universal Sources policy for file/code bodies:
 * short preview only + Open file — never dump full file contents.
 * Use this in every evidence/source card (Trace, Blast, Owner, Gaps, Understand, etc.).
 */
export function EvidenceFileSourcePreview({
  path,
  content,
  focusTerms,
  emptyLabel = "No code preview available."
}: {
  path?: string;
  content?: string;
  focusTerms?: string[];
  emptyLabel?: string;
}): React.ReactElement {
  const { onOpenFile } = useChatLinks();
  const raw = content?.trim() ?? "";
  if (!raw) {
    return <p className="coop-result-text coop-result-text--muted">{emptyLabel}</p>;
  }

  const symbols =
    focusTerms && focusTerms.length > 0
      ? focusTerms
      : extractTraceSymbolTerms({ codeSnippet: raw });
  const { preview, truncated, startLine } = buildCodeSnippetPreview(raw, {
    focusTerms: symbols
  });
  const basename = path?.split("/").pop() ?? path;

  return (
    <div className="space-y-1.5">
      {onOpenFile && path ? (
        <div className="flex justify-end">
          <button
            type="button"
            className="coop-result-collapsible-link coop-text-btn shrink-0 text-[11px]"
            onClick={() => onOpenFile(path, startLine)}
          >
            Open file
          </button>
        </div>
      ) : null}
      <IntegrationResultCode allowFull>{preview}</IntegrationResultCode>
      {truncated ? (
        <p className="coop-result-text coop-result-text--muted text-[10px]">
          Showing ~{CODE_SNIPPET_PREVIEW_MAX_LINES} lines
          {basename ? (
            <>
              {" "}
              around the focus in <code>{basename}</code>
            </>
          ) : null}{" "}
          — open the file for the full source.
        </p>
      ) : (
        <p className="coop-result-text coop-result-text--muted text-[10px]">
          Short preview — open the file for the full source.
        </p>
      )}
    </div>
  );
}
