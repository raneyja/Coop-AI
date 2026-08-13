import React, { useEffect, useState } from "react";
import type { CodeHostProviderPreference } from "../../chat/types";
import { CoopPanelHeader } from "./CoopPanelHeader";
import {
  CREATE_PR_MODAL_CLASSES,
  CREATE_PR_NOT_YET_LABEL,
  CREATE_PULL_REQUEST_BUTTON_LABEL,
  type CreatePullRequestDraft,
  type CreatePullRequestFile,
  evaluateCreatePullRequest,
  isPullRequestWriteSupported
} from "../createPullRequestConfirm";

export type CreatePullRequestModalProps = {
  open: boolean;
  provider?: CodeHostProviderPreference;
  branch: string;
  title: string;
  files: CreatePullRequestFile[];
  submitting?: boolean;
  error?: string;
  onClose: () => void;
  onConfirm: (draft: CreatePullRequestDraft) => void;
};

export function CreatePullRequestModal({
  open,
  provider,
  branch: initialBranch,
  title: initialTitle,
  files,
  submitting = false,
  error,
  onClose,
  onConfirm
}: CreatePullRequestModalProps): React.ReactElement | null {
  const [branch, setBranch] = useState(initialBranch);
  const [title, setTitle] = useState(initialTitle);

  useEffect(() => {
    if (!open) {
      return;
    }
    setBranch(initialBranch);
    setTitle(initialTitle);
  }, [open, initialBranch, initialTitle]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  const supported = isPullRequestWriteSupported(provider);
  const draft: CreatePullRequestDraft = { provider, branch, title, files };
  const canConfirm = evaluateCreatePullRequest(draft, "confirm").action === "create" && !submitting;

  const handleConfirm = () => {
    const result = evaluateCreatePullRequest(draft, "confirm");
    if (result.action !== "create") {
      return;
    }
    onConfirm(result.payload);
  };

  return (
    <div
      className={CREATE_PR_MODAL_CLASSES.backdrop}
      role="presentation"
      onClick={onClose}
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
          title="Create pull request"
          onClose={onClose}
          closeAriaLabel="Cancel"
        />
        <div className="coop-prompt-modal-body">
          {!supported ? (
            <p className="coop-prompt-modal-note" role="status">
              {CREATE_PR_NOT_YET_LABEL}: creating pull requests from Coop is not yet available for{" "}
              {provider === "bitbucket" ? "Bitbucket" : "GitLab"}.
            </p>
          ) : (
            <>
              <p className="coop-prompt-modal-muted mb-2">
                Confirm the branch and title. Cancel, Escape, or the backdrop creates nothing on the host.
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
          {error ? (
            <p className="coop-prompt-modal-note" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <footer className="coop-prompt-modal-footer coop-prompt-modal-inset coop-prompt-modal-inset--bottom">
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
        </footer>
      </div>
    </div>
  );
}
