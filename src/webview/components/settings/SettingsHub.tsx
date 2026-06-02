import React from "react";
import { CoopNavList, CoopNavRow } from "../CoopNavRow";
import { CoopPanelHeader } from "../CoopPanelHeader";
import type { Preferences, SettingsDetailScreen, SettingsScreen } from "./types";
import { SETTINGS_SCREEN_TITLES, settingsScreenParentLabel } from "./types";
import {
  apiHubSubtitle,
  codeHostsHubSubtitle,
  integrationsHubSubtitle,
  modelHubSubtitle,
  promptsHubSubtitle,
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
}> = [
  { screen: "model", title: "Model & chat", subtitle: (p) => modelHubSubtitle(p) },
  { screen: "api", title: "Coop API", subtitle: (p) => apiHubSubtitle(p) },
  { screen: "code-hosts", title: "Code hosts", subtitle: (p) => codeHostsHubSubtitle(p) },
  { screen: "integrations", title: "Integrations", subtitle: (p) => integrationsHubSubtitle(p) },
  { screen: "workspace", title: "Workspace", subtitle: (p) => workspaceHubSubtitle(p) },
  {
    screen: "prompts",
    title: "Prompt library",
    subtitle: (_p, pinned) => promptsHubSubtitle(pinned)
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
          configured={row.screen === "api" ? prefs.hasApiKey : undefined}
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
              API key configured
            </span>
          ) : (
            <span className="shrink-0 text-[11px] text-[var(--coop-panel-muted)]">No API key</span>
          )
        ) : undefined
      }
    />
  );
}
