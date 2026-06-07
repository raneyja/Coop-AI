import React, { useEffect, useMemo, useState } from "react";
import { lightHighlight } from "../lib/lightHighlight";

type ChatCodeBlockProps = {
  language?: string;
  code: string;
  className?: string;
};

export function ChatCodeBlock({ language, code, className }: ChatCodeBlockProps): React.ReactElement {
  const [copied, setCopied] = useState(false);
  const tokens = useMemo(() => lightHighlight(code, language), [code, language]);
  const languageLabel = language?.trim() ? language.trim() : "text";

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
    <div className={rootClassName}>
      <div className="coop-chat-code-header">
        <span className="coop-chat-code-lang">{languageLabel}</span>
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
