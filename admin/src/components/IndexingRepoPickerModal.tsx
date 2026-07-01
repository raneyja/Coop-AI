"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { OrgRepoRecord } from "@/lib/coopApi";
import { codeHostLabel } from "@/lib/coopApi";
import type { CodeHostProvider } from "@/lib/integrations";
import { parseCodeHostFromRepoId, shortRepoName } from "@/lib/indexingProgress";

type IndexingRepoPickerModalProps = {
  open: boolean;
  provider: CodeHostProvider;
  repos: OrgRepoRecord[];
  maxSelect: number;
  alreadyIndexed: number;
  onClose: () => void;
  onConfirm: (repoIds: string[]) => Promise<void>;
};

export function IndexingRepoPickerModal({
  open,
  provider,
  repos,
  maxSelect,
  alreadyIndexed,
  onClose,
  onConfirm
}: IndexingRepoPickerModalProps): React.ReactElement | null {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  const remainingSlots = Math.max(0, maxSelect - alreadyIndexed);
  const providerRepos = useMemo(
    () => repos.filter((repo) => parseCodeHostFromRepoId(repo.repoId) === provider),
    [provider, repos]
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) {
      setSelected(new Set());
      setError(null);
      return;
    }
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open || !mounted) {
    return null;
  }

  function toggleRepo(repoId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(repoId)) {
        next.delete(repoId);
        return next;
      }
      if (next.size >= remainingSlots) {
        return next;
      }
      next.add(repoId);
      return next;
    });
  }

  async function handleConfirm() {
    if (selected.size === 0) {
      setError(`Select at least one repo (up to ${remainingSlots}).`);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(Array.from(selected));
      setSelected(new Set());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start Deep-Index.");
    } finally {
      setSubmitting(false);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
      role="presentation"
      onClick={() => {
        if (!submitting) {
          onClose();
        }
      }}
    >
      <div
        className="relative flex max-h-[min(85vh,720px)] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-coop-border bg-coop-dark shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="indexing-picker-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="shrink-0 border-b border-coop-border/40 bg-coop-dark px-5 py-4">
          <h2 id="indexing-picker-title" className="text-lg font-semibold text-white">
            Choose repos to Deep-Index
          </h2>
          <p className="mt-1 text-sm text-coop-muted">
            {codeHostLabel(provider)} — {providerRepos.length} repos in catalog
            {remainingSlots > 0 ? ` · select up to ${remainingSlots} more` : ""}.
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-coop-dark px-5 py-4">
          {remainingSlots === 0 ? (
            <p className="mb-3 text-sm text-amber-200">
              You have reached the free plan limit. Turn off Deep-Index on a repo in the table below to
              free a slot, then select a replacement here.
            </p>
          ) : null}
          {providerRepos.length === 0 ? (
            <p className="text-sm text-coop-muted">No repositories discovered yet.</p>
          ) : (
            <ul className="space-y-2">
              {providerRepos.map((repo) => {
                const indexed = repo.lightningEnabled;
                const checked = selected.has(repo.repoId);
                const atCap = !indexed && !checked && selected.size >= remainingSlots;
                return (
                  <li key={repo.repoId}>
                    <label
                      className={`flex items-center gap-3 rounded-md border border-transparent px-3 py-2.5 ${
                        indexed || atCap
                          ? indexed
                            ? "opacity-80"
                            : "cursor-not-allowed opacity-50"
                          : "cursor-pointer hover:border-coop-border/40 hover:bg-white/[0.04]"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4 shrink-0 accent-coop-index"
                        checked={indexed || checked}
                        disabled={indexed || atCap || submitting || remainingSlots === 0}
                        onChange={() => toggleRepo(repo.repoId)}
                      />
                      <span className="font-mono text-sm text-white">{shortRepoName(repo.repoId)}</span>
                      {indexed ? (
                        <span className="ml-auto text-[11px] uppercase tracking-wide text-emerald-300/90">
                          Indexed
                        </span>
                      ) : null}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-coop-border/40 bg-coop-dark px-5 py-4">
          <p className="text-xs text-coop-muted">
            {selected.size} of {remainingSlots} selected
          </p>
          <div className="flex gap-2">
            <button type="button" className="admin-btn-secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button
              type="button"
              className="admin-btn-primary"
              onClick={() => void handleConfirm()}
              disabled={submitting || selected.size === 0 || remainingSlots === 0}
            >
              {submitting ? "Starting…" : "Deep-Index selected"}
            </button>
          </div>
        </div>

        {error ? <p className="shrink-0 px-5 pb-4 text-xs text-red-400">{error}</p> : null}
      </div>
    </div>,
    document.body
  );
}
