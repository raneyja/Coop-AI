import React from "react";

export type SavedPromptItem = {
  id: string;
  title: string;
  actionId?: string;
};

type SavedPromptsMenuProps = {
  prompts: SavedPromptItem[];
  disabled?: boolean;
  onRun: (id: string) => void;
  onSaveCurrent: () => void;
};

export function SavedPromptsMenu({
  prompts,
  disabled,
  onRun,
  onSaveCurrent
}: SavedPromptsMenuProps): React.ReactElement {
  return (
    <div className="flex flex-wrap items-center gap-1 px-3 pb-1">
      <span className="text-[10px] uppercase tracking-wide text-[var(--vscode-descriptionForeground)]">Workspace</span>
      {prompts.length === 0 ? (
        <span className="text-[11px] text-[var(--vscode-descriptionForeground)]">No .coop/prompts.json</span>
      ) : (
        prompts.map((prompt) => (
          <button
            key={prompt.id}
            type="button"
            disabled={disabled}
            className="coop-quick-action-pill !h-auto !px-2 !py-0.5 text-[10px]"
            onClick={() => onRun(prompt.id)}
          >
            {prompt.title}
          </button>
        ))
      )}
      <button
        type="button"
        disabled={disabled}
        className="coop-text-btn text-[10px]"
        onClick={onSaveCurrent}
      >
        Save prompt…
      </button>
    </div>
  );
}
