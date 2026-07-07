"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { completeOnboarding, fetchUsers } from "@/lib/coopApi";
import { displayOrgName, getStoredMe } from "@/lib/auth";
import { SCOPABLE_PROVIDERS, type IntegrationStatus } from "@/lib/integrations";
import { useIntegrations } from "@/hooks/useIntegrations";
import { IntegrationsStep } from "./IntegrationsStep";
import { OnboardingScopeStep } from "./OnboardingScopeStep";
import { OnboardingVerifyStep } from "./OnboardingVerifyStep";
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
    label: "Invite",
    include: (plan) => planCapabilities(plan).showOnboardingTeamStep
  },
  {
    id: "verify",
    label: "Verify",
    include: (plan) => planCapabilities(plan).showOnboardingVerifyStep
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
  return collab.some((provider) => integrations.find((i) => i.provider === provider)?.installed);
}

function scopableScopeGateBlocked(integrations: IntegrationStatus[], orgPlan: string): boolean {
  if (orgPlan !== "pro" && orgPlan !== "enterprise") {
    return false;
  }
  return SCOPABLE_PROVIDERS.some((provider) => {
    const status = integrations.find((i) => i.provider === provider);
    return status?.installed && !status.needsReconnect && status.scopeStatus === "required";
  });
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
  const [verifyCanComplete, setVerifyCanComplete] = useState(false);

  const githubConnected = integrations.find((i) => i.provider === "github")?.installed;
  const gitlabConnected = integrations.find((i) => i.provider === "gitlab")?.installed;
  const bitbucketConnected = integrations.find((i) => i.provider === "bitbucket")?.installed;
  const anyCodeHostConnected = githubConnected || gitlabConnected || bitbucketConnected;
  const scopableScopeGate = scopableScopeGateBlocked(integrations, orgPlan);
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
          <div className="flex items-baseline justify-between gap-4">
            <div>
              <p className="admin-section-label">Organization setup</p>
              <h2 id="onboarding-title" className="mt-1 text-lg font-semibold text-white">
                {orgName}
              </h2>
            </div>
            <p className="font-mono text-xs text-coop-muted">
              Step {Math.min(step + 1, steps.length)} of {steps.length}
            </p>
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
                    : "Connect your organization's tools once. Every developer inherits access automatically — they install the VS Code extension and sign in; they never register OAuth apps or paste integration tokens."}
                </p>
              </div>
              <ul className="space-y-2 text-sm text-coop-muted">
                {isFreePlan ? (
                  <>
                    <li>1. Connect a code host (GitHub, GitLab, or Bitbucket)</li>
                    <li>2. Deep-Index up to 3 repos for your org</li>
                    <li>3. Install the VS Code extension and sign in</li>
                  </>
                ) : (
                  <>
                    <li>1. Connect code hosts and collaboration tools</li>
                    <li>2. Choose repositories to Deep-Index (Indexing → Configure GitHub)</li>
                    <li>3. Configure collaboration access scope for connected tools</li>
                    <li>4. Invite your team and verify connections</li>
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
                    ? "Connect GitHub, GitLab, or Bitbucket — then use Indexing → Configure to choose up to 3 repos to Deep-Index. Collaboration tools are optional."
                    : "Install the Coop GitHub App on your organization (or authorize via OAuth if App is unavailable). Return here and refresh each row after approving access."}
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
                compact
                showFullPageLink={false}
              />
            </div>
          )}

          {currentStepId === "scope" && (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold text-white">Manage access</h3>
                <p className="mt-2 text-sm text-coop-muted">
                  Configure what Coop can search in each connected tool — not your entire workspace.
                </p>
              </div>
              <OnboardingScopeStep
                integrations={integrations}
                onRefresh={(provider) => void load({ provider })}
              />
            </div>
          )}

          {currentStepId === "team" && (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold text-white">Invite your team</h3>
                <p className="mt-2 text-sm text-coop-muted">
                  Invite teammates — they receive an email with install instructions.
                  {memberCount !== null
                    ? ` ${memberCount} member${memberCount === 1 ? "" : "s"} in your org.`
                    : ""}{" "}
                  Under{" "}
                  <Link href="/settings" className="admin-link">
                    Settings → Repository access
                  </Link>
                  , choose whether everyone sees all Deep-Indexed repos or only repos you assign per person.
                </p>
              </div>
            </div>
          )}

          {currentStepId === "verify" && (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold text-white">Verify connections</h3>
                <p className="mt-2 text-sm text-coop-muted">
                  Confirm connected tools respond before you finish setup.
                </p>
              </div>
              <OnboardingVerifyStep onGatesChange={setVerifyCanComplete} />
            </div>
          )}

          {currentStepId === "indexing" && (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold text-white">Choose repos to Deep-Index</h3>
                <p className="mt-2 text-sm leading-relaxed text-coop-muted">
                  Open{" "}
                  <Link href="/indexing" className="admin-link">
                    Indexing
                  </Link>{" "}
                  and click <span className="text-white">Configure GitHub</span> (or GitLab / Bitbucket) to
                  browse your repositories and select which ones to Deep-Index. Until you choose repos, the
                  Indexing page stays empty.
                  {isFreePlan ? (
                    <>
                      {" "}
                      Free plan allows up to 3 Deep-Indexed repos org-wide.
                    </>
                  ) : null}
                </p>
              </div>
              {!anyCodeHostConnected ? (
                <p className="text-sm text-amber-300">
                  Connect a code host on the previous step first, or skip and finish setup later.
                </p>
              ) : null}
            </div>
          )}

          {currentStepId === "extension" && (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold text-white">Install the extension</h3>
                <p className="mt-2 text-sm leading-relaxed text-coop-muted">
                  Install the Coop AI VS Code extension from the marketplace, then sign in with the same email and
                  password (or Google) you use here. No API key paste required for day-to-day coding.
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
                      Install the Coop AI VS Code extension and sign in with your Coop account. Open any local folder
                      to chat immediately — connect a code host to Deep-Index up to 3 repos.
                    </>
                  ) : (
                    <>
                      Developers install the Coop AI VS Code extension and sign in with their Coop account or SSO.
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
              ) : null}
              {currentStepId === "scope" ? (
                <>
                  {scopableScopeGate ? (
                    <p className="w-full text-xs text-amber-300 sm:order-first sm:w-auto">
                      Set access scope to Active for each connected tool before continuing.
                    </p>
                  ) : null}
                  <button type="button" className="admin-btn-secondary" onClick={() => goToStep(step + 1)}>
                    Skip
                  </button>
                  <button
                    type="button"
                    className="admin-btn-primary"
                    onClick={() => goToStep(step + 1)}
                    disabled={scopableScopeGate}
                  >
                    Continue
                  </button>
                </>
              ) : null}
              {currentStepId === "team" ? (
                <>
                  <button type="button" className="admin-btn-secondary" onClick={() => goToStep(step + 1)}>
                    Skip
                  </button>
                  <Link href="/users" className="admin-btn-primary">
                    Invite users
                  </Link>
                </>
              ) : null}
              {currentStepId === "verify" ? (
                <button
                  type="button"
                  className="admin-btn-primary"
                  onClick={() => goToStep(step + 1)}
                  disabled={!verifyCanComplete}
                >
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
