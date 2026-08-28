import React, { useEffect, useState } from "react";
import { ChatCodeSurfaceBody } from "./ChatCodeSurfaceBody";

type ChatCodeBlockProps = {
  language?: string;
  code: string;
  className?: string;
};

const HIDDEN_ANONYMOUS_LABELS = new Set(["text", "plaintext"]);

/** Header label for invented examples. Never TEXT — that was the old markdown card. */
export function anonymousCodeSurfaceLabel(language?: string): string | undefined {
  const lang = language?.trim().toLowerCase();
  if (!lang || HIDDEN_ANONYMOUS_LABELS.has(lang)) {
    return undefined;
  }
  return lang;
}

/**
 * Anonymous / invented example fences only.
 * Same coop-patch-file family as cite — not a ChatGPT language-badge + Copy card.
 */
export function ChatCodeBlock({ language, code, className }: ChatCodeBlockProps): React.ReactElement {
  const [copied, setCopied] = useState(false);
  const label = anonymousCodeSurfaceLabel(language);
  const hasPreview = code.trim().length > 0;

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

  const rootClassName = ["coop-patch-file", "coop-chat-citation", className].filter(Boolean).join(" ");

  return (
    <section className={rootClassName} data-code-surface="anonymous">
      <div className="coop-patch-file-header">
        {label ? <span className="coop-patch-file-lang">{label}</span> : <span />}
        {hasPreview ? (
          <button type="button" className="coop-text-btn" onClick={handleCopy}>
            {copied ? "Copied" : "Copy"}
          </button>
        ) : null}
      </div>
      <ChatCodeSurfaceBody code={code} language={language} />
    </section>
  );
}
