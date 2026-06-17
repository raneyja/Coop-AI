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

export function connectionsHubSubtitle(prefs: Preferences): string {
  const codeHosts = [githubIsConfigured(prefs), gitlabIsConfigured(prefs), bitbucketIsConfigured(prefs)];
  const tools = [
    integrationConfigured(prefs, "slack"),
    integrationConfigured(prefs, "jira"),
    integrationConfigured(prefs, "confluence"),
    integrationConfigured(prefs, "notion"),
    integrationConfigured(prefs, "google-docs")
  ];
  const connected = [...codeHosts, ...tools].filter(Boolean).length;
  const total = codeHosts.length + tools.length;
  if (connected === 0) {
    return "No connections yet";
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

export function accountHubSubtitle(prefs: Preferences): string {
  if (prefs.plan === "free" && prefs.quotaCredits) {
    const { remainingCredits, limitCredits } = prefs.quotaCredits;
    return `${remainingCredits} of ${limitCredits} AI credits left`;
  }
  if (prefs.authMethod === "sso_session" && prefs.orgName) {
    return `Signed in to ${prefs.orgName}`;
  }
  if (prefs.hasApiKey) {
    try {
      return `Signed in · ${new URL(prefs.apiBaseUrl).host}`;
    } catch {
      return "Signed in";
    }
  }
  return "Not signed in";
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
