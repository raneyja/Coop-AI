import React from "react";
import { CoopNavList, CoopNavRow } from "../CoopNavRow";
import { CoopPanelHeader } from "../CoopPanelHeader";
import type { Preferences, SettingsDetailScreen, SettingsScreen } from "./types";
import { SETTINGS_SCREEN_TITLES, settingsScreenParentLabel } from "./types";
import {
  accountHubSubtitle,
  connectionsHubSubtitle,
  identityLinksHubSubtitle,
  preferencesHubSubtitle,
  workspaceHubSubtitle
} from "./subtitles";

type SettingsHubProps = {
  prefs: Preferences;
  pinnedCount: number;
  onNavigate: (screen: SettingsDetailScreen) => void;
};

const HUB_ROWS: Array<{
  screen: SettingsDetailScreen;
  title: string;
  subtitle: (prefs: Preferences, pinnedCount: number) => string;
  configured?: (prefs: Preferences) => boolean | undefined;
}> = [
  { screen: "account", title: "Account", subtitle: (p) => accountHubSubtitle(p), configured: (p) => p.hasApiKey },
  {
    screen: "connections",
    title: "Connections",
    subtitle: (p) => connectionsHubSubtitle(p)
  },
  { screen: "team", title: "Team", subtitle: (p) => identityLinksHubSubtitle(p) },
  { screen: "workspace", title: "Workspace", subtitle: (p) => workspaceHubSubtitle(p) },
  {
    screen: "preferences",
    title: "Preferences",
    subtitle: (p, pinned) => preferencesHubSubtitle(p, pinned)
  }
];

export function SettingsHub({ prefs, pinnedCount, onNavigate }: SettingsHubProps): React.ReactElement {
  return (
    <CoopNavList>
      {HUB_ROWS.map((row) => (
        <CoopNavRow
          key={row.screen}
          title={row.title}
          subtitle={row.subtitle(prefs, pinnedCount)}
          configured={row.configured?.(prefs)}
          onClick={() => onNavigate(row.screen)}
        />
      ))}
    </CoopNavList>
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

  return (
    <CoopPanelHeader
      title={title}
      backLabel={isHub ? undefined : settingsScreenParentLabel(screen)}
      onBack={isHub ? undefined : onBack}
      onClose={onClose}
      closeAriaLabel="Close settings"
      meta={
        isHub ? (
          prefs.hasApiKey ? (
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
