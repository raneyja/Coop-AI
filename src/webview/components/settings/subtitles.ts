import { identityDirectorySummary } from "../../../identity/identityDirectory";
import type { IntegrationChatProvider } from "../../../chat/types";
import { assignedModelsHubSubtitle } from "../../../config/featureModelAssignments";
import type { Preferences } from "./types";
import {
  codeHostConfiguredFromFlags,
  codeHostReady,
  findOrgIntegrationStatus,
  integrationConfiguredFromFlags,
  integrationReady,
  integrationToOrgProvider
} from "./integrationStatus";
export {
  accountHubSubtitle,
  planUsageHubSubtitle,
  indexingHubSubtitle,
  toolsHubSubtitle,
  displayOrgName,
  displayIdentitySubtitle,
  preferencesHubSubtitle
} from "./connectionCopy";
export { codeHostReady, integrationReady } from "./integrationStatus";

const CODE_HOST_LABELS: Record<Preferences["defaultCodeHost"], string> = {
  github: "GitHub",
  gitlab: "GitLab",
  bitbucket: "Bitbucket"
};

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
  return assignedModelsHubSubtitle({
    autocompleteEnabled: prefs.autocompleteEnabled
  });
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
  const connected: string[] = [];
  if (githubIsConfigured(prefs)) {
    connected.push(CODE_HOST_LABELS.github);
  }
  if (gitlabIsConfigured(prefs)) {
    connected.push(CODE_HOST_LABELS.gitlab);
  }
  if (bitbucketIsConfigured(prefs)) {
    connected.push(CODE_HOST_LABELS.bitbucket);
  }
  if (connected.length === 0) {
    return "No code hosts connected";
  }
  return `${connected.join(" · ")} active`;
}

export function integrationsHubSubtitle(prefs: Preferences): string {
  return integrationNames(prefs);
}

export function workspaceHubSubtitle(prefs: Preferences): string {
  const repo =
    prefs.owner && prefs.repo ? `${prefs.owner}/${prefs.repo}` : "No repo set";
  const branch = prefs.branch || "main";
  const agentsHint = prefs.projectInstructions?.hasAgentsMd
    ? " · AGENTS.md ✓"
    : prefs.projectInstructions?.status !== "disabled" && prefs.projectInstructions?.status !== "no_git"
      ? " · Add AGENTS.md"
      : "";
  return `${repo} · ${branch}${agentsHint}`;
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
  if (prefs.devMode) {
    return codeHostConfiguredFromFlags(prefs, "github");
  }
  const orgStatus = findOrgIntegrationStatus(prefs, "github");
  if (orgStatus) {
    return orgStatus.installed;
  }
  if (prefs.githubNeedsReconnect) {
    return false;
  }
  return prefs.hasGitHubAppInstalled;
}

export function codeHostConfigured(prefs: Preferences, provider: Preferences["defaultCodeHost"] | "github" | "gitlab" | "bitbucket"): boolean {
  if (prefs.devMode) {
    return codeHostConfiguredFromFlags(prefs, provider);
  }
  const orgStatus = findOrgIntegrationStatus(prefs, provider);
  if (orgStatus) {
    return orgStatus.installed;
  }
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
  if (prefs.devMode) {
    return integrationConfiguredFromFlags(prefs, provider);
  }
  const orgStatus = findOrgIntegrationStatus(prefs, integrationToOrgProvider(provider));
  if (orgStatus) {
    return orgStatus.installed;
  }
  if (provider === "slack") {
    return prefs.hasSlackInstalled;
  }
  if (provider === "jira" || provider === "confluence") {
    return prefs.hasAtlassianInstalled;
  }
  if (provider === "teams") {
    return prefs.hasTeamsInstalled;
  }
  if (provider === "notion") {
    return prefs.hasNotionInstalled;
  }
  return prefs.hasGoogleDocsInstalled;
}
