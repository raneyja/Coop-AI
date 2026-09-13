import React, { useCallback, useState } from "react";
import { SourcesFoldExpandContext } from "../evidenceConnectionExpandContext";

function Chevron({ open }: { open: boolean }): React.ReactElement {
  return (
    <svg
      className={`coop-agent-chevron${open ? " coop-agent-chevron--open" : ""}`}
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

/** Thinking-style fold around a turn's Sources cards. */
export function SourcesFold({ children }: { children: React.ReactNode }): React.ReactElement {
  const [open, setOpen] = useState(true);
  const ensureOpen = useCallback(() => {
    setOpen(true);
  }, []);

  return (
    <SourcesFoldExpandContext.Provider value={ensureOpen}>
      <article className="chat-message chat-message--sources-fold" data-role="evidence">
        <div className="chat-message-inner chat-message-inner--sources-fold">
          <div className="coop-agent-thinking">
            <button
              type="button"
              className="coop-agent-thinking-toggle"
              aria-expanded={open}
              onClick={() => setOpen((value) => !value)}
            >
              <span className="coop-agent-thinking-title">Sources</span>
              <Chevron open={open} />
            </button>
            <div className="coop-sources-fold-body" hidden={!open} aria-hidden={!open}>
              {children}
            </div>
          </div>
        </div>
      </article>
    </SourcesFoldExpandContext.Provider>
  );
}
