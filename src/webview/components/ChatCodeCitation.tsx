import React, { useEffect, useMemo, useState } from "react";
import { languageFromFilePath } from "../lib/codeCitationLocator";
import { lightHighlight } from "../lib/lightHighlight";

type ChatCodeCitationProps = {
  startLine?: number;
  endLine?: number;
  path: string;
  code: string;
  onOpenFile?: (path: string, line?: number) => void;
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
  const hasPreview = code.trim().length > 0;
  const language = languageFromFilePath(path);
  const tokens = useMemo(() => lightHighlight(code, language), [code, language]);
  const lineCount = hasPreview ? code.split("\n").length : 0;
  const showGutters = startLine != null && lineCount > 0;

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
    <section className="coop-chat-citation" data-code-surface="cite">
      <div className="coop-chat-citation-toolbar">
        <button
          type="button"
          className="coop-chat-citation-path coop-chat-action-link coop-chat-action-link--file"
          onClick={() => onOpenFile?.(path, startLine)}
          title={`Open ${label}`}
        >
          {label}
        </button>
        {hasPreview ? (
          <button type="button" className="coop-text-btn coop-chat-code-copy" onClick={handleCopy}>
            {copied ? "Copied" : "Copy"}
          </button>
        ) : null}
      </div>
      {hasPreview ? (
        <div className="coop-chat-citation-body">
          {showGutters ? (
            <div className="coop-chat-citation-gutters" aria-hidden="true">
              {Array.from({ length: lineCount }, (_, index) => (
                <span key={`gutter-${index}`} className="coop-chat-citation-gutter">
                  {(startLine as number) + index}
                </span>
              ))}
            </div>
          ) : null}
          <pre className="coop-chat-citation-pre">
            <code>
              {tokens.map((token, index) => (
                <span
                  key={`token-${index}`}
                  className={
                    token.kind === "plain"
                      ? undefined
                      : `coop-chat-code-token coop-chat-code-token--${token.kind}`
                  }
                >
                  {token.text}
                </span>
              ))}
            </code>
          </pre>
        </div>
      ) : null}
    </section>
  );
}
