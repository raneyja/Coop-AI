import React, { useEffect, useRef } from "react";
import { PromptLibraryMenu } from "./PromptLibraryMenu";
import type { PromptLibraryItem } from "./promptLibraryTypes";
import { resolveTopPrompts } from "./promptLibraryTypes";

type PromptLibraryPillProps = {
  prompts: PromptLibraryItem[];
  pinnedIds: string[];
  hasWorkspace: boolean;
  disabled?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRun: (id: string) => void;
  onSeeAll: () => void;
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

export function PromptLibraryPill({
  prompts,
  pinnedIds,
  hasWorkspace,
  disabled,
  open,
  onOpenChange,
  onRun,
  onSeeAll
}: PromptLibraryPillProps): React.ReactElement {
  const rootRef = useRef<HTMLDivElement>(null);
  const topPrompts = resolveTopPrompts(prompts, pinnedIds);
  const isDisabled = disabled || !hasWorkspace;
  const title = hasWorkspace
    ? "Browse saved prompts"
    : "Open a folder to use workspace prompts";

  useEffect(() => {
    if (!open) {
      return;
    }
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        onOpenChange(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onOpenChange(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onOpenChange]);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <PromptLibraryMenu
        open={open && !isDisabled}
        topPrompts={topPrompts}
        onRun={(id) => {
          onOpenChange(false);
          onRun(id);
        }}
        onSeeAll={() => {
          onOpenChange(false);
          onSeeAll();
        }}
      />
      <button
        type="button"
        className="coop-composer-pill"
        disabled={isDisabled}
        title={title}
        aria-label={title}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => {
          if (!isDisabled) {
            onOpenChange(!open);
          }
        }}
      >
        <span>Prompts</span>
        <ChevronIcon open={open} />
      </button>
    </div>
  );
}
