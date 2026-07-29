import React, { useEffect, useState } from "react";

type ModelThinkingBlockProps = {
  text: string;
  /** When true, keep the block expanded (thinking still streaming). */
  streaming?: boolean;
};

function Chevron({ expanded }: { expanded: boolean }): React.ReactElement {
  return (
    <svg
      className={`chat-model-thinking-chevron${expanded ? " chat-model-thinking-chevron--open" : ""}`}
      viewBox="0 0 12 12"
      width="12"
      height="12"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4.25 2.75 7.5 6 4.25 9.25"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Live-only model reasoning — Cursor/Copilot indented thought rail. Not persisted. */
export function ModelThinkingBlock({ text, streaming = false }: ModelThinkingBlockProps): React.ReactElement | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    // Stream open; collapse when the answer takes over (Cursor-style).
    setExpanded(streaming);
  }, [streaming]);

  const title = streaming ? "Thinking" : "Thought";

  return (
    <article className="chat-message chat-message--model-thinking" aria-label={title}>
      <div className="chat-message-inner chat-message-inner--model-thinking">
        <button
          type="button"
          className="chat-model-thinking-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          <Chevron expanded={expanded} />
          <span className="chat-model-thinking-title">
            {title}
            {streaming ? <span className="chat-model-thinking-ellipsis" aria-hidden="true" /> : null}
          </span>
        </button>
        {expanded ? (
          <div
            className={`chat-model-thinking-body${streaming ? " chat-model-thinking-body--streaming" : ""}`}
            aria-live={streaming ? "polite" : "off"}
          >
            {trimmed}
          </div>
        ) : null}
      </div>
    </article>
  );
}
