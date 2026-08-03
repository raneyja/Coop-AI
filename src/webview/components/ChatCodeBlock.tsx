import React, { useEffect, useMemo, useState } from "react";
import { lightHighlight } from "../lib/lightHighlight";

type ChatCodeBlockProps = {
  language?: string;
  code: string;
  className?: string;
};

/**
 * Anonymous / invented example fences only.
 * Repo references must use ChatCodeCitation (cite surface) — never this with a missing language → "TEXT".
 */
export function ChatCodeBlock({ language, code, className }: ChatCodeBlockProps): React.ReactElement {
  const [copied, setCopied] = useState(false);
  const tokens = useMemo(() => lightHighlight(code, language), [code, language]);
  const languageLabel = language?.trim() || undefined;

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = window.setTimeout(() => setCopied(false), 1200);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const rootClassName = className ? `coop-chat-code-block ${className}` : "coop-chat-code-block";

  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className={rootClassName} data-code-surface="anonymous">
      <div className={`coop-chat-code-header${languageLabel ? "" : " coop-chat-code-header--copy-only"}`}>
        {languageLabel ? <span className="coop-chat-code-lang">{languageLabel}</span> : <span />}
        <button type="button" className="coop-text-btn coop-chat-code-copy" onClick={handleCopy}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>
        <code>
          {tokens.map((token, index) => (
            <span
              key={`token-${index}`}
              className={
                token.kind === "plain" ? undefined : `coop-chat-code-token coop-chat-code-token--${token.kind}`
              }
            >
              {token.text}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}
