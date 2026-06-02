export type SettingsScreen =
  | "hub"
  | "model"
  | "api"
  | "code-hosts"
  | "code-host-github"
  | "code-host-gitlab"
  | "code-host-bitbucket"
  | "integrations"
  | "integration-slack"
  | "integration-jira"
  | "integration-teams"
  | "workspace"
  | "prompts";

export type SettingsDetailScreen = Exclude<SettingsScreen, "hub">;

export const SETTINGS_SCREEN_TITLES: Record<SettingsDetailScreen, string> = {
  model: "Model & chat",
  api: "Coop API",
  "code-hosts": "Code hosts",
  "code-host-github": "GitHub",
  "code-host-gitlab": "GitLab",
  "code-host-bitbucket": "Bitbucket",
  integrations: "Integrations",
  "integration-slack": "Slack",
  "integration-jira": "Jira",
  "integration-teams": "Microsoft Teams",
  workspace: "Workspace",
  prompts: "Prompt library"
};

const PROVIDER_SETTINGS_SCREEN: Record<string, SettingsScreen> = {
  github: "code-host-github",
  gitlab: "code-host-gitlab",
  bitbucket: "code-host-bitbucket",
  slack: "integration-slack",
  jira: "integration-jira",
  teams: "integration-teams"
};

export function settingsScreenForProvider(provider: string): SettingsScreen | undefined {
  return PROVIDER_SETTINGS_SCREEN[provider];
}

export function settingsScreenParent(screen: SettingsScreen): SettingsScreen {
  if (screen === "code-host-github" || screen === "code-host-gitlab" || screen === "code-host-bitbucket") {
    return "code-hosts";
  }
  if (screen === "integration-slack" || screen === "integration-jira" || screen === "integration-teams") {
    return "integrations";
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
    value === "code-hosts" ||
    value === "integrations"
  );
}
