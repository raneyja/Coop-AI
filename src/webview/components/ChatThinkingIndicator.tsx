import React from "react";

const SPARKLE_RAYS = [0, 45, 90, 135] as const;

function ThinkingSparkle(): React.ReactElement {
  return (
    <span className="chat-thinking-sparkle" aria-hidden="true">
      <svg className="chat-thinking-sparkle-svg" viewBox="0 0 14 14" fill="none">
        <g className="chat-thinking-sparkle-core">
          {SPARKLE_RAYS.map((deg, index) => (
            <g key={deg} transform={`rotate(${deg} 7 7)`}>
              <line
                x1="7"
                y1="7"
                x2="7"
                y2="2.5"
                className={`chat-thinking-sparkle-ray chat-thinking-sparkle-ray--${index + 1}`}
              />
            </g>
          ))}
        </g>
      </svg>
    </span>
  );
}

/** Inline loading row shown beneath the latest user turn in the chat thread. */
export function ChatThinkingIndicator({ message }: { message: string }): React.ReactElement {
  return (
    <article className="chat-message chat-message--thinking" role="status" aria-live="polite">
      <div className="chat-message-inner chat-message-inner--thinking">
        <ThinkingSparkle />
        <span className="chat-thinking-text">{message}</span>
      </div>
    </article>
  );
}
