import React, { useEffect, useMemo, useRef, useState } from "react";
import { resolveQuickActionItems } from "../lib/quickActionItems";
import type { QuickActionId, RepoContext } from "../types";

type WorkflowsMenuProps = {
  context: RepoContext;
  disabled?: boolean;
  onAction: (actionId: QuickActionId, prompt: string) => void;
};

function ChevronIcon({ open }: { open: boolean }): React.ReactElement {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={`shrink-0 opacity-70 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
    >
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Header entry point for the five structured quick actions.
 * Runs the same `onAction(id, prompt)` path as the former empty-state grid and slash commands.
 */
export function WorkflowsMenu({
  context,
  disabled,
  onAction
}: WorkflowsMenuProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const actions = useMemo(() => resolveQuickActionItems(context), [context]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="coop-workflows-menu relative shrink-0">
      <button
        type="button"
        className="coop-composer-pill"
        disabled={disabled}
        title="Run a structured workflow"
        aria-label="Workflows"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => {
          if (!disabled) {
            setOpen((value) => !value);
          }
        }}
      >
        <span>Workflows</span>
        <ChevronIcon open={open} />
      </button>
      {open && !disabled ? (
        <div className="coop-workflows-menu-panel" role="menu" aria-label="Workflows">
          <ul className="coop-prompt-menu-list m-0 list-none p-1">
            {actions.map((action) => (
              <li key={action.id}>
                <button
                  type="button"
                  role="menuitem"
                  disabled={action.blocked}
                  title={action.hint}
                  aria-label={`${action.label}: ${action.hint}`}
                  className={`coop-prompt-menu-row${action.dimmed ? " opacity-70" : ""}`}
                  onClick={() => {
                    setOpen(false);
                    onAction(action.id, action.prompt(context));
                  }}
                >
                  <span className="coop-prompt-menu-row-label">{action.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
