import React from "react";
import type { PromptLibraryItem } from "./promptLibraryTypes";

type PromptLibraryMenuProps = {
  open: boolean;
  topPrompts: PromptLibraryItem[];
  onRun: (id: string) => void;
  onSeeAll: () => void;
};

export function PromptLibraryMenu({
  open,
  topPrompts,
  onRun,
  onSeeAll
}: PromptLibraryMenuProps): React.ReactElement | null {
  if (!open) {
    return null;
  }

  return (
    <div className="coop-prompt-menu absolute bottom-full left-0 z-40 mb-1.5 w-[min(100%,var(--coop-prompt-panel-width,480px))]">
      <div className="coop-prompt-menu-panel">
        {topPrompts.length === 0 ? (
          <p className="coop-prompt-menu-empty">No pinned prompts yet</p>
        ) : (
          <ul className="coop-prompt-menu-list" role="listbox" aria-label="Pinned prompts">
            {topPrompts.map((prompt) => (
              <li key={prompt.id}>
                <button
                  type="button"
                  role="option"
                  className="coop-prompt-menu-row"
                  onClick={() => onRun(prompt.id)}
                >
                  {prompt.title}
                </button>
              </li>
            ))}
          </ul>
        )}
        <button type="button" className="coop-prompt-menu-footer" onClick={onSeeAll}>
          See all prompts…
        </button>
      </div>
    </div>
  );
}
