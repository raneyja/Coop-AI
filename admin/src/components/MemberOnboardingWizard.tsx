"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { completeMemberOnboarding, fetchMeWorkspaceRepos, type WorkspaceRepo } from "@/lib/coopApi";
import { displayOrgName, getStoredMe } from "@/lib/auth";
import { displayName } from "@/lib/timezones";
import { useIntegrations } from "@/hooks/useIntegrations";
import { IntegrationsStep } from "./IntegrationsStep";

const EXTENSION_URL = "https://marketplace.visualstudio.com/search?term=coop%20ai&target=VSCode";

const STEPS = [
  { id: "welcome", label: "Welcome" },
  { id: "repos", label: "Repositories" },
  { id: "tools", label: "Tools" },
  { id: "extension", label: "Extension" },
  { id: "done", label: "Done" }
] as const;

type MemberOnboardingWizardProps = {
  step: number;
  onStepChange: (step: number) => void;
  onComplete: () => void;
  onDismiss: () => void;
};

function repoLabel(repo: WorkspaceRepo): string {
  return `${repo.owner}/${repo.name}`;
}

export function MemberOnboardingWizard({
  step,
  onStepChange,
  onComplete,
  onDismiss
}: MemberOnboardingWizardProps) {
  const me = getStoredMe();
  const orgName = displayOrgName(me);
  const greeting = displayName(me?.firstName, me?.lastName, me?.email);

  const {
    integrations,
    orgPlan,
    initialLoading,
    refreshingProvider,
    refreshSuccessProvider,
    error,
    load
  } = useIntegrations();

  const currentStep = STEPS[step] ?? STEPS[0];
  const [mounted, setMounted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [repos, setRepos] = useState<WorkspaceRepo[]>([]);
  const [reposLoading, setReposLoading] = useState(true);
  const [adminControlled, setAdminControlled] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    async function loadRepos() {
      setReposLoading(true);
      const result = await fetchMeWorkspaceRepos();
      setReposLoading(false);
      if (result.ok && result.data) {
        setRepos(result.data.repos ?? []);
        setAdminControlled(Boolean(result.data.adminControlled));
      }
    }
    void loadRepos();
  }, []);

  async function finish() {
    setSaving(true);
    await completeMemberOnboarding();
    setSaving(false);
    onComplete();
  }

  if (!mounted) {
    return null;
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="member-onboarding-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-coop-dark/75 backdrop-blur-[6px]"
        aria-label="Close setup"
        onClick={onDismiss}
      />

      <div
        className="relative z-10 flex max-h-[min(720px,90vh)] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-coop-border bg-coop-surface shadow-2xl shadow-black/40"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="shrink-0 border-b border-coop-border/80 px-5 py-4 sm:px-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="admin-section-label">Member setup</p>
              <h2 id="member-onboarding-title" className="mt-1 text-lg font-semibold text-white">
                {orgName}
              </h2>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <p className="font-mono text-xs text-coop-muted">
                Step {Math.min(step + 1, STEPS.length)} of {STEPS.length}
              </p>
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-md text-coop-muted transition hover:bg-white/10 hover:text-white"
                onClick={onDismiss}
                aria-label="Close setup"
              >
                <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden>
                  <path
                    d="M4 4L12 12M12 4L4 12"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto px-5 py-6 sm:px-6">
          {currentStep.id === "welcome" && (
            <div className="space-y-5">
              <div>
                <h3 className="text-lg font-semibold text-white">Welcome, {greeting}</h3>
                <p className="mt-2 text-sm leading-relaxed text-coop-muted">
                  You&apos;ve joined <strong className="text-white">{orgName}</strong>. Review your repos,
                  org tools, and install the extension.
                </p>
              </div>
              <ol className="space-y-2 text-sm text-coop-muted">
                <li>1. Review repositories assigned to you</li>
                <li>2. See which org tools are connected</li>
                <li>3. Install the CoopAI extension and sign in</li>
              </ol>
            </div>
          )}

          {currentStep.id === "repos" && (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold text-white">Your repositories</h3>
                <p className="mt-2 text-sm text-coop-muted">
                  {adminControlled
                    ? "Assigned by your admin — contact them to request more access."
                    : "Repositories available in your workspace."}
                </p>
              </div>
              <div className="admin-card--table">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Repository</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reposLoading ? (
                      <tr>
                        <td colSpan={2} className="py-6 text-center text-coop-muted">
                          Loading…
                        </td>
                      </tr>
                    ) : repos.length === 0 ? (
                      <tr>
                        <td colSpan={2} className="py-6 text-center text-coop-muted">
                          No repositories assigned yet. Ask your admin to grant access.
                        </td>
                      </tr>
                    ) : (
                      repos.map((repo) => (
                        <tr key={repo.repoId}>
                          <td className="font-mono text-sm">{repoLabel(repo)}</td>
                          <td className="text-sm capitalize text-coop-muted">{repo.indexStatus ?? "—"}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {currentStep.id === "tools" && (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold text-white">Organization tools</h3>
                <p className="mt-2 text-sm text-coop-muted">
                  Your admin connected these — active tools appear in the VS Code extension automatically.
                </p>
              </div>
              <IntegrationsStep
                integrations={integrations}
                orgPlan={orgPlan}
                initialLoading={initialLoading}
                refreshingProvider={refreshingProvider}
                refreshSuccessProvider={refreshSuccessProvider}
                error={error}
                onRefresh={(provider) => void load({ provider })}
                onSilentRefresh={(provider) => void load({ provider, silent: true })}
                compact
                showFullPageLink={false}
                hideIntro
                readOnly
              />
            </div>
          )}

          {currentStep.id === "extension" && (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold text-white">Install the extension</h3>
                <p className="mt-2 text-sm leading-relaxed text-coop-muted">
                  Install the CoopAI VS Code extension from marketplace.
                </p>
              </div>
              <a
                href={EXTENSION_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="admin-btn-secondary inline-block"
              >
                Open VS Code Marketplace
              </a>
            </div>
          )}

          {currentStep.id === "done" && (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold text-white">You&apos;re ready</h3>
                <p className="mt-2 text-sm leading-relaxed text-coop-muted">
                  Install the CoopAI extension and sign in — your repos and org tools are ready.
                </p>
              </div>
              <Link href="/feed" className="admin-link text-sm">
                Open Chat Feed →
              </Link>
            </div>
          )}
        </main>

        <footer className="shrink-0 border-t border-coop-border/80 bg-coop-dark/40 px-5 py-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              {step > 0 ? (
                <button type="button" className="admin-btn-secondary" onClick={() => onStepChange(step - 1)}>
                  Back
                </button>
              ) : (
                <span />
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {currentStep.id === "welcome" ? (
                <button type="button" className="admin-btn-primary" onClick={() => onStepChange(1)}>
                  Get started
                </button>
              ) : null}
              {currentStep.id === "repos" || currentStep.id === "tools" || currentStep.id === "extension" ? (
                <button type="button" className="admin-btn-primary" onClick={() => onStepChange(step + 1)}>
                  Continue
                </button>
              ) : null}
              {currentStep.id === "done" ? (
                <button
                  type="button"
                  className="admin-btn-primary"
                  onClick={() => void finish()}
                  disabled={saving}
                >
                  {saving ? "Saving…" : "Go to dashboard"}
                </button>
              ) : null}
            </div>
          </div>
        </footer>
      </div>
    </div>,
    document.body
  );
}
