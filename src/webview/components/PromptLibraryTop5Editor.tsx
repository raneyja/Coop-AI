import React, { useMemo, useState } from "react";
import { PromptLibraryRow } from "./PromptLibraryRow";
import type { PromptLibraryItem } from "./promptLibraryTypes";
import { resolveTopPrompts } from "./promptLibraryTypes";

type PromptLibraryTop5EditorProps = {
  prompts: PromptLibraryItem[];
  pinnedIds: string[];
  hasWorkspace: boolean;
  onUpdatePinned: (pinnedIds: string[]) => void;
  onManageLibrary: () => void;
};

function reorderPinnedIds(pinnedIds: string[], fromIndex: number, toIndex: number): string[] {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= pinnedIds.length || toIndex >= pinnedIds.length) {
    return pinnedIds;
  }
  const next = [...pinnedIds];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

export function PromptLibraryTop5Editor({
  prompts,
  pinnedIds,
  hasWorkspace,
  onUpdatePinned,
  onManageLibrary
}: PromptLibraryTop5EditorProps): React.ReactElement {
  const topPrompts = useMemo(() => resolveTopPrompts(prompts, pinnedIds), [prompts, pinnedIds]);
  const [dragSourceIndex, setDragSourceIndex] = useState<number | undefined>();
  const [dropTargetIndex, setDropTargetIndex] = useState<number | undefined>();

  const handleDrop = (targetIndex: number) => {
    if (dragSourceIndex === undefined) {
      return;
    }
    onUpdatePinned(reorderPinnedIds(pinnedIds, dragSourceIndex, targetIndex));
    setDragSourceIndex(undefined);
    setDropTargetIndex(undefined);
  };

  return (
    <div className="space-y-3">
      <p className="coop-settings-row-desc">
        Choose up to 5 prompts for quick access in chat. Pin order is personal to you.
      </p>
      {!hasWorkspace ? (
        <p className="coop-settings-row-desc">Open a folder to load workspace prompts.</p>
      ) : topPrompts.length === 0 ? (
        <p className="coop-settings-row-desc">None pinned yet.</p>
      ) : (
        <ul className="coop-prompt-modal-list">
          {topPrompts.map((prompt, index) => (
            <PromptLibraryRow
              key={prompt.id}
              mode="settings"
              prompt={prompt}
              pinned
              pinnedIndex={index}
              pinnedCount={topPrompts.length}
              dragging={dragSourceIndex === index}
              dropTarget={dropTargetIndex === index && dragSourceIndex !== index}
              onDragStart={setDragSourceIndex}
              onDragOver={setDropTargetIndex}
              onDrop={handleDrop}
              onDragEnd={() => {
                setDragSourceIndex(undefined);
                setDropTargetIndex(undefined);
              }}
            />
          ))}
        </ul>
      )}
      <button type="button" className="coop-settings-action-btn" onClick={onManageLibrary}>
        Manage library…
      </button>
    </div>
  );
}
