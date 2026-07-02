"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { OrgRepoRecord } from "@/lib/coopApi";
import { shortRepoName } from "@/lib/indexingProgress";

const INVITE_ROLES = ["member", "admin"] as const;
type InviteRole = (typeof INVITE_ROLES)[number];

type InviteUserModalProps = {
  open: boolean;
  perUserAccess: boolean;
  indexedRepos: OrgRepoRecord[];
  onClose: () => void;
  onInvite: (payload: { email: string; role: InviteRole; repoIds?: string[] }) => Promise<void>;
};

export function InviteUserModal({
  open,
  perUserAccess,
  indexedRepos,
  onClose,
  onInvite
}: InviteUserModalProps): React.ReactElement | null {
  const [mounted, setMounted] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InviteRole>("member");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filteredRepos = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return indexedRepos;
    }
    return indexedRepos.filter((repo) => shortRepoName(repo.repoId).toLowerCase().includes(needle));
  }, [indexedRepos, query]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) {
      setStep(1);
      setEmail("");
      setRole("member");
      setSelected(new Set());
      setQuery("");
      setError(null);
      setSubmitting(false);
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
      if (event.key === "Escape" && !submitting) {
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, submitting]);

  if (!open || !mounted) {
    return null;
  }

  function toggleRepo(repoId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(repoId)) {
        next.delete(repoId);
      } else {
        next.add(repoId);
      }
      return next;
    });
  }

  function handleContinue() {
    const trimmed = email.trim();
    if (!trimmed) {
      setError("Email address is required.");
      return;
    }
    if (!trimmed.includes("@")) {
      setError("Enter a valid email address.");
      return;
    }
    setError(null);
    if (perUserAccess) {
      setStep(2);
      return;
    }
    void handleSend(trimmed);
  }

  async function handleSend(emailOverride?: string) {
    const trimmed = (emailOverride ?? email).trim();
    if (!trimmed) {
      setError("Email address is required.");
      return;
    }
    if (perUserAccess && selected.size === 0) {
      setError("Select at least one repository.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onInvite({
        email: trimmed,
        role,
        repoIds: perUserAccess ? Array.from(selected) : undefined
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invite failed.");
    } finally {
      setSubmitting(false);
    }
  }

  const stepLabel = perUserAccess ? `Step ${step} of 2` : null;

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
        className="relative flex max-h-[min(85vh,640px)] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-coop-border bg-coop-dark shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="invite-user-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="shrink-0 border-b border-coop-border/40 px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="invite-user-title" className="text-lg font-semibold text-white">
                Invite a new user
              </h2>
              <p className="mt-1 text-sm text-coop-muted">
                {step === 1
                  ? "They will receive an email with instructions to join your organization."
                  : "Choose which Deep-Indexed repositories this person can access."}
              </p>
            </div>
            {stepLabel ? <span className="shrink-0 text-xs text-coop-muted">{stepLabel}</span> : null}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {step === 1 ? (
            <div className="space-y-4">
              <div>
                <label htmlFor="invite-modal-email" className="admin-label">
                  Email address
                </label>
                <input
                  id="invite-modal-email"
                  type="email"
                  className="admin-input"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="colleague@company.com"
                  autoFocus
                  disabled={submitting}
                />
              </div>
              <div>
                <label htmlFor="invite-modal-role" className="admin-label">
                  Role
                </label>
                <select
                  id="invite-modal-role"
                  className="admin-input"
                  value={role}
                  onChange={(event) => setRole(event.target.value as InviteRole)}
                  disabled={submitting}
                >
                  {INVITE_ROLES.map((entry) => (
                    <option key={entry} value={entry}>
                      {entry === "admin" ? "Admin" : "Member"}
                    </option>
                  ))}
                </select>
                <p className="mt-1.5 text-xs text-coop-muted">
                  Admins can manage integrations, indexing, and team access. Members use assigned repos in VS Code.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {indexedRepos.length > 6 ? (
                <input
                  type="search"
                  className="admin-input w-full"
                  placeholder="Search repositories…"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  disabled={submitting}
                />
              ) : null}
              {indexedRepos.length === 0 ? (
                <p className="text-sm text-coop-muted">
                  No Deep-Indexed repositories yet. Choose repos on the Indexing page first.
                </p>
              ) : filteredRepos.length === 0 ? (
                <p className="text-sm text-coop-muted">No repositories match your search.</p>
              ) : (
                <ul className="space-y-2">
                  {filteredRepos.map((repo) => (
                    <li key={repo.repoId}>
                      <label className="flex cursor-pointer items-center gap-3 rounded-md border border-transparent px-3 py-2.5 hover:border-coop-border/40 hover:bg-white/[0.04]">
                        <input
                          type="checkbox"
                          className="h-4 w-4 shrink-0 accent-coop-index"
                          checked={selected.has(repo.repoId)}
                          disabled={submitting}
                          onChange={() => toggleRepo(repo.repoId)}
                        />
                        <span className="font-mono text-sm text-white">{shortRepoName(repo.repoId)}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-coop-border/40 px-5 py-4">
          {step === 2 ? (
            <p className="text-xs text-coop-muted">
              {selected.size} repo{selected.size === 1 ? "" : "s"} selected
            </p>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            {step === 2 ? (
              <button
                type="button"
                className="admin-btn-secondary"
                onClick={() => {
                  setStep(1);
                  setError(null);
                }}
                disabled={submitting}
              >
                Back
              </button>
            ) : (
              <button type="button" className="admin-btn-secondary" onClick={onClose} disabled={submitting}>
                Cancel
              </button>
            )}
            {step === 1 ? (
              <button
                type="button"
                className="admin-btn-primary"
                onClick={() => void handleContinue()}
                disabled={submitting}
              >
                {perUserAccess ? "Continue" : submitting ? "Sending…" : "Send invite"}
              </button>
            ) : (
              <button
                type="button"
                className="admin-btn-primary"
                onClick={() => void handleSend()}
                disabled={submitting || indexedRepos.length === 0}
              >
                {submitting ? "Sending…" : "Send invite"}
              </button>
            )}
          </div>
        </div>

        {error ? <p className="shrink-0 px-5 pb-4 text-xs text-red-400">{error}</p> : null}
      </div>
    </div>,
    document.body
  );
}
