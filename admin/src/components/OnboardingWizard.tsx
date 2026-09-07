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
import { planCapabilities } from "@/lib/planCapabilities";

type OnboardingWizardProps = {
  step: number;
  onStepChange: (step: number) => void;
  onComplete: () => void;
  onDismiss: () => void;
};

type StepDef = {
  id: string;
  label: string;
  include: (plan: string) => boolean;
};

const ONBOARDING_STEP_DEFS: StepDef[] = [
  { id: "welcome", label: "Welcome", include: () => true },
  { id: "tools", label: "Connect", include: () => true },
  {
    id: "indexing",
    label: "Index repos",
    include: (plan) => planCapabilities(plan).showOnboardingIndexingStep
  },
  {
    id: "scope",
    label: "Access",
    include: (plan) => planCapabilities(plan).showScopeStep
  },
  {
    id: "team",
    label: "People",
    include: (plan) => planCapabilities(plan).showOnboardingTeamStep
  },
  {
    id: "extension",
    label: "Extension",
    include: (plan) => planCapabilities(plan).showOnboardingExtensionStep
  },
  { id: "done", label: "Done", include: () => true }
];

function stepsForPlan(plan: string) {
  return ONBOARDING_STEP_DEFS.filter((entry) => entry.include(plan));
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
  const steps = stepsForPlan(orgPlan);
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
        className={`relative z-10 flex max-h-[min(720px,90vh)] w-full flex-col overflow-hidden rounded-lg border border-coop-border bg-coop-surface shadow-2xl shadow-black/40 ${
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
              <p className="font-mono text-xs text-coop-muted">
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
          <nav className="mt-4 flex gap-1" aria-label="Setup progress">
            {steps.map((entry, index) => {
              const active = index === step;
              const complete = index < step;
              return (
                <div key={entry.id} className="flex min-w-0 flex-1 items-center gap-2">
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
                      active
                        ? "bg-coop-index text-coop-dark"
                        : complete
                          ? "bg-white/15 text-white"
                          : "bg-white/5 text-coop-muted"
                    }`}
                  >
                    {complete ? "✓" : index + 1}
                  </span>
                  <span
                    className={`hidden truncate text-xs sm:inline ${active ? "text-white" : "text-coop-muted"}`}
                  >
                    {entry.label}
                  </span>
                  {index < steps.length - 1 ? (
                    <span className="mx-1 hidden h-px flex-1 bg-coop-border/60 sm:block" aria-hidden />
                  ) : null}
                </div>
              );
            })}
          </nav>
        </header>

        <main className="flex-1 overflow-y-auto px-5 py-6 sm:px-6">
          {currentStepId === "welcome" && (
            <div className="space-y-5">
              <div>
                <h3 className="text-lg font-semibold text-white">Welcome to CoopAI</h3>
                <p className="mt-2 text-sm leading-relaxed text-coop-muted">
                  {isFreePlan
                    ? "Connect your personal developer tools once, then keep coding in the Coop VS Code extension with your own API key."
                    : "Connect your tools once. You have admin access. Invite teammates later if you add seats."}
                </p>
              </div>
              <ul className="space-y-2 text-sm text-coop-muted">
                {isFreePlan ? (
                  <>
                    <li>1. Connect at least one code host (GitHub, GitLab, or Bitbucket)</li>
                    <li>2. Deep-Index up to 3 of your repos</li>
                    <li>3. Install the VS Code extension and sign in</li>
                  </>
                ) : (
                  <>
                    <li>1. Connect at least one code host (collaboration tools optional)</li>
                    <li>2. Choose repos to Deep-Index</li>
                    <li>3. Set collaboration access scope</li>
                    <li>4. Choose who can open repos. Invite others later if you add seats.</li>
                  </>
                )}
              </ul>
            </div>
          )}

          {currentStepId === "tools" && (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold text-white">Connect tools</h3>
                <p className="mt-2 text-sm text-coop-muted">
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
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold text-white">Manage access</h3>
                <p className="mt-2 text-sm text-coop-muted">
                  Set what Coop can search in each connected tool.
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
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold text-white">Choose repos to Deep-Index</h3>
                <p className="mt-2 text-sm leading-relaxed text-coop-muted">
                  {isFreePlan ? (
                    <>
                      Open{" "}
                      <Link href="/indexing" className="admin-link">
                        Indexing
                      </Link>{" "}
                      and configure a code host to choose repos to Deep-Index. Wait until at least one
                      repo shows <span className="text-white">Usable</span> (browse verified). Free plan
                      allows up to 3 repos. Upgrade to{" "}
                      <Link href="/billing" className="admin-link">
                        Pro
                      </Link>{" "}
                      for unlimited indexing.
                    </>
                  ) : (
                    <>
                      Open{" "}
                      <Link href="/indexing" className="admin-link">
                        Indexing
                      </Link>{" "}
                      and configure GitHub, GitLab, or Bitbucket to choose repos to Deep-Index.{" "}
                      <span className="text-white">Usable</span> means the repo is ready to open — next
                      you&apos;ll choose who gets access.
                    </>
                  )}
                </p>
                <ul className="mt-3 space-y-1.5 text-sm text-coop-muted">
                  <li>
                    {hasUsableRepo ? "☑" : "☐"} Deep-Index at least one repo
                    {hasUsableRepo ? ` (${usableRepoCount} Usable)` : ""}
                  </li>
                  <li>
                    {hasUsableRepo ? "☑" : "☐"} Wait for status{" "}
                    <span className="text-white">Usable</span> (not only Indexed)
                  </li>
                  <li>☐ Then continue to People &amp; access</li>
                </ul>
              </div>
            </div>
          )}

          {currentStepId === "extension" && (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold text-white">Install the extension</h3>
                <p className="mt-2 text-sm leading-relaxed text-coop-muted">
                  Install the CoopAI VS Code extension from marketplace.
                </p>
              </div>
              <a
                href="https://marketplace.visualstudio.com/search?term=coop%20ai&target=VSCode"
                target="_blank"
                rel="noopener noreferrer"
                className="admin-btn-secondary inline-block"
              >
                Open VS Code Marketplace
              </a>
            </div>
          )}

          {currentStepId === "done" && (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold text-white">You&apos;re ready</h3>
                <p className="mt-2 text-sm leading-relaxed text-coop-muted">
                  {isFreePlan ? (
                    <>
                      Install the CoopAI extension and begin connecting your tools.
                    </>
                  ) : repoAccessMode === "per_user" ? (
                    <>
                      Your team installs the CoopAI extension and signs in. Org tools connect
                      automatically — repos show up only after you assign them on Users.
                    </>
                  ) : (
                    <>
                      Your team installs the CoopAI extension and signs in — org tools and Usable repos
                      are ready automatically.
                    </>
                  )}
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
                      {anyCodeHostConnected ? "I'll Configure Later" : "Continue"}
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
