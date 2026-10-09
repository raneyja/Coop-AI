import React, { useEffect, useState } from "react";
import { languageFromFilePath } from "../lib/codeCitationLocator";
import { formatLineRange } from "../patchLocationLabel";
import { ChatCodeSurfaceBody } from "./ChatCodeSurfaceBody";

type ChatCodeCitationProps = {
  startLine?: number;
  endLine?: number;
  path: string;
  code: string;
  onOpenFile?: (path: string, line?: number, options?: { endLine?: number }) => void;
};

function citationLabel(path: string, startLine?: number, endLine?: number): string {
  if (startLine == null) {
    return path;
  }
  if (endLine == null || endLine === startLine) {
    return `${path}:${startLine}`;
  }
  return `${path}:${startLine}-${endLine}`;
}

export function ChatCodeCitation({
  startLine,
  endLine,
  path,
  code,
  onOpenFile
}: ChatCodeCitationProps): React.ReactElement {
  const [copied, setCopied] = useState(false);
  const label = citationLabel(path, startLine, endLine);
  const location = formatLineRange(startLine, endLine);
  const hasPreview = code.trim().length > 0;
  const language = languageFromFilePath(path);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = window.setTimeout(() => setCopied(false), 1200);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="coop-patch-file coop-chat-citation" data-code-surface="cite">
      <div className="coop-patch-file-header">
        <div className="coop-patch-file-heading">
          {onOpenFile ? (
            <button
              type="button"
              className="coop-patch-file-path"
              onClick={() => onOpenFile(path, startLine, { endLine })}
              title={`Open ${label}`}
              aria-label={`Open ${label}`}
            >
              {path}
            </button>
          ) : (
            <span className="coop-patch-file-path" title={path}>{path}</span>
          )}
          {location ? <span className="coop-patch-file-anchor">{location}</span> : null}
        </div>
        {hasPreview ? (
          <button type="button" className="coop-text-btn" onClick={handleCopy}>
            {copied ? "Copied" : "Copy"}
          </button>
        ) : null}
      </div>
      <ChatCodeSurfaceBody code={code} language={language} startLine={startLine} />
    </section>
  );
}
