import type { IntegrationChatProvider } from "../../../chat/types";
import type { Preferences } from "./types";
import {
  bitbucketIsConfigured,
  codeHostConfigured,
  githubIsConfigured,
  gitlabIsConfigured,
  integrationConfigured
} from "./subtitles";

type CodeHostProvider = "github" | "gitlab" | "bitbucket";
type IntegrationProvider = IntegrationChatProvider;

const CODE_HOST_NAMES: Record<CodeHostProvider, string> = {
  github: "GitHub",
  gitlab: "GitLab",
  bitbucket: "Bitbucket"
};

const INTEGRATION_NAMES: Record<IntegrationProvider, string> = {
  slack: "Slack",
  jira: "Jira",
  teams: "Microsoft Teams",
  confluence: "Confluence",
  notion: "Notion",
  "google-docs": "Google Docs"
};

export function codeHostConnectionMeta(prefs: Preferences, provider: CodeHostProvider): string {
  const name = CODE_HOST_NAMES[provider];
  if (provider === "github" && prefs.githubNeedsReconnect) {
    return "Reconnect GitHub — access expired";
  }
  const connected = codeHostConfigured(prefs, provider);

  if (!connected) {
    return "Not connected";
  }

  if (prefs.devMode) {
    const viaApp =
      (provider === "github" && prefs.hasGitHubAppInstalled) ||
      (provider === "gitlab" && prefs.hasGitLabAppInstalled) ||
      (provider === "bitbucket" && prefs.hasBitbucketAppInstalled);
    if (viaApp) {
      return `Connected to ${name} for your organization`;
    }
    return `Connected via developer token`;
  }

  if (provider === "github" && prefs.hasGitHubAppInstalled) {
    return "Connected to GitHub for your organization";
  }
  if (provider === "gitlab" && prefs.hasGitLabAppInstalled) {
    return "Connected to GitLab for your organization";
  }
  if (provider === "bitbucket" && prefs.hasBitbucketAppInstalled) {
    return "Connected to Bitbucket for your organization";
  }

  return `Connected to ${name}`;
}

export function codeHostListSubtitle(prefs: Preferences, provider: CodeHostProvider): string {
  return codeHostConnectionMeta(prefs, provider);
}

export function integrationConnectionMeta(prefs: Preferences, provider: IntegrationProvider): string {
  const name = INTEGRATION_NAMES[provider];
  if (!integrationConfigured(prefs, provider)) {
    return "Not connected";
  }
  if (provider === "slack" && prefs.slackTeamName) {
    return `Connected to ${prefs.slackTeamName}`;
  }
  if ((provider === "jira" || provider === "confluence") && prefs.atlassianSiteName) {
    return `Connected to ${prefs.atlassianSiteName}`;
  }
  if (provider === "notion" && prefs.notionWorkspaceName) {
    return `Connected to ${prefs.notionWorkspaceName}`;
  }
  if (provider === "teams" && prefs.teamsDisplayName) {
    return `Connected as ${prefs.teamsDisplayName}`;
  }
  if (provider === "google-docs" && prefs.googleDocsDisplayName) {
    return `Connected as ${prefs.googleDocsDisplayName}`;
  }
  if (prefs.devMode) {
    return "Connected via developer token";
  }
  return `Connected to ${name}`;
}

export function integrationListSubtitle(prefs: Preferences, provider: IntegrationProvider): string {
  return integrationConnectionMeta(prefs, provider);
}

export function toolsHubSubtitle(prefs: Preferences): string {
  const codeHosts = [githubIsConfigured(prefs), gitlabIsConfigured(prefs), bitbucketIsConfigured(prefs)];
  const collaborationTools = [
    integrationConfigured(prefs, "slack"),
    integrationConfigured(prefs, "jira"),
    integrationConfigured(prefs, "confluence"),
    integrationConfigured(prefs, "notion"),
    integrationConfigured(prefs, "google-docs")
  ];
  const connected = [...codeHosts, ...collaborationTools].filter(Boolean).length;
  const total = codeHosts.length + collaborationTools.length;
  if (connected === 0) {
    return "No tools connected yet";
  }
  return `${connected} of ${total} connected`;
}

export function formatQuotaRetryLabel(resetsAtIso: string): string {
  const ms = new Date(resetsAtIso).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) {
    return "soon";
  }
  if (ms >= 3_600_000) {
    const hours = Math.floor(ms / 3_600_000);
    const minutes = Math.round((ms % 3_600_000) / 60_000);
    if (minutes <= 0) {
      return hours === 1 ? "in 1 hour" : `in ${hours} hours`;
    }
    return `in ${hours}h ${minutes}m`;
  }
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  return minutes === 1 ? "in 1 minute" : `in ${minutes} minutes`;
}

export function displayOrgName(prefs: Pick<Preferences, "orgName">): string | undefined {
  const name = prefs.orgName?.trim();
  if (!name || name === "Legacy") {
    return undefined;
  }
  return name;
}

export function displayPlanLabel(prefs: Pick<Preferences, "plan">): string {
  switch (prefs.plan) {
    case "enterprise":
      return "Enterprise";
    case "pro":
      return "Pro";
    default:
      return "Developer (free)";
  }
}

export function preferencesSignedIn(prefs: Pick<Preferences, "isSignedIn" | "hasApiKey">): boolean {
  return prefs.isSignedIn ?? prefs.hasApiKey;
}

export function displayIdentitySubtitle(prefs: Preferences): string | undefined {
  if (!preferencesSignedIn(prefs)) {
    return undefined;
  }
  const orgName = displayOrgName(prefs);
  const plan = displayPlanLabel(prefs);
  return orgName ? `${orgName} · ${plan}` : plan;
}

export function accountHubSubtitle(prefs: Preferences): string {
  if (!preferencesSignedIn(prefs)) {
    return "Not signed in";
  }
  try {
    return `Signed in · ${new URL(prefs.apiBaseUrl).host}`;
  } catch {
    return "Signed in";
  }
}

export function formatQuotaUsageSummary(quota: {
  usedCredits: number;
  limitCredits: number;
  remainingCredits: number;
  windowHours: number;
}): string {
  const used = quota.usedCredits ?? Math.max(0, quota.limitCredits - quota.remainingCredits);
  return `${used}K of ${quota.limitCredits}K AI credits used - ${quota.windowHours}-hour rolling window`;
}

export function planUsageHubSubtitle(prefs: Preferences): string {
  if (!preferencesSignedIn(prefs)) {
    return "Sign in to view plan";
  }
  const plan = displayPlanLabel(prefs);
  if (prefs.plan === "free" && prefs.quotaCredits) {
    const used =
      prefs.quotaCredits.usedCredits ??
      Math.max(0, prefs.quotaCredits.limitCredits - prefs.quotaCredits.remainingCredits);
    return `${plan} · ${used}K of ${prefs.quotaCredits.limitCredits}K used`;
  }
  return plan;
}

export function indexingHubSubtitle(
  prefs: Preferences,
  lightningState?: { readyRepos: number; indexingRepos: number; indexedRepoCount?: number; indexedRepoLimit?: number | null } | null
): string {
  if (!preferencesSignedIn(prefs)) {
    return "Sign in to view indexing";
  }
  if (!lightningState) {
    return "Loading status…";
  }
  if (lightningState.indexingRepos > 0) {
    return `${lightningState.readyRepos} ready · ${lightningState.indexingRepos} building`;
  }
  if (lightningState.indexedRepoLimit != null && lightningState.indexedRepoCount != null) {
    return `${lightningState.indexedRepoCount}/${lightningState.indexedRepoLimit} Deep-Indexed repos`;
  }
  if (lightningState.readyRepos > 0) {
    return `${lightningState.readyRepos} ready`;
  }
  return "No repos indexed yet";
}

export function preferencesHubSubtitle(prefs: Preferences, pinnedCount: number): string {
  const model = prefs.model.replace(/-\d{8}$/, "").replace(/-/g, " ");
  const prompts =
    pinnedCount === 0
      ? "No quick prompts"
      : pinnedCount === 1
        ? "1 quick prompt"
        : `${pinnedCount} quick prompts`;
  return `${model} · ${prompts}`;
}

export function integrationDisplayName(provider: IntegrationProvider): string {
  return INTEGRATION_NAMES[provider];
}

export function codeHostDisplayName(provider: CodeHostProvider): string {
  return CODE_HOST_NAMES[provider];
}
