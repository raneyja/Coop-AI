import React, { useEffect, useMemo, useState } from "react";
import type { ThemeMode } from "../theme";
import { lightHighlight, splitTokensByLine, type HighlightToken } from "../lib/lightHighlight";
import { syntaxTokenColor } from "../lib/syntaxTokenColors";

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

function ChatSyntaxToken({
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

type ChatCodeSurfaceBodyProps = {
  code: string;
  language?: string;
  startLine?: number;
};

/** Shared cite / anonymous body — editor lines + token colors, never a markdown dump. */
export function ChatCodeSurfaceBody({
  code,
  language,
  startLine
}: ChatCodeSurfaceBodyProps): React.ReactElement | null {
  const [theme, setTheme] = useState<ThemeMode>(readDocumentTheme);
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

  if (code.trim().length === 0) {
    return null;
  }

  return (
    <div className={`coop-chat-citation-body${showGutters ? "" : " coop-chat-citation-body--plain"}`}>
      {lines.map((lineTokens, index) => (
        <div key={`code-line-${index}`} className="coop-chat-citation-line">
          {showGutters ? (
            <span className="coop-patch-gutter" aria-hidden="true">
              {String((startLine as number) + index).padStart(4, " ")}
            </span>
          ) : null}
          <span className="coop-chat-citation-text">
            {lineTokens.length === 0
              ? " "
              : lineTokens.map((token, tokenIndex) => (
                  <ChatSyntaxToken
                    key={`code-line-${index}-token-${tokenIndex}`}
                    token={token}
                    theme={theme}
                  />
                ))}
          </span>
        </div>
      ))}
    </div>
  );
}
