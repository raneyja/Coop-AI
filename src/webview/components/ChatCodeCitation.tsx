import React, { useEffect, useMemo, useState } from "react";
import type { ThemeMode } from "../theme";
import { languageFromFilePath } from "../lib/codeCitationLocator";
import { lightHighlight, type HighlightToken } from "../lib/lightHighlight";
import { syntaxTokenColor } from "../lib/syntaxTokenColors";

type ChatCodeCitationProps = {
  startLine?: number;
  endLine?: number;
  path: string;
  code: string;
  onOpenFile?: (path: string, line?: number) => void;
};

function readDocumentTheme(): ThemeMode {
  if (typeof document === "undefined") {
    return "dark";
  }
  const mode = document.documentElement.dataset.theme;
  if (mode === "light" || mode === "high-contrast") {
    return mode;
  }
  return "dark";
}

function citationLabel(path: string, startLine?: number, endLine?: number): string {
  if (startLine == null) {
    return path;
  }
  if (endLine == null || endLine === startLine) {
    return `${path}:${startLine}`;
  }
  return `${path}:${startLine}-${endLine}`;
}

function splitTokensByLine(tokens: HighlightToken[]): HighlightToken[][] {
  const lines: HighlightToken[][] = [[]];
  for (const token of tokens) {
    const parts = token.text.split("\n");
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) {
        lines.push([]);
      }
      if (parts[i] !== "") {
        lines[lines.length - 1].push({ text: parts[i], kind: token.kind });
      }
    }
  }
  return lines;
}

function CitationToken({
  token,
  theme
}: {
  token: HighlightToken;
  theme: ThemeMode;
}): React.ReactElement {
  const color = syntaxTokenColor(token.kind, theme);
  return (
    <span
      className={
        token.kind === "plain" ? undefined : `coop-chat-code-token coop-chat-code-token--${token.kind}`
      }
      style={color ? { color } : undefined}
    >
      {token.text}
    </span>
  );
}

export function ChatCodeCitation({
  startLine,
  endLine,
  path,
  code,
  onOpenFile
}: ChatCodeCitationProps): React.ReactElement {
  const [copied, setCopied] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>(readDocumentTheme);
  const label = citationLabel(path, startLine, endLine);
  const hasPreview = code.trim().length > 0;
  const language = languageFromFilePath(path);
  const tokens = useMemo(() => lightHighlight(code, language), [code, language]);
  const lines = useMemo(() => splitTokensByLine(tokens), [tokens]);
  const showGutters = startLine != null && lines.length > 0;

  useEffect(() => {
    const root = document.documentElement;
    const apply = () => setTheme(readDocumentTheme());
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

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
        {onOpenFile ? (
          <button
            type="button"
            className="coop-patch-file-path"
            onClick={() => onOpenFile(path, startLine)}
            title={`Open ${label}`}
          >
            {label}
          </button>
        ) : (
          <span className="coop-patch-file-path">{label}</span>
        )}
        {hasPreview ? (
          <button type="button" className="coop-text-btn" onClick={handleCopy}>
            {copied ? "Copied" : "Copy"}
          </button>
        ) : null}
      </div>
      {hasPreview ? (
        <div className={`coop-chat-citation-body${showGutters ? "" : " coop-chat-citation-body--plain"}`}>
          {lines.map((lineTokens, index) => (
            <div key={`cite-line-${index}`} className="coop-chat-citation-line">
              {showGutters ? (
                <span className="coop-patch-gutter" aria-hidden="true">
                  {String((startLine as number) + index).padStart(4, " ")}
                </span>
              ) : null}
              <span className="coop-chat-citation-text">
                {lineTokens.length === 0
                  ? " "
                  : lineTokens.map((token, tokenIndex) => (
                      <CitationToken
                        key={`cite-line-${index}-token-${tokenIndex}`}
                        token={token}
                        theme={theme}
                      />
                    ))}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
