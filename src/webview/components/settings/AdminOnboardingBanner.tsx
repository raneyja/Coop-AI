import React, { useMemo, useState } from "react";
import type { Preferences } from "./types";
import { CoopNotice } from "../CoopNotice";
import {
  accountHubSubtitle,
  planUsageHubSubtitle,
  toolsHubSubtitle,
  workspaceHubSubtitle
} from "./subtitles";

const DISMISS_UNTIL_KEY = "coop.adminOnboarding.dismissedUntil";
const DISMISS_DURATION_MS = 24 * 60 * 60 * 1000;

type AdminOnboardingBannerProps = {
  prefs: Preferences;
};

function isDismissed(): boolean {
  if (typeof localStorage === "undefined") {
    return false;
  }
  const raw = localStorage.getItem(DISMISS_UNTIL_KEY);
  const until = raw ? Number.parseInt(raw, 10) : 0;
  if (!Number.isFinite(until)) {
    return false;
  }
  return Date.now() < until;
}

function dismissForOneDay(): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  localStorage.setItem(DISMISS_UNTIL_KEY, String(Date.now() + DISMISS_DURATION_MS));
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
    return !isDismissed();
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
            dismissForOneDay();
            setDismissed(true);
          }}
        >
          Dismiss
        </button>
      </div>
    </CoopNotice>
  );
}
