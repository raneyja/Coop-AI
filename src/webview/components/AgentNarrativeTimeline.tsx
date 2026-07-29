import React from "react";
import type { NarrativeIconKind, NarrativeStep } from "../agentNarrative";
import { splitNarrativeLabelParts } from "../agentNarrative";

function SearchIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="4.25" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10.2 10.2 13.25 13.25" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function ReadIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
      <path
        d="M3.5 3.75h9M3.5 8h9M3.5 12.25h6"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function GenericIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="2.1" fill="currentColor" />
    </svg>
  );
}

function StepIcon({ kind, status }: { kind: NarrativeIconKind; status: NarrativeStep["status"] }): React.ReactElement {
  if (status === "active" || kind === "loading") {
    return <span className="chat-narrative-loading-dot" aria-hidden="true" />;
  }
  if (kind === "search") {
    return <SearchIcon />;
  }
  if (kind === "read") {
    return <ReadIcon />;
  }
  return <GenericIcon />;
}

function NarrativeLabel({ label }: { label: string }): React.ReactElement {
  const parts = splitNarrativeLabelParts(label);
  return (
    <span className="chat-narrative-label">
      {parts.map((part, index) =>
        part.type === "code" ? (
          <code key={`${part.value}-${index}`} className="chat-narrative-code">
            {part.value}
          </code>
        ) : (
          <span key={`${part.value}-${index}`}>{part.value}</span>
        )
      )}
    </span>
  );
}

/** Copilot/Cursor-style tool activity chain while Coop gathers context. */
export function AgentNarrativeTimeline({ steps }: { steps: NarrativeStep[] }): React.ReactElement | null {
  if (!steps.length) {
    return null;
  }
  return (
    <article className="chat-message chat-message--narrative" role="status" aria-live="polite">
      <div className="chat-message-inner chat-message-inner--narrative">
        <ol className="chat-narrative-list">
          {steps.map((step) => (
            <li
              key={step.id}
              className={`chat-narrative-step chat-narrative-step--${step.status}`}
              data-status={step.status}
            >
              <span className="chat-narrative-rail" aria-hidden="true">
                <span className={`chat-narrative-glyph chat-narrative-glyph--${step.status}`}>
                  <StepIcon kind={step.icon} status={step.status} />
                </span>
              </span>
              <NarrativeLabel label={step.label} />
            </li>
          ))}
        </ol>
      </div>
    </article>
  );
}
