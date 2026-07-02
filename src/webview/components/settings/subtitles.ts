import { identityDirectorySummary } from "../../../identity/identityDirectory";
import type { IntegrationChatProvider } from "../../../chat/types";
import type { Preferences } from "./types";
export {
  accountHubSubtitle,
  planUsageHubSubtitle,
  indexingHubSubtitle,
  toolsHubSubtitle,
  displayOrgName,
  displayIdentitySubtitle,
  preferencesHubSubtitle
} from "./connectionCopy";

const CODE_HOST_LABELS: Record<Preferences["defaultCodeHost"], string> = {
  github: "GitHub",
  gitlab: "GitLab",
  bitbucket: "Bitbucket"
};

function formatModelLabel(model: string): string {
  return model.replace(/-\d{8}$/, "").replace(/-/g, " ");
}

function countConfigured(flags: boolean[]): string {
  const configured = flags.filter(Boolean).length;
  return `${configured}/${flags.length} configured`;
}

function integrationNames(prefs: Preferences): string {
  const names: string[] = [];
  if (integrationConfigured(prefs, "slack")) {
    names.push("Slack");
  }
  if (integrationConfigured(prefs, "jira")) {
    names.push("Jira");
  }
  if (integrationConfigured(prefs, "teams")) {
    names.push("Teams");
  }
  if (integrationConfigured(prefs, "confluence")) {
    names.push("Confluence");
  }
  if (integrationConfigured(prefs, "notion")) {
    names.push("Notion");
  }
  if (integrationConfigured(prefs, "google-docs")) {
    names.push("Google Docs");
  }
  return names.length > 0 ? names.join(" · ") : "None configured";
}

export function modelHubSubtitle(prefs: Preferences): string {
  const model = formatModelLabel(prefs.model);
  const chat = prefs.llmEnabled ? "Chat on" : "Chat off";
  return `${model} · ${chat}`;
}

export function apiHubSubtitle(prefs: Preferences): string {
  if (!(prefs.isSignedIn ?? prefs.hasApiKey)) {
    return "Not signed in";
  }
  try {
    const host = new URL(prefs.apiBaseUrl).host;
    return `Connected · ${host}`;
  } catch {
    return "Connected";
  }
}

export function gitlabIsConfigured(prefs: Preferences): boolean {
  if (prefs.devMode) {
    return prefs.hasGitLabAppInstalled || prefs.hasGitLabToken;
  }
  return prefs.hasGitLabAppInstalled;
}

export function bitbucketIsConfigured(prefs: Preferences): boolean {
  if (prefs.devMode) {
    return prefs.hasBitbucketAppInstalled || prefs.hasBitbucketCredentials;
  }
  return prefs.hasBitbucketAppInstalled;
}

export function codeHostsHubSubtitle(prefs: Preferences): string {
  const defaultHost = CODE_HOST_LABELS[prefs.defaultCodeHost];
  const configured = countConfigured([
    githubIsConfigured(prefs),
    gitlabIsConfigured(prefs),
    bitbucketIsConfigured(prefs)
  ]);
  return `${defaultHost} default · ${configured}`;
}

export function integrationsHubSubtitle(prefs: Preferences): string {
  return integrationNames(prefs);
}

export function workspaceHubSubtitle(prefs: Preferences): string {
  const repo =
    prefs.owner && prefs.repo ? `${prefs.owner}/${prefs.repo}` : "No repo set";
  const branch = prefs.branch || "main";
  return `${repo} · ${branch}`;
}

export function identityLinksHubSubtitle(prefs: Preferences): string {
  return identityDirectorySummary(prefs.identityDirectory);
}

/** @deprecated Use identityLinksHubSubtitle */
export const teamHubSubtitle = identityLinksHubSubtitle;

export function promptsHubSubtitle(pinnedCount: number): string {
  if (pinnedCount === 0) {
    return "No quick prompts pinned";
  }
  return pinnedCount === 1 ? "1 quick prompt pinned" : `${pinnedCount} quick prompts pinned`;
}

export function githubIsConfigured(prefs: Preferences): boolean {
  if (prefs.githubNeedsReconnect) {
    return false;
  }
  if (prefs.devMode) {
    return prefs.hasGitHubAppInstalled || prefs.hasGitHubToken;
  }
  return prefs.hasGitHubAppInstalled;
}

export function codeHostConfigured(prefs: Preferences, provider: Preferences["defaultCodeHost"] | "github" | "gitlab" | "bitbucket"): boolean {
  if (provider === "github") {
    return githubIsConfigured(prefs);
  }
  if (provider === "gitlab") {
    return gitlabIsConfigured(prefs);
  }
  return bitbucketIsConfigured(prefs);
}

export function integrationConfigured(
  prefs: Preferences,
  provider: IntegrationChatProvider
): boolean {
  if (provider === "slack") {
    return prefs.devMode ? prefs.hasSlackToken : prefs.hasSlackInstalled;
  }
  if (provider === "jira") {
    return prefs.devMode ? prefs.hasJiraCredentials : prefs.hasAtlassianInstalled;
  }
  if (provider === "teams") {
    return prefs.devMode ? prefs.hasTeamsToken : prefs.hasTeamsInstalled;
  }
  if (provider === "confluence") {
    return prefs.devMode ? prefs.hasConfluenceCredentials : prefs.hasAtlassianInstalled;
  }
  if (provider === "notion") {
    return prefs.devMode ? prefs.hasNotionToken : prefs.hasNotionInstalled;
  }
  return prefs.devMode ? prefs.hasGoogleDocsToken : prefs.hasGoogleDocsInstalled;
}
