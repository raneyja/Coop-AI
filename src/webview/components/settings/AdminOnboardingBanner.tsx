import React, { useMemo, useState } from "react";
import type { Preferences } from "./types";
import { CoopNotice } from "../CoopNotice";
import {
  accountHubSubtitle,
  planUsageHubSubtitle,
  toolsHubSubtitle,
  workspaceHubSubtitle
} from "./subtitles";

const DISMISS_KEY = "coop.adminOnboarding.dismissCount";

type AdminOnboardingBannerProps = {
  prefs: Preferences;
};

function readDismissCount(): number {
  if (typeof sessionStorage === "undefined") {
    return 0;
  }
  const raw = sessionStorage.getItem(DISMISS_KEY);
  const parsed = raw ? Number.parseInt(raw, 10) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function writeDismissCount(count: number): void {
  sessionStorage.setItem(DISMISS_KEY, String(count));
}

export function AdminOnboardingBanner({ prefs }: AdminOnboardingBannerProps): React.ReactElement | null {
  const [dismissed, setDismissed] = useState(false);

  const visible = useMemo(() => {
    if (dismissed) {
      return false;
    }
    if (prefs.devMode || prefs.canInstallIntegrations !== true) {
      return false;
    }
    if (prefs.onboardingCompleted) {
      return false;
    }
    return readDismissCount() < 3;
  }, [dismissed, prefs.canInstallIntegrations, prefs.devMode, prefs.onboardingCompleted]);

  if (!visible) {
    return null;
  }

  const adminBase = (prefs.adminPortalUrl ?? "https://admin.coop-ai.dev").replace(/\/$/, "");
  const scopeHint =
    prefs.plan === "enterprise" && (prefs.integrationHealthSummary?.scopeRequired ?? 0) > 0;

  return (
    <CoopNotice tone="info" compact className="mb-3">
      <p className="coop-settings-row-title">Finish org setup</p>
      <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-[var(--coop-panel-muted)]">
        <li>Account: {accountHubSubtitle(prefs)}</li>
        <li>Plan &amp; Usage: {planUsageHubSubtitle(prefs)}</li>
        <li>Tools: {toolsHubSubtitle(prefs)}</li>
        <li>Workspace: {workspaceHubSubtitle(prefs)}</li>
        {scopeHint ? (
          <li>
            Slack scope: configure channel access in the{" "}
            <a className="coop-text-btn" href={`${adminBase}/integrations`} target="_blank" rel="noreferrer">
              admin portal
            </a>
          </li>
        ) : null}
        <li>
          API keys: issue keys from the{" "}
          <a className="coop-text-btn" href={`${adminBase}/api-keys`} target="_blank" rel="noreferrer">
            admin portal
          </a>
        </li>
        <li>Open Plan &amp; Usage in Settings for billing and org dashboard links.</li>
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="coop-text-btn"
          onClick={() => {
            writeDismissCount(readDismissCount() + 1);
            setDismissed(true);
          }}
        >
          Dismiss
        </button>
      </div>
    </CoopNotice>
  );
}
