import React from "react";
import { MAX_PINNED_PROMPTS } from "./promptLibraryTypes";
import type { PromptLibraryItem } from "./promptLibraryTypes";

type PromptLibraryTop5EditorProps = {
  prompts: PromptLibraryItem[];
  pinnedIds: string[];
  hasWorkspace: boolean;
  onUpdatePinned: (pinnedIds: string[]) => void;
  onManageLibrary: () => void;
};

const EMPTY_VALUE = "";

export function PromptLibraryTop5Editor({
  prompts,
  pinnedIds,
  hasWorkspace,
  onUpdatePinned,
  onManageLibrary
}: PromptLibraryTop5EditorProps): React.ReactElement {
  const slots = Array.from({ length: MAX_PINNED_PROMPTS }, (_, index) => pinnedIds[index] ?? EMPTY_VALUE);

  const setSlot = (index: number, id: string) => {
    const next = [...slots];
    if (id) {
      for (let slotIndex = 0; slotIndex < next.length; slotIndex += 1) {
        if (slotIndex !== index && next[slotIndex] === id) {
          next[slotIndex] = EMPTY_VALUE;
        }
      }
    }
    next[index] = id;
    onUpdatePinned(next.filter(Boolean));
  };

  const moveSlot = (index: number, direction: -1 | 1) => {
    const next = [...pinnedIds];
    const target = index + direction;
    if (target < 0 || target >= next.length) {
      return;
    }
    [next[index], next[target]] = [next[target], next[index]];
    onUpdatePinned(next);
  };

  const clearSlot = (index: number) => {
    onUpdatePinned(pinnedIds.filter((_, slotIndex) => slotIndex !== index));
  };

  return (
    <div className="space-y-3">
      <p className="coop-settings-row-desc">
        Choose up to 5 prompts for quick access in chat. Pin order is personal to you.
      </p>
      {!hasWorkspace ? (
        <p className="coop-settings-row-desc">Open a folder to load workspace prompts.</p>
      ) : (
        <ul className="space-y-2">
          {slots.map((slotId, index) => (
            <li key={index} className="flex items-center gap-2">
              <span className="w-4 shrink-0 text-[11px] text-[var(--coop-panel-muted)]">{index + 1}.</span>
              <select
                className="coop-settings-field min-w-0 flex-1"
                value={slotId}
                disabled={!hasWorkspace}
                onChange={(event) => setSlot(index, event.target.value)}
                aria-label={`Top prompt slot ${index + 1}`}
              >
                <option value={EMPTY_VALUE}>— empty —</option>
                {prompts.map((prompt) => (
                  <option key={prompt.id} value={prompt.id}>
                    {prompt.title}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="coop-prompt-modal-icon-btn"
                aria-label={`Move slot ${index + 1} up`}
                disabled={index === 0 || !slotId}
                onClick={() => moveSlot(index, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                className="coop-prompt-modal-icon-btn"
                aria-label={`Move slot ${index + 1} down`}
                disabled={index >= pinnedIds.length - 1 || !slotId}
                onClick={() => moveSlot(index, 1)}
              >
                ↓
              </button>
              <button
                type="button"
                className="coop-prompt-modal-icon-btn"
                aria-label={`Clear slot ${index + 1}`}
                disabled={!slotId}
                onClick={() => clearSlot(index)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="coop-settings-action-btn" onClick={onManageLibrary}>
        Manage library…
      </button>
    </div>
  );
}
