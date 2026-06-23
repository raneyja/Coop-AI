import React, { useEffect, useMemo, useState } from "react";
import { CoopPanelHeader } from "./CoopPanelHeader";
import { PromptLibraryRow } from "./PromptLibraryRow";
import {
  createDraftPromptId,
  MAX_PINNED_PROMPTS,
  partitionPrompts,
  promptLibrarySnapshotsEqual
} from "./promptLibraryTypes";
import type { PromptLibraryItem } from "./promptLibraryTypes";

type PromptLibraryModalProps = {
  open: boolean;
  prompts: PromptLibraryItem[];
  pinnedIds: string[];
  hasWorkspace: boolean;
  onClose: () => void;
  onRun?: (id: string) => void;
  onCommit: (payload: { prompts: PromptLibraryItem[]; pinnedIds: string[] }) => void;
};

type EditorState =
  | { mode: "closed" }
  | { mode: "new"; title: string; template: string }
  | { mode: "edit"; id: string; title: string; template: string };

type PromptDetailOverlayProps = {
  editor: Exclude<EditorState, { mode: "closed" }>;
  onChange: (editor: Exclude<EditorState, { mode: "closed" }>) => void;
  onDiscard: () => void;
  onSave: () => void;
};

function PromptDetailOverlay({
  editor,
  onChange,
  onDiscard,
  onSave
}: PromptDetailOverlayProps): React.ReactElement {
  const isNew = editor.mode === "new";
  const canSave = editor.title.trim().length > 0 && editor.template.trim().length > 0;

  return (
    <div
      className="coop-prompt-modal-stack"
      role="presentation"
      onClick={onDiscard}
    >
      <div
        className="coop-prompt-modal coop-prompt-editor-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="coop-prompt-editor-title"
        onClick={(event) => event.stopPropagation()}
      >
        <CoopPanelHeader
          variant="modal"
          titleElement="h2"
          titleId="coop-prompt-editor-title"
          title={isNew ? "New prompt" : "Edit prompt"}
          onClose={onDiscard}
          closeAriaLabel="Close"
        />

        <label className="coop-prompt-editor-field">
          <span className="coop-prompt-modal-section-title">Title</span>
          <input
            type="text"
            value={editor.title}
            onChange={(event) => onChange({ ...editor, title: event.target.value })}
            placeholder="Name this prompt"
            className="coop-prompt-modal-search"
            autoFocus
          />
        </label>

        <label className="coop-prompt-editor-field">
          <span className="coop-prompt-modal-section-title">Prompt</span>
          <textarea
            value={editor.template}
            onChange={(event) => onChange({ ...editor, template: event.target.value })}
            placeholder="Write your prompt… Use {{file}}, {{repo}}, {{branch}}, {{lines}}, or a slash command like /understand"
            rows={6}
            className="coop-prompt-modal-textarea coop-prompt-editor-textarea"
          />
        </label>

        <div className="coop-prompt-modal-actions">
          <button type="button" className="coop-settings-action-btn" onClick={onDiscard}>
            Cancel
          </button>
          <button
            type="button"
            className="coop-settings-action-btn"
            onClick={onSave}
            disabled={!canSave}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function reorderPinnedIds(pinnedIds: string[], fromIndex: number, toIndex: number): string[] {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= pinnedIds.length || toIndex >= pinnedIds.length) {
    return pinnedIds;
  }
  const next = [...pinnedIds];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

function clonePrompts(prompts: PromptLibraryItem[]): PromptLibraryItem[] {
  return prompts.map((prompt) => ({ ...prompt }));
}

export function PromptLibraryModal({
  open,
  prompts,
  pinnedIds,
  hasWorkspace,
  onClose,
  onRun,
  onCommit
}: PromptLibraryModalProps): React.ReactElement | null {
  const [search, setSearch] = useState("");
  const [draftPrompts, setDraftPrompts] = useState<PromptLibraryItem[]>(() => clonePrompts(prompts));
  const [draftPinnedIds, setDraftPinnedIds] = useState<string[]>(() => [...pinnedIds]);
  const [editor, setEditor] = useState<EditorState>({ mode: "closed" });
  const [pinMessage, setPinMessage] = useState<string | undefined>();
  const [dragSourceIndex, setDragSourceIndex] = useState<number | undefined>();
  const [dropTargetIndex, setDropTargetIndex] = useState<number | undefined>();

  useEffect(() => {
    if (!open) {
      setSearch("");
      setEditor({ mode: "closed" });
      setPinMessage(undefined);
      setDragSourceIndex(undefined);
      setDropTargetIndex(undefined);
      return;
    }
    setDraftPrompts(clonePrompts(prompts));
    setDraftPinnedIds([...pinnedIds]);
  }, [open, prompts, pinnedIds]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (editor.mode !== "closed") {
          setEditor({ mode: "closed" });
        } else {
          onClose();
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, editor.mode, onClose]);

  const savedSnapshot = useMemo(() => ({ prompts, pinnedIds }), [prompts, pinnedIds]);
  const isDirty = useMemo(
    () =>
      !promptLibrarySnapshotsEqual(savedSnapshot, {
        prompts: draftPrompts,
        pinnedIds: draftPinnedIds
      }),
    [savedSnapshot, draftPrompts, draftPinnedIds]
  );

  const { pinned, unpinned } = useMemo(
    () => partitionPrompts(draftPrompts, draftPinnedIds, search),
    [draftPrompts, draftPinnedIds, search]
  );

  if (!open) {
    return null;
  }

  const togglePin = (id: string) => {
    setPinMessage(undefined);
    setDraftPinnedIds((current) => {
      if (current.includes(id)) {
        return current.filter((entry) => entry !== id);
      }
      if (current.length >= MAX_PINNED_PROMPTS) {
        setPinMessage("Unpin a prompt from your top 5 before adding another.");
        return current;
      }
      return [...current, id];
    });
  };

  const deleteDraftPrompt = (id: string) => {
    setDraftPrompts((current) => current.filter((prompt) => prompt.id !== id));
    setDraftPinnedIds((current) => current.filter((entry) => entry !== id));
  };

  const applyEditorToDraft = () => {
    if (editor.mode !== "new" && editor.mode !== "edit") {
      return;
    }
    const title = editor.title.trim();
    const template = editor.template.trim();
    if (!title || !template) {
      return;
    }
    if (editor.mode === "new") {
      setDraftPrompts((current) => [...current, { id: createDraftPromptId(), title, template }]);
    } else {
      setDraftPrompts((current) =>
        current.map((prompt) =>
          prompt.id === editor.id ? { ...prompt, title, template } : prompt
        )
      );
    }
    setEditor({ mode: "closed" });
  };

  const openNewEditor = () => {
    setEditor({ mode: "new", title: "", template: "" });
  };

  const openEdit = (entry: PromptLibraryItem) => {
    setEditor({
      mode: "edit",
      id: entry.id,
      title: entry.title,
      template: entry.template ?? ""
    });
  };

  const handleDrop = (targetIndex: number) => {
    if (dragSourceIndex === undefined) {
      return;
    }
    setDraftPinnedIds((current) => reorderPinnedIds(current, dragSourceIndex, targetIndex));
    setDragSourceIndex(undefined);
    setDropTargetIndex(undefined);
  };

  const commitDraft = () => {
    if (!isDirty) {
      return;
    }
    onCommit({
      prompts: draftPrompts.map((prompt) => ({
        id: prompt.id,
        title: prompt.title,
        template: prompt.template ?? "",
        actionId: prompt.actionId
      })),
      pinnedIds: draftPinnedIds
    });
  };

  const hasPrompts = draftPrompts.length > 0;
  const hasResults = pinned.length > 0 || unpinned.length > 0;
  const showPinHint = pinned.length === 0 && hasResults;
  const editorOpen = editor.mode !== "closed";

  return (
    <div
      className="coop-prompt-modal-backdrop"
      role="presentation"
      onClick={editorOpen ? undefined : onClose}
    >
      <div
        className="coop-prompt-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="coop-prompt-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <CoopPanelHeader
          variant="modal"
          titleElement="h2"
          titleId="coop-prompt-modal-title"
          title="Prompt library"
          onClose={onClose}
          closeAriaLabel="Close"
        />

        {!hasWorkspace ? (
          <p className="coop-prompt-modal-empty">
            Open a folder to save and run workspace prompts.
          </p>
        ) : (
          <>
            <div className="coop-prompt-modal-inset coop-prompt-modal-inset--top">
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search prompts…"
                className="coop-prompt-modal-search"
                aria-label="Search prompts"
              />
            </div>

            {pinMessage ? (
              <p className="coop-prompt-modal-note coop-prompt-modal-inset" role="status">
                {pinMessage}
              </p>
            ) : null}

            <div className="coop-prompt-modal-body">
              {!hasPrompts ? (
                <p className="coop-prompt-modal-muted">No prompts yet.</p>
              ) : !hasResults ? (
                <p className="coop-prompt-modal-muted">No prompts match your search.</p>
              ) : (
                <>
                  {showPinHint ? (
                    <p className="coop-prompt-modal-muted mb-2">
                      Pin prompts for quick access in chat.
                    </p>
                  ) : null}

                  <ul className="coop-prompt-modal-list">
                    {pinned.map((prompt, index) => (
                      <PromptLibraryRow
                        key={prompt.id}
                        mode="manage"
                        prompt={prompt}
                        pinned
                        pinnedIndex={index}
                        pinnedCount={pinned.length}
                        dragging={dragSourceIndex === index}
                        dropTarget={dropTargetIndex === index && dragSourceIndex !== index}
                        onSelect={openEdit}
                        onTogglePin={togglePin}
                        onEdit={openEdit}
                        onDelete={deleteDraftPrompt}
                        onDragStart={setDragSourceIndex}
                        onDragOver={setDropTargetIndex}
                        onDrop={handleDrop}
                        onDragEnd={() => {
                          setDragSourceIndex(undefined);
                          setDropTargetIndex(undefined);
                        }}
                      />
                    ))}

                    {pinned.length > 0 && unpinned.length > 0 ? (
                      <li className="coop-prompt-modal-list-divider" aria-hidden="true">
                        Other prompts
                      </li>
                    ) : null}

                    {unpinned.map((prompt) => (
                      <PromptLibraryRow
                        key={prompt.id}
                        mode="manage"
                        prompt={prompt}
                        pinned={false}
                        onSelect={openEdit}
                        onTogglePin={togglePin}
                        onEdit={openEdit}
                        onDelete={deleteDraftPrompt}
                      />
                    ))}
                  </ul>
                </>
              )}
            </div>

            <footer className="coop-prompt-modal-footer coop-prompt-modal-inset coop-prompt-modal-inset--bottom">
              <button
                type="button"
                className="coop-settings-action-btn"
                onClick={() => openNewEditor()}
              >
                + New prompt
              </button>
              <button
                type="button"
                className="coop-settings-action-btn"
                onClick={commitDraft}
                disabled={!isDirty}
              >
                Save
              </button>
            </footer>
          </>
        )}
      </div>

      {editorOpen ? (
        <PromptDetailOverlay
          editor={editor}
          onChange={setEditor}
          onDiscard={() => setEditor({ mode: "closed" })}
          onSave={applyEditorToDraft}
        />
      ) : null}
    </div>
  );
}
