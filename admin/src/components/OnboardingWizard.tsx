"use client";

import { useState } from "react";
import Link from "next/link";
import { completeOnboarding, fetchUsers } from "@/lib/coopApi";
import type { IntegrationStatus } from "@/lib/integrations";
import { useIntegrations } from "@/hooks/useIntegrations";
import { IntegrationsStep } from "./IntegrationsStep";
import { IntegrationScopePanel } from "./IntegrationScopePanel";
import { OnboardingVerifyStep } from "./OnboardingVerifyStep";

type OnboardingWizardProps = {
  onComplete: () => void;
};

const STEPS = ["Welcome", "Connect tools", "Manage access", "Invite team", "Verify", "Done"] as const;

function collaborationConnected(integrations: IntegrationStatus[]): boolean {
  const collab = ["slack", "atlassian", "notion", "google-docs"] as const;
  return collab.some((provider) => integrations.find((i) => i.provider === provider)?.installed);
}

function slackScopeBlocking(integrations: IntegrationStatus[], orgPlan: string): boolean {
  if (orgPlan !== "enterprise") {
    return false;
  }
  const slack = integrations.find((i) => i.provider === "slack");
  if (!slack?.installed || slack.needsReconnect) {
    return false;
  }
  return slack.scopeStatus === "required";
}

export function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const {
    integrations,
    orgPlan,
    initialLoading,
    refreshingProvider,
    refreshSuccessProvider,
    error,
    load
  } = useIntegrations();

  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [memberCount, setMemberCount] = useState<number | null>(null);
  const [verifyCanComplete, setVerifyCanComplete] = useState(false);

  const githubConnected = integrations.find((i) => i.provider === "github")?.installed;
  const enterprise = orgPlan === "enterprise";
  const slackConnected = integrations.find((i) => i.provider === "slack")?.installed;
  const slackScopeActive = integrations.find((i) => i.provider === "slack")?.scopeStatus === "active";
  const scopeStepApplies = enterprise && Boolean(slackConnected);
  const scopeBlocked = slackScopeBlocking(integrations, orgPlan);

  async function loadMembers() {
    const result = await fetchUsers();
    if (result.ok && result.data?.users) {
      setMemberCount(result.data.users.length);
    }
  }

  function goToStep(next: number) {
    if (next === 3 && memberCount === null) {
      void loadMembers();
    }
    setStep(next);
  }

  function advanceFromConnect() {
    if (scopeStepApplies) {
      goToStep(2);
      return;
    }
    goToStep(3);
  }

  function advanceFromScope() {
    goToStep(3);
  }

  async function finish() {
    setSaving(true);
    await completeOnboarding();
    setSaving(false);
    onComplete();
  }

  const finishDisabled = saving || (step === 4 && !verifyCanComplete);

  return (
    <div className="admin-panel-inset">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <div>
          <p className="admin-section-label">Setup</p>
          <h2 className="mt-1 text-base font-medium text-white">{STEPS[step]}</h2>
        </div>
        <p className="font-mono text-xs text-coop-muted">
          {step + 1} / {STEPS.length}
        </p>
      </div>

      {step === 0 && (
        <div className="space-y-4">
          <p className="text-sm text-coop-muted">
            Connect your tools once here — every developer in your org inherits access automatically.
          </p>
          <button type="button" className="admin-btn-primary" onClick={() => goToStep(1)}>
            Continue
          </button>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-4">
          <IntegrationsStep
            integrations={integrations}
            orgPlan={orgPlan}
            initialLoading={initialLoading}
            refreshingProvider={refreshingProvider}
            refreshSuccessProvider={refreshSuccessProvider}
            error={error}
            onRefresh={(provider) => void load({ provider })}
            compact
          />
          {scopeBlocked ? (
            <p className="text-xs text-amber-300">
              Slack is connected but channel scope is required — continue to Manage access.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="admin-btn-primary" onClick={advanceFromConnect}>
              {githubConnected || collaborationConnected(integrations) ? "Continue" : "Skip for now"}
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          {scopeStepApplies ? (
            <>
              <p className="text-sm text-coop-muted">
                Choose which Slack channels Coop can search — not your entire workspace.
              </p>
              {slackScopeActive ? (
                <p className="text-xs text-coop-index">Slack access is active.</p>
              ) : (
                <p className="text-xs text-amber-300">Scope required before Slack context is used in chat.</p>
              )}
            </>
          ) : (
            <p className="text-sm text-coop-muted">No Enterprise Slack scope needed for your plan.</p>
          )}
          <p className="text-xs text-coop-muted">
            Jira, Notion, and Google Docs scope controls are coming soon.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="admin-btn-primary"
              onClick={advanceFromScope}
              disabled={scopeBlocked}
            >
              Continue
            </button>
            {!scopeStepApplies ? (
              <button type="button" className="admin-btn-secondary" onClick={advanceFromScope}>
                Skip
              </button>
            ) : null}
          </div>
          <IntegrationScopePanel
            provider="slack"
            orgPlan={orgPlan}
            connected={Boolean(slackConnected)}
            onSaved={() => void load({ provider: "slack" })}
          />
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <p className="text-sm text-coop-muted">
            Invite teammates — they receive an email with install instructions.
            {memberCount !== null ? ` ${memberCount} member${memberCount === 1 ? "" : "s"} in your org.` : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            <Link href="/users" className="admin-btn-primary">
              Invite users
            </Link>
            <button type="button" className="admin-btn-secondary" onClick={() => goToStep(4)}>
              Skip
            </button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-4">
          <OnboardingVerifyStep onGatesChange={setVerifyCanComplete} />
          <button
            type="button"
            className="admin-btn-primary"
            onClick={() => goToStep(5)}
            disabled={!verifyCanComplete}
          >
            Continue
          </button>
        </div>
      )}

      {step === 5 && (
        <div className="space-y-4">
          <p className="text-sm text-coop-muted">
            Developers install the Coop AI VS Code extension and sign in with an API key you issue from{" "}
            <Link href="/api-keys" className="admin-link">
              API Keys
            </Link>
            .
          </p>
          <button
            type="button"
            className="admin-btn-primary"
            onClick={() => void finish()}
            disabled={finishDisabled}
          >
            {saving ? "Saving…" : "Finish setup"}
          </button>
        </div>
      )}
    </div>
  );
}
