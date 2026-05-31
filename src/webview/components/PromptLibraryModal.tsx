import React, { useEffect, useMemo, useState } from "react";
import { MAX_PINNED_PROMPTS } from "./promptLibraryTypes";
import type { PromptLibraryItem } from "./promptLibraryTypes";
import { resolveTopPrompts } from "./promptLibraryTypes";

type PromptLibraryModalProps = {
  open: boolean;
  prompts: PromptLibraryItem[];
  pinnedIds: string[];
  hasWorkspace: boolean;
  currentInput?: string;
  onClose: () => void;
  onRun?: (id: string) => void;
  onSave: (payload: { title: string; template: string }) => void;
  onUpdate: (payload: { id: string; title: string; template: string }) => void;
  onDelete: (id: string) => void;
  onUpdatePinned: (pinnedIds: string[]) => void;
};

type EditorState =
  | { mode: "closed" }
  | { mode: "new"; title: string; template: string }
  | { mode: "edit"; id: string; title: string; template: string };

function CloseIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

type PromptEditorOverlayProps = {
  editor: Exclude<EditorState, { mode: "closed" }>;
  onChange: (editor: Exclude<EditorState, { mode: "closed" }>) => void;
  onCancel: () => void;
  onSave: () => void;
};

function PromptEditorOverlay({
  editor,
  onChange,
  onCancel,
  onSave
}: PromptEditorOverlayProps): React.ReactElement {
  const isNew = editor.mode === "new";

  return (
    <div
      className="coop-prompt-modal-stack"
      role="presentation"
      onClick={onCancel}
    >
      <div
        className="coop-prompt-modal coop-prompt-editor-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="coop-prompt-editor-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="coop-prompt-modal-header">
          <h2 id="coop-prompt-editor-title" className="coop-prompt-modal-title">
            {isNew ? "New prompt" : "Edit prompt"}
          </h2>
          <button type="button" className="coop-icon-btn" aria-label="Cancel" onClick={onCancel}>
            <CloseIcon />
          </button>
        </header>

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
            placeholder="Write your prompt here…"
            rows={6}
            className="coop-prompt-modal-textarea coop-prompt-editor-textarea"
          />
        </label>

        <div className="coop-prompt-modal-actions">
          <button type="button" className="coop-settings-action-btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="coop-settings-action-btn"
            onClick={onSave}
            disabled={!editor.title.trim() || !editor.template.trim()}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

export function PromptLibraryModal({
  open,
  prompts,
  pinnedIds,
  hasWorkspace,
  currentInput = "",
  onClose,
  onRun,
  onSave,
  onUpdate,
  onDelete,
  onUpdatePinned
}: PromptLibraryModalProps): React.ReactElement | null {
  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState<EditorState>({ mode: "closed" });
  const [pinMessage, setPinMessage] = useState<string | undefined>();

  useEffect(() => {
    if (!open) {
      setSearch("");
      setEditor({ mode: "closed" });
      setPinMessage(undefined);
    }
  }, [open]);

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

  const topPrompts = useMemo(() => resolveTopPrompts(prompts, pinnedIds), [prompts, pinnedIds]);
  const filteredPrompts = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return prompts;
    }
    return prompts.filter((prompt) => prompt.title.toLowerCase().includes(query));
  }, [prompts, search]);

  if (!open) {
    return null;
  }

  const movePinned = (index: number, direction: -1 | 1) => {
    const next = [...pinnedIds];
    const target = index + direction;
    if (target < 0 || target >= next.length) {
      return;
    }
    [next[index], next[target]] = [next[target], next[index]];
    onUpdatePinned(next);
  };

  const unpinAt = (index: number) => {
    onUpdatePinned(pinnedIds.filter((_, i) => i !== index));
  };

  const togglePin = (id: string) => {
    setPinMessage(undefined);
    if (pinnedIds.includes(id)) {
      onUpdatePinned(pinnedIds.filter((entry) => entry !== id));
      return;
    }
    if (pinnedIds.length >= MAX_PINNED_PROMPTS) {
      setPinMessage("Unpin a prompt from your top 5 before adding another.");
      return;
    }
    onUpdatePinned([...pinnedIds, id]);
  };

  const submitEditor = () => {
    if (editor.mode === "closed") {
      return;
    }
    const title = editor.title.trim();
    const template = editor.template.trim();
    if (!title || !template) {
      return;
    }
    if (editor.mode === "new") {
      onSave({ title, template });
    } else {
      onUpdate({ id: editor.id, title, template });
    }
    setEditor({ mode: "closed" });
  };

  const openNewEditor = (template = "") => {
    setEditor({ mode: "new", title: "", template });
  };

  return (
    <div
      className="coop-prompt-modal-backdrop"
      role="presentation"
      onClick={editor.mode === "closed" ? onClose : undefined}
    >
      <div
        className="coop-prompt-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="coop-prompt-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="coop-prompt-modal-header">
          <h2 id="coop-prompt-modal-title" className="coop-prompt-modal-title">
            Prompt library
          </h2>
          <button type="button" className="coop-icon-btn" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </header>

        {!hasWorkspace ? (
          <p className="coop-prompt-modal-empty">
            Open a folder to save and run workspace prompts.
          </p>
        ) : (
          <>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search prompts…"
              className="coop-prompt-modal-search"
              aria-label="Search prompts"
            />

            {pinMessage ? (
              <p className="coop-prompt-modal-note" role="status">
                {pinMessage}
              </p>
            ) : null}

            <section className="coop-prompt-modal-section">
              <h3 className="coop-prompt-modal-section-title">Top 5 (personal)</h3>
              {topPrompts.length === 0 ? (
                <p className="coop-prompt-modal-muted">Pin prompts below to show them in chat.</p>
              ) : (
                <ul className="coop-prompt-modal-top-list">
                  {topPrompts.map((prompt, index) => (
                    <li key={prompt.id} className="coop-prompt-modal-top-row">
                      <span className="coop-prompt-modal-top-index">{index + 1}.</span>
                      <span className="min-w-0 flex-1 truncate">{prompt.title}</span>
                      <div className="flex shrink-0 items-center gap-0.5">
                        <button
                          type="button"
                          className="coop-prompt-modal-icon-btn"
                          aria-label={`Move ${prompt.title} up`}
                          disabled={index === 0}
                          onClick={() => movePinned(index, -1)}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="coop-prompt-modal-icon-btn"
                          aria-label={`Move ${prompt.title} down`}
                          disabled={index === topPrompts.length - 1}
                          onClick={() => movePinned(index, 1)}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          className="coop-prompt-modal-icon-btn"
                          aria-label={`Unpin ${prompt.title}`}
                          onClick={() => unpinAt(index)}
                        >
                          ×
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {Array.from({ length: Math.max(0, MAX_PINNED_PROMPTS - topPrompts.length) }).map((_, index) => (
                <p key={`empty-${index}`} className="coop-prompt-modal-slot">
                  {topPrompts.length + index + 1}. Add prompt…
                </p>
              ))}
            </section>

            <section className="coop-prompt-modal-section coop-prompt-modal-scroll">
              <h3 className="coop-prompt-modal-section-title">All prompts</h3>
              {filteredPrompts.length === 0 ? (
                <p className="coop-prompt-modal-muted">No prompts yet.</p>
              ) : (
                <ul className="coop-prompt-modal-all-list">
                  {filteredPrompts.map((prompt) => {
                    const pinned = pinnedIds.includes(prompt.id);
                    return (
                      <li key={prompt.id} className="coop-prompt-modal-all-row">
                        <button
                          type="button"
                          className="min-w-0 flex-1 truncate text-left"
                          onClick={() => onRun?.(prompt.id)}
                          title={onRun ? "Run prompt" : prompt.title}
                        >
                          {prompt.title}
                        </button>
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            className="coop-prompt-modal-icon-btn"
                            aria-label={pinned ? `Unpin ${prompt.title}` : `Pin ${prompt.title}`}
                            onClick={() => togglePin(prompt.id)}
                          >
                            {pinned ? "★" : "☆"}
                          </button>
                          <button
                            type="button"
                            className="coop-prompt-modal-icon-btn"
                            aria-label={`Edit ${prompt.title}`}
                            onClick={() =>
                              setEditor({
                                mode: "edit",
                                id: prompt.id,
                                title: prompt.title,
                                template: prompt.template ?? ""
                              })
                            }
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="coop-prompt-modal-icon-btn"
                            aria-label={`Delete ${prompt.title}`}
                            onClick={() => onDelete(prompt.id)}
                          >
                            Del
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <footer className="coop-prompt-modal-footer">
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
                onClick={() => openNewEditor(currentInput.trim())}
                disabled={!currentInput.trim()}
              >
                Save current
              </button>
            </footer>
          </>
        )}
      </div>

      {editor.mode !== "closed" ? (
        <PromptEditorOverlay
          editor={editor}
          onChange={setEditor}
          onCancel={() => setEditor({ mode: "closed" })}
          onSave={submitEditor}
        />
      ) : null}
    </div>
  );
}
