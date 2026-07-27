"use client";

import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import type { OrgRepoRecord } from "@/lib/coopApi";
import { shortRepoName } from "@/lib/indexingProgress";

type IndexingProgressHelpModalProps = {
  open: boolean;
  repo: OrgRepoRecord | null;
  onClose: () => void;
  onReindex?: (repoId: string) => void;
};

export function IndexingProgressHelpModal({
  open,
  repo,
  onClose,
  onReindex
}: IndexingProgressHelpModalProps): React.ReactElement | null {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    document.body.style.overflow = "hidden";
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open || !mounted || !repo) {
    return null;
  }

  const stage = repo.indexStage ?? "Indexing";
  const isEmbeddings = stage === "Embeddings" || (repo.indexProgress ?? 0) >= 65;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg rounded-lg border border-coop-border bg-coop-dark p-6 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="indexing-help-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="indexing-help-title" className="text-lg font-semibold text-white">
          What’s happening — {shortRepoName(repo.repoId)}
        </h2>
        <p className="mt-2 text-sm text-coop-muted">
          Current stage: <span className="text-white">{stage}</span>
        </p>
        {repo.indexStageDetail ? (
          <p className="mt-3 text-sm text-white/90">{repo.indexStageDetail}</p>
        ) : null}

        <div className="mt-4 space-y-3 text-sm text-coop-muted">
          {isEmbeddings ? (
            <>
              <p>
                Embeddings teach Coop to find similar code. On large repos this step often takes
                several minutes and the bar may barely move — that is normal.
              </p>
              <p>
                Wait if the stage still says Embeddings and the job is under ~10 minutes old.
                Click <span className="text-white">Reindex</span> only if it sits here with no
                change for much longer, or if status flips to failed.
              </p>
            </>
          ) : (
            <>
              <p>
                Deep-Index clones the repo, builds search maps, then checks that developers can
                browse files on the real default branch.
              </p>
              <p>If this stage stalls for more than a few minutes, try Reindex.</p>
            </>
          )}
        </div>

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button type="button" className="admin-btn-secondary" onClick={onClose}>
            Close
          </button>
          {onReindex ? (
            <button
              type="button"
              className="admin-btn-primary"
              onClick={() => {
                onReindex(repo.repoId);
                onClose();
              }}
            >
              Reindex
            </button>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  );
}
