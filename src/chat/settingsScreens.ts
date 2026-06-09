export type SettingsScreen =
  | "hub"
  | "account"
  | "connections"
  | "code-host-github"
  | "code-host-gitlab"
  | "code-host-bitbucket"
  | "integration-slack"
  | "integration-jira"
  | "integration-teams"
  | "integration-confluence"
  | "integration-notion"
  | "integration-google-docs"
  | "team"
  | "workspace"
  | "preferences"
  | "model"
  | "prompts";

/** @deprecated Legacy screen ids — use migrateSettingsScreen before routing. */
export type LegacySettingsScreen =
  | "api"
  | "code-hosts"
  | "integrations"
  | "identity-links";

export type SettingsDetailScreen = Exclude<SettingsScreen, "hub">;

export const SETTINGS_SCREEN_TITLES: Record<SettingsDetailScreen, string> = {
  account: "Account",
  connections: "Connections",
  "code-host-github": "GitHub",
  "code-host-gitlab": "GitLab",
  "code-host-bitbucket": "Bitbucket",
  "integration-slack": "Slack",
  "integration-jira": "Jira",
  "integration-teams": "Microsoft Teams",
  "integration-confluence": "Confluence",
  "integration-notion": "Notion",
  "integration-google-docs": "Google Docs",
  team: "Team",
  workspace: "Workspace",
  preferences: "Preferences",
  model: "Model & chat",
  prompts: "Prompt library"
};

const LEGACY_SCREEN_MAP: Record<string, SettingsScreen> = {
  api: "account",
  "code-hosts": "connections",
  integrations: "connections",
  "identity-links": "team"
};

const PROVIDER_SETTINGS_SCREEN: Record<string, SettingsScreen> = {
  github: "code-host-github",
  gitlab: "code-host-gitlab",
  bitbucket: "code-host-bitbucket",
  slack: "integration-slack",
  jira: "integration-jira",
  teams: "integration-teams",
  confluence: "integration-confluence",
  notion: "integration-notion",
  "google-docs": "integration-google-docs"
};

export function migrateSettingsScreen(value: string): SettingsScreen {
  const migrated = LEGACY_SCREEN_MAP[value] ?? value;
  return isSettingsScreen(migrated) ? migrated : "hub";
}

export function settingsScreenForProvider(provider: string): SettingsScreen | undefined {
  return PROVIDER_SETTINGS_SCREEN[provider];
}

export function settingsScreenParent(screen: SettingsScreen): SettingsScreen {
  if (screen === "code-host-github" || screen === "code-host-gitlab" || screen === "code-host-bitbucket") {
    return "connections";
  }
  if (
    screen === "integration-slack" ||
    screen === "integration-jira" ||
    screen === "integration-teams" ||
    screen === "integration-confluence" ||
    screen === "integration-notion" ||
    screen === "integration-google-docs"
  ) {
    return "connections";
  }
  if (screen === "model" || screen === "prompts") {
    return "preferences";
  }
  return "hub";
}

export function settingsScreenParentLabel(screen: SettingsScreen): string {
  const parent = settingsScreenParent(screen);
  if (parent === "hub") {
    return "Settings";
  }
  return SETTINGS_SCREEN_TITLES[parent];
}

export function isSettingsScreen(value: string): value is SettingsScreen {
  return (
    value === "hub" ||
    value in SETTINGS_SCREEN_TITLES ||
    value === "connections" ||
    value === "preferences"
  );
}
