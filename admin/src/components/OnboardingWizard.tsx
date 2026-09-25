"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { completeOnboarding, fetchOrg, fetchOrgRepos, fetchUsers } from "@/lib/coopApi";
import { displayOrgName, getStoredMe } from "@/lib/auth";
import { integrationIsConnected, type IntegrationStatus } from "@/lib/integrations";
import { useIntegrations } from "@/hooks/useIntegrations";
import { isFullyUsable } from "@/lib/indexingProgress";
import { IntegrationsStep } from "./IntegrationsStep";
import { OnboardingPeopleStep } from "./OnboardingPeopleStep";
import { OnboardingScopeStep } from "./OnboardingScopeStep";
import { onboardingStepsForPlan, type OnboardingStepId } from "@/lib/onboardingSteps";
import { SetupStepper } from "./SetupStepper";

type OnboardingWizardProps = {
  step: number;
  onStepChange: (step: number) => void;
  onComplete: () => void;
  onDismiss: () => void;
};

const EXTENSION_URL = "https://marketplace.visualstudio.com/search?term=coopai&target=VSCode";

function stepDetail(id: OnboardingStepId, isFreePlan: boolean): string {
  switch (id) {
    case "tools":
      return isFreePlan
        ? "Connect GitHub, GitLab, or Bitbucket."
        : "Connect a code host. Collaboration tools are optional.";
    case "indexing":
      return isFreePlan
        ? "Deep-Index up to 3 repos. Usable repos are available to everyone on this account."
        : "Deep-Index the repos this account should use. Usable repos are available to everyone.";
    case "scope":
      return "Choose what Coop can search in connected collaboration tools.";
    case "team":
      return "Invite teammates. They can open Usable repos as soon as they sign in.";
    case "extension":
      return "Install the VS Code extension and sign in with this account.";
    default:
      return "";
  }
}

function collaborationConnected(integrations: IntegrationStatus[]): boolean {
  const collab = ["slack", "atlassian", "notion", "google-docs"] as const;
  return collab.some((provider) =>
    integrationIsConnected(integrations.find((entry) => entry.provider === provider))
  );
}

export function OnboardingWizard({
  step,
  onStepChange,
  onComplete,
  onDismiss
}: OnboardingWizardProps) {
  const me = getStoredMe();
  const orgName = displayOrgName(me);

  const {
    integrations,
    orgPlan,
    initialLoading,
    refreshingProvider,
    refreshSuccessProvider,
    error,
    load
  } = useIntegrations();

  const isFreePlan = orgPlan === "free";
  const steps = onboardingStepsForPlan(orgPlan);
  const currentStep = steps[step] ?? steps[0];
  const currentStepId = currentStep.id;
  const [mounted, setMounted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [memberCount, setMemberCount] = useState<number | null>(null);
  const [hasUsableRepo, setHasUsableRepo] = useState(false);
  const [usableRepoCount, setUsableRepoCount] = useState(0);
  const [repoAccessMode, setRepoAccessMode] = useState<"all_indexed" | "per_user">("all_indexed");

  const githubConnected = integrationIsConnected(
    integrations.find((entry) => entry.provider === "github")
  );
  const gitlabConnected = integrationIsConnected(
    integrations.find((entry) => entry.provider === "gitlab")
  );
  const bitbucketConnected = integrationIsConnected(
    integrations.find((entry) => entry.provider === "bitbucket")
  );
  const anyCodeHostConnected = githubConnected || gitlabConnected || bitbucketConnected;
  const wideStep = currentStepId === "tools";

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (step >= steps.length) {
      onStepChange(steps.length - 1);
    }
  }, [step, steps, onStepChange]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    if (currentStepId !== "indexing" && currentStepId !== "done" && currentStepId !== "team") {
      return;
    }
    let cancelled = false;
    void (async () => {
      const [reposResult, orgResult] = await Promise.all([fetchOrgRepos(), fetchOrg()]);
      if (cancelled) {
        return;
      }
      if (reposResult.ok && reposResult.data?.repos) {
        const usable = reposResult.data.repos.filter(isFullyUsable);
        setUsableRepoCount(usable.length);
        setHasUsableRepo(usable.length > 0);
      }
      if (orgResult.ok && orgResult.data?.repoAccessMode) {
        setRepoAccessMode(orgResult.data.repoAccessMode);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentStepId]);

  async function loadMembers() {
    const result = await fetchUsers();
    if (result.ok && result.data?.users) {
      setMemberCount(result.data.users.length);
    }
  }

  function goToStep(next: number) {
    const clamped = Math.max(0, Math.min(next, steps.length - 1));
    const nextStepId = steps[clamped]?.id;
    if (nextStepId === "team" && memberCount === null) {
      void loadMembers();
    }
    onStepChange(clamped);
  }

  function advanceFromConnect() {
    goToStep(step + 1);
  }

  async function finish() {
    setSaving(true);
    await completeOnboarding();
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
      aria-labelledby="onboarding-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-coop-dark/75 backdrop-blur-[6px]"
        aria-label="Close setup"
        onClick={onDismiss}
      />

      <div
        className={`relative z-10 flex max-h-[min(720px,90vh)] w-full flex-col overflow-hidden rounded-xl border border-coop-border bg-coop-surface shadow-2xl shadow-black/50 ${
          wideStep ? "max-w-3xl" : "max-w-2xl"
        }`}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="shrink-0 border-b border-coop-border/80 px-5 py-4 sm:px-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="admin-section-label">Organization setup</p>
              <h2 id="onboarding-title" className="mt-1 text-lg font-semibold text-white">
                {orgName}
              </h2>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <p className="text-xs tabular-nums tracking-wide text-coop-muted">
                Step {Math.min(step + 1, steps.length)} of {steps.length}
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
          <SetupStepper steps={steps} step={step} />
        </header>

        <main className="flex-1 overflow-y-auto px-5 py-6 sm:px-6">
          {currentStepId === "welcome" && (
            <div className="space-y-5">
              <div>
                <h3 className="text-lg font-semibold tracking-tight text-white">Welcome to Coop</h3>
                <p className="mt-2 text-sm leading-relaxed text-coop-muted">
                  {isFreePlan
                    ? "Connect a code host, Deep-Index the repos you want, then keep working in the VS Code extension."
                    : "Connect your tools and Deep-Index the repos this account should use. Teammates get those repos automatically."}
                </p>
              </div>
              <ol className="space-y-3">
                {steps
                  .filter((entry) => entry.id !== "welcome" && entry.id !== "done")
                  .map((entry, index) => (
                    <li key={entry.id} className="flex gap-3">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-coop-border/80 text-[11px] font-medium text-coop-muted">
                        {index + 1}
                      </span>
                      <div className="min-w-0 pt-0.5">
                        <p className="text-sm font-medium text-white">{entry.label}</p>
                        <p className="mt-0.5 text-sm leading-relaxed text-coop-muted">
                          {stepDetail(entry.id, isFreePlan)}
                        </p>
                      </div>
                    </li>
                  ))}
              </ol>
            </div>
          )}

          {currentStepId === "tools" && (
            <div className="space-y-5">
              <div>
                <h3 className="text-lg font-semibold tracking-tight text-white">Connect tools</h3>
                <p className="mt-2 text-sm leading-relaxed text-coop-muted">
                  {isFreePlan
                    ? "Connect at least one code host. Additional hosts are optional."
                    : "Connect at least one code host. Collaboration tools are optional."}
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
              />
            </div>
          )}

          {currentStepId === "scope" && (
            <div className="space-y-5">
              <div>
                <h3 className="text-lg font-semibold tracking-tight text-white">Set search scope</h3>
                <p className="mt-2 text-sm leading-relaxed text-coop-muted">
                  Choose what Coop can search in each connected collaboration tool. You can change this
                  later.
                </p>
              </div>
              <OnboardingScopeStep
                integrations={integrations}
                onRefresh={(provider) => void load({ provider })}
              />
            </div>
          )}

          {currentStepId === "team" && <OnboardingPeopleStep memberCount={memberCount} />}

          {currentStepId === "indexing" && (
            <div className="space-y-5">
              <div>
                <h3 className="text-lg font-semibold tracking-tight text-white">
                  Choose repos to Deep-Index
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-coop-muted">
                  Open{" "}
                  <Link href="/indexing" className="admin-link">
                    Indexing
                  </Link>{" "}
                  and select the repositories this account should use. A repo is ready when its status
                  is <span className="text-white">Usable</span>. Everyone on this account can open
                  Usable repos in the extension.
                </p>
              </div>
              <div className="flex items-start gap-3 rounded-md border border-coop-border/70 bg-coop-dark/50 px-4 py-3.5">
                <span
                  className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${
                    hasUsableRepo ? "bg-coop-index" : "bg-coop-muted/40"
                  }`}
                  aria-hidden
                />
                <div>
                  <p className="text-sm font-medium text-white">
                    {hasUsableRepo
                      ? `${usableRepoCount} ${usableRepoCount === 1 ? "repo" : "repos"} ready`
                      : "No repos ready yet"}
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-coop-muted">
                    {hasUsableRepo
                      ? "Available to everyone on this account."
                      : "Index at least one repo and wait until the status is Usable, not only Indexed."}
                  </p>
                </div>
              </div>
              {isFreePlan ? (
                <p className="text-xs leading-relaxed text-coop-muted">
                  Free includes up to 3 repos.{" "}
                  <Link href="/billing" className="admin-link">
                    Upgrade to Pro
                  </Link>{" "}
                  for unlimited indexing.
                </p>
              ) : null}
            </div>
          )}

          {currentStepId === "extension" && (
            <div className="space-y-5">
              <div>
                <h3 className="text-lg font-semibold tracking-tight text-white">Install the extension</h3>
                <p className="mt-2 text-sm leading-relaxed text-coop-muted">
                  Install Coop from the Visual Studio Marketplace, then sign in with this account.
                  Usable repos and connected tools show up automatically.
                </p>
              </div>
              <a
                href={EXTENSION_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="admin-btn-secondary inline-flex"
              >
                Open VS Code Marketplace
              </a>
            </div>
          )}

          {currentStepId === "done" && (
            <div className="space-y-5">
              <div>
                <h3 className="text-lg font-semibold tracking-tight text-white">You&apos;re ready</h3>
                <p className="mt-2 text-sm leading-relaxed text-coop-muted">
                  {isFreePlan
                    ? "Install the extension and sign in. Usable repos on this account are already available."
                    : repoAccessMode === "per_user"
                      ? "Teammates install the extension and sign in. Org tools connect automatically. Repos appear after you assign them on Users."
                      : "Teammates install the extension and sign in. Org tools and Usable repos are already available to them."}
                </p>
              </div>
            </div>
          )}
        </main>

        <footer className="shrink-0 border-t border-coop-border/80 bg-coop-dark/40 px-5 py-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              {step > 0 ? (
                <button type="button" className="admin-btn-secondary" onClick={() => goToStep(step - 1)}>
                  Back
                </button>
              ) : (
                <span />
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {currentStepId === "welcome" ? (
                <button type="button" className="admin-btn-primary" onClick={() => goToStep(1)}>
                  Get started
                </button>
              ) : null}
              {currentStepId === "tools" ? (
                <button type="button" className="admin-btn-primary" onClick={advanceFromConnect}>
                  {anyCodeHostConnected || collaborationConnected(integrations) ? "Continue" : "Skip for now"}
                </button>
              ) : null}
              {currentStepId === "indexing" ? (
                hasUsableRepo ? (
                  <>
                    <Link href="/indexing" className="admin-btn-secondary">
                      Open Indexing
                    </Link>
                    <button
                      type="button"
                      className="admin-btn-primary"
                      onClick={() => goToStep(step + 1)}
                    >
                      Next
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="admin-btn-secondary"
                      onClick={() => goToStep(step + 1)}
                    >
                      {anyCodeHostConnected ? "Skip for now" : "Continue"}
                    </button>
                    <Link href="/indexing" className="admin-btn-primary">
                      Open Indexing
                    </Link>
                  </>
                )
              ) : null}
              {currentStepId === "scope" ? (
                <button type="button" className="admin-btn-primary" onClick={() => goToStep(step + 1)}>
                  Continue
                </button>
              ) : null}
              {currentStepId === "team" ? (
                <button type="button" className="admin-btn-primary" onClick={() => goToStep(step + 1)}>
                  Continue
                </button>
              ) : null}
              {currentStepId === "extension" ? (
                <button type="button" className="admin-btn-primary" onClick={() => goToStep(step + 1)}>
                  Continue
                </button>
              ) : null}
              {currentStepId === "done" ? (
                <button
                  type="button"
                  className="admin-btn-primary"
                  onClick={() => void finish()}
                  disabled={saving}
                >
                  {saving ? "Saving…" : "Finish setup"}
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
