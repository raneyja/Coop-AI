import React from "react";
import { CoopNavList, CoopNavRow } from "../CoopNavRow";
import { CoopPanelHeader } from "../CoopPanelHeader";
import { AdminOnboardingBanner } from "./AdminOnboardingBanner";
import type { Preferences, SettingsDetailScreen, SettingsScreen } from "./types";
import { SETTINGS_SCREEN_TITLES, settingsScreenParentLabel } from "./types";
import {
  accountHubSubtitle,
  indexingHubSubtitle,
  planUsageHubSubtitle,
  toolsHubSubtitle,
  displayIdentitySubtitle,
  preferencesHubSubtitle,
  workspaceHubSubtitle
} from "./subtitles";

export type SettingsLightningSummary = {
  readyRepos: number;
  indexingRepos: number;
  indexedRepoCount?: number;
  indexedRepoLimit?: number | null;
};

type SettingsHubProps = {
  prefs: Preferences;
  pinnedCount: number;
  lightningState?: SettingsLightningSummary | null;
  onNavigate: (screen: SettingsDetailScreen) => void;
};

const HUB_ROWS: Array<{
  screen: SettingsDetailScreen;
  title: string;
  subtitle: (prefs: Preferences, pinnedCount: number, lightningState?: SettingsLightningSummary | null) => string;
  configured?: (prefs: Preferences) => boolean | undefined;
}> = [
  { screen: "account", title: "Account", subtitle: (p) => accountHubSubtitle(p), configured: (p) => p.isSignedIn ?? p.hasApiKey },
  {
    screen: "plan-usage",
    title: "Plan & Usage",
    subtitle: (p) => planUsageHubSubtitle(p),
    configured: (p) => p.isSignedIn ?? p.hasApiKey
  },
  {
    screen: "tools",
    title: "Tools",
    subtitle: (p) => toolsHubSubtitle(p)
  },
  { screen: "workspace", title: "Workspace", subtitle: (p) => workspaceHubSubtitle(p) },
  {
    screen: "indexing",
    title: "Indexing",
    subtitle: (p, _pinned, lightningState) => indexingHubSubtitle(p, lightningState)
  },
  {
    screen: "preferences",
    title: "Preferences",
    subtitle: (p, pinned) => preferencesHubSubtitle(p, pinned)
  }
];

export function SettingsHub({ prefs, pinnedCount, lightningState, onNavigate }: SettingsHubProps): React.ReactElement {
  return (
    <>
      <AdminOnboardingBanner prefs={prefs} />
      <CoopNavList>
        {HUB_ROWS.map((row) => (
          <CoopNavRow
            key={row.screen}
            title={row.title}
            subtitle={row.subtitle(prefs, pinnedCount, lightningState)}
            configured={row.configured?.(prefs)}
            onClick={() => onNavigate(row.screen)}
          />
        ))}
      </CoopNavList>
    </>
  );
}

type SettingsNavHeaderProps = {
  screen: SettingsScreen;
  prefs: Preferences;
  onBack: () => void;
  onClose: () => void;
};

export function SettingsNavHeader({
  screen,
  prefs,
  onBack,
  onClose
}: SettingsNavHeaderProps): React.ReactElement {
  const isHub = screen === "hub";
  const title = isHub ? "Settings" : SETTINGS_SCREEN_TITLES[screen];
  const identitySubtitle = displayIdentitySubtitle(prefs);

  return (
    <CoopPanelHeader
      title={title}
      subtitle={identitySubtitle}
      backLabel={isHub ? undefined : settingsScreenParentLabel(screen)}
      onBack={isHub ? undefined : onBack}
      onClose={onClose}
      closeAriaLabel="Close settings"
      meta={
        isHub ? (
          prefs.isSignedIn ?? prefs.hasApiKey ? (
            <span className="shrink-0 text-[11px] text-[var(--vscode-testing-iconPassed,#22c55e)]">
              Signed in
            </span>
          ) : (
            <span className="shrink-0 text-[11px] text-[var(--coop-panel-muted)]">Not signed in</span>
          )
        ) : undefined
      }
    />
  );
}
