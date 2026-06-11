"use client";

import { useState } from "react";
import Link from "next/link";
import { completeOnboarding } from "@/lib/coopApi";
import type { IntegrationStatus } from "@/lib/integrations";

type OnboardingWizardProps = {
  integrations: IntegrationStatus[];
  onComplete: () => void;
};

const STEPS = ["Welcome", "Connect tools", "Invite team", "Done"] as const;

export function OnboardingWizard({ integrations, onComplete }: OnboardingWizardProps) {
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const githubConnected = integrations.find((i) => i.provider === "github")?.installed;

  async function finish() {
    setSaving(true);
    await completeOnboarding();
    setSaving(false);
    onComplete();
  }

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
          <button type="button" className="admin-btn-primary" onClick={() => setStep(1)}>
            Continue
          </button>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-4">
          <p className="text-sm text-coop-muted">
            Connect GitHub first, then add Slack, Jira, Notion, or Google Docs as needed.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link href="/integrations" className="admin-btn-primary">
              Open integrations
            </Link>
            <button type="button" className="admin-btn-secondary" onClick={() => setStep(2)}>
              {githubConnected ? "Continue" : "Skip for now"}
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <p className="text-sm text-coop-muted">Invite teammates — they receive an email with install instructions.</p>
          <div className="flex flex-wrap gap-2">
            <Link href="/users" className="admin-btn-primary">
              Invite users
            </Link>
            <button type="button" className="admin-btn-secondary" onClick={() => setStep(3)}>
              Skip
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <p className="text-sm text-coop-muted">
            Developers install the Coop AI VS Code extension and sign in with an API key you issue from{" "}
            <strong className="font-medium text-white/90">API Keys</strong>.
          </p>
          <button type="button" className="admin-btn-primary" onClick={() => void finish()} disabled={saving}>
            {saving ? "Saving…" : "Finish setup"}
          </button>
        </div>
      )}
    </div>
  );
}
