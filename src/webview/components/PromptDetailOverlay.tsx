import React, { useEffect } from "react";
import { CoopPanelHeader } from "./CoopPanelHeader";

export type PromptDetailDraft = {
  title: string;
  template: string;
};

type PromptDetailOverlayProps = {
  headerTitle: string;
  draft: PromptDetailDraft;
  onChange: (draft: PromptDetailDraft) => void;
  onDiscard: () => void;
  onSave: () => void;
};

export function PromptDetailOverlay({
  headerTitle,
  draft,
  onChange,
  onDiscard,
  onSave
}: PromptDetailOverlayProps): React.ReactElement {
  const canSave = draft.title.trim().length > 0 && draft.template.trim().length > 0;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onDiscard();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onDiscard]);

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
          title={headerTitle}
          onClose={onDiscard}
          closeAriaLabel="Close"
        />

        <label className="coop-prompt-editor-field">
          <span className="coop-prompt-modal-section-title">Title</span>
          <input
            type="text"
            value={draft.title}
            onChange={(event) => onChange({ ...draft, title: event.target.value })}
            placeholder="Name this prompt"
            className="coop-prompt-modal-search"
            autoFocus
          />
        </label>

        <label className="coop-prompt-editor-field">
          <span className="coop-prompt-modal-section-title">Prompt</span>
          <textarea
            value={draft.template}
            onChange={(event) => onChange({ ...draft, template: event.target.value })}
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
