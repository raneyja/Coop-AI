import React, { useEffect, useRef, useState } from "react";
import type { CodeHostProviderPreference } from "../../chat/types";
import { explainPullCreateFailure } from "../../api/codeHosts/pullRequestWrite";
import { ChatActionLink } from "./ChatActionLink";
import { CoopNotice } from "./CoopNotice";
import { CoopPanelHeader } from "./CoopPanelHeader";
import {
  CREATE_PR_DONE_LABEL,
  CREATE_PR_MODAL_CLASSES,
  CREATE_PR_NOT_YET_LABEL,
  CREATE_PR_SUCCESS_TITLE,
  CREATE_PULL_REQUEST_BUTTON_LABEL,
  PR_NOTES_AI_GENERATED_LABEL,
  type CreatePullRequestCreated,
  type CreatePullRequestDraft,
  type CreatePullRequestFile,
  evaluateCreatePullRequest,
  isPullRequestWriteSupported,
  openPullRequestOnHostLabel,
  pullRequestCreatedCopy
} from "../createPullRequestConfirm";

export type CreatePullRequestModalProps = {
  open: boolean;
  provider?: CodeHostProviderPreference;
  branch: string;
  title: string;
  files: CreatePullRequestFile[];
  submitting?: boolean;
  error?: string;
  notesLoading?: boolean;
  generatedNotes?: string;
  created?: CreatePullRequestCreated;
  onClose: () => void;
  onConfirm: (draft: CreatePullRequestDraft) => void;
  onOpenLink?: (url: string) => void;
};

export function CreatePullRequestModal({
  open,
  provider,
  branch: initialBranch,
  title: initialTitle,
  files,
  submitting = false,
  error,
  notesLoading = false,
  generatedNotes,
  created,
  onClose,
  onConfirm,
  onOpenLink
}: CreatePullRequestModalProps): React.ReactElement | null {
  const [branch, setBranch] = useState(initialBranch);
  const [title, setTitle] = useState(initialTitle);
  const [notes, setNotes] = useState("");
  const notesEdited = useRef(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    setBranch(initialBranch);
    setTitle(initialTitle);
    notesEdited.current = false;
    setNotes(generatedNotes ?? "");
  }, [open, initialBranch, initialTitle]);

  useEffect(() => {
    if (!open || notesEdited.current || !generatedNotes?.trim()) {
      return;
    }
    setNotes(generatedNotes);
  }, [open, generatedNotes]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose, submitting]);

  if (!open) {
    return null;
  }

  const supported = isPullRequestWriteSupported(provider);
  const draft: CreatePullRequestDraft = {
    provider,
    branch,
    title,
    body: notes.trim() || undefined,
    files
  };
  const canConfirm = evaluateCreatePullRequest(draft, "confirm").action === "create" && !submitting;
  const createdProvider = created?.provider ?? provider;

  const handleConfirm = () => {
    const result = evaluateCreatePullRequest(draft, "confirm");
    if (result.action !== "create") {
      return;
    }
    onConfirm(result.payload);
  };

  const handleBackdropClick = () => {
    if (!submitting) {
      onClose();
    }
  };

  return (
    <div
      className={CREATE_PR_MODAL_CLASSES.backdrop}
      role="presentation"
      onClick={handleBackdropClick}
    >
      <div
        className={CREATE_PR_MODAL_CLASSES.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={CREATE_PR_MODAL_CLASSES.titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <CoopPanelHeader
          variant="modal"
          titleElement="h2"
          titleId={CREATE_PR_MODAL_CLASSES.titleId}
          title={created ? CREATE_PR_SUCCESS_TITLE : "Create pull request"}
          onClose={submitting ? () => undefined : onClose}
          closeAriaLabel={created ? CREATE_PR_DONE_LABEL : "Cancel"}
        />
        <div className="coop-prompt-modal-body">
          {created ? (
            <>
              <p className="coop-prompt-modal-muted mb-2">{pullRequestCreatedCopy(createdProvider)}</p>
              {onOpenLink ? (
                <p className="coop-prompt-modal-section">
                  <ChatActionLink
                    kind="external"
                    className="break-all"
                    label={created.htmlUrl}
                    onClick={() => onOpenLink(created.htmlUrl)}
                  />
                </p>
              ) : (
                <p className="coop-prompt-modal-note" role="status">
                  {created.htmlUrl}
                </p>
              )}
            </>
          ) : !supported ? (
            <p className="coop-prompt-modal-note" role="status">
              {CREATE_PR_NOT_YET_LABEL}: creating pull requests from Coop is not yet available for{" "}
              {provider === "bitbucket" ? "Bitbucket" : "GitLab"}.
            </p>
          ) : (
            <>
              <p className="coop-prompt-modal-muted mb-2">
                Confirm the branch, title, and notes. Cancel, Escape, or the backdrop creates nothing on the host.
              </p>
              <label className="coop-prompt-modal-section">
                <span className="coop-prompt-modal-section-title">Branch</span>
                <input
                  className="coop-prompt-modal-search"
                  value={branch}
                  onChange={(event) => setBranch(event.target.value)}
                  aria-label="Branch name"
                  autoComplete="off"
                />
              </label>
              <label className="coop-prompt-modal-section">
                <span className="coop-prompt-modal-section-title">Title</span>
                <input
                  className="coop-prompt-modal-search"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  aria-label="Pull request title"
                  autoComplete="off"
                />
              </label>
              <label className="coop-prompt-modal-section">
                <span className="coop-prompt-modal-section-title">
                  Notes <span className="coop-prompt-modal-muted">{PR_NOTES_AI_GENERATED_LABEL}</span>
                </span>
                <textarea
                  className="coop-prompt-modal-textarea"
                  value={notes}
                  onChange={(event) => {
                    notesEdited.current = true;
                    setNotes(event.target.value);
                  }}
                  aria-label="Pull request notes"
                  placeholder={
                    notesLoading ? "Generating summary…" : "Optional. Shown on the pull request."
                  }
                  rows={4}
                />
              </label>
              <div className="coop-prompt-modal-section">
                <p className="coop-prompt-modal-section-title">Files</p>
                {files.length === 0 ? (
                  <p className="coop-prompt-modal-note" role="status">
                    No file contents to commit. Add files before creating a pull request.
                  </p>
                ) : (
                  <ul className="coop-prompt-modal-list">
                    {files.map((file) => (
                      <li key={file.path} className="coop-prompt-modal-row">
                        <span className="coop-prompt-modal-row-title">{file.path}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
          {!created && error ? (
            <CoopNotice
              tone="error"
              compact
              className="mt-2"
              message={explainPullCreateFailure(provider, error)}
            />
          ) : null}
        </div>
        <footer className="coop-prompt-modal-footer coop-prompt-modal-inset coop-prompt-modal-inset--bottom">
          {created ? (
            <>
              {onOpenLink ? (
                <button
                  type="button"
                  className="coop-text-btn"
                  onClick={() => onOpenLink(created.htmlUrl)}
                >
                  {openPullRequestOnHostLabel(createdProvider)}
                </button>
              ) : null}
              <button type="button" className="coop-settings-action-btn" onClick={onClose}>
                {CREATE_PR_DONE_LABEL}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="coop-text-btn" onClick={onClose} disabled={submitting}>
                Cancel
              </button>
              {supported ? (
                <button
                  type="button"
                  className="coop-settings-action-btn"
                  onClick={handleConfirm}
                  disabled={!canConfirm}
                >
                  {submitting ? "Creating…" : CREATE_PULL_REQUEST_BUTTON_LABEL}
                </button>
              ) : null}
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
