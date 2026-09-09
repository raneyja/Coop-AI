import type { IntegrationChatProvider } from "../../../chat/types";
import type { Preferences } from "./types";
import {
  codeHostConfigured,
  codeHostReady,
  integrationConfigured,
  integrationReady
} from "./subtitles";
import { findOrgIntegrationStatus, integrationToOrgProvider } from "./integrationStatus";

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
  const orgStatus = findOrgIntegrationStatus(prefs, integrationToOrgProvider(provider));
  if (provider === "slack" && prefs.slackNeedsReconnect) {
    return "Reconnect required — finish in the Coop admin portal";
  }
  if (orgStatus?.needsReconnect || orgStatus?.scopeNeedsReconnect) {
    return "Reconnect required — finish in the Coop admin portal";
  }
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
  return `Connected to ${name}`;
}

export function integrationListSubtitle(prefs: Preferences, provider: IntegrationProvider): string {
  return integrationConnectionMeta(prefs, provider);
}

export function toolsHubSubtitle(prefs: Preferences): string {
  const codeHostsReady = [
    codeHostReady(prefs, "github"),
    codeHostReady(prefs, "gitlab"),
    codeHostReady(prefs, "bitbucket")
  ].filter(Boolean).length;
  const collaborationReady = [
    integrationReady(prefs, "slack"),
    integrationReady(prefs, "jira"),
    integrationReady(prefs, "teams"),
    integrationReady(prefs, "confluence"),
    integrationReady(prefs, "notion"),
    integrationReady(prefs, "google-docs")
  ].filter(Boolean).length;
  const ready = codeHostsReady + collaborationReady;
  const total = 9;

  // One code host is enough for setup — do not imply 9/9 is required.
  if (codeHostsReady === 0) {
    if (ready === 0) {
      return "No tools ready yet";
    }
    return `${ready} ready · connect a code host`;
  }
  if (ready === total) {
    return "All tools ready";
  }
  return `Ready · ${ready} of ${total} connected`;
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

export function displayPlanLabel(
  prefs: Pick<{ plan?: "free" | "pro" | "enterprise"; usageTier?: "pro" | "pro_plus" | "max" | null }, "plan" | "usageTier">
): string {
  if (prefs.plan === "enterprise") {
    return "Enterprise";
  }
  if (prefs.usageTier === "pro_plus") {
    return "Pro+";
  }
  if (prefs.usageTier === "max") {
    return "Max";
  }
  switch (prefs.plan) {
    case "pro":
      return "Pro";
    case "free":
      return "Free";
    default:
      return "";
  }
}

export function preferencesSignedIn(prefs: Pick<Preferences, "isSignedIn" | "hasApiKey">): boolean {
  return prefs.isSignedIn ?? prefs.hasApiKey;
}

export function isPlanAdminRole(role?: string): boolean {
  const normalized = String(role ?? "").toLowerCase();
  return normalized === "admin" || normalized === "owner";
}

export type PlanSeatUpgradeCta =
  | { kind: "pending"; toLabel: string }
  | { kind: "admin-convert"; nextTier: "pro_plus" | "max"; nextLabel: string }
  | { kind: "member-request"; nextTier: "pro_plus" | "max"; nextLabel: string }
  | { kind: "none" };

export function planSeatUpgradeCta(prefs: Preferences): PlanSeatUpgradeCta {
  if (prefs.plan !== "pro") {
    return { kind: "none" };
  }
  const pending = prefs.pendingSeatUpgrade;
  if (pending) {
    return { kind: "pending", toLabel: pending.toTier === "max" ? "Max" : "Pro+" };
  }
  const next = prefs.usageMeters?.nextTier;
  if (next !== "pro_plus" && next !== "max") {
    return { kind: "none" };
  }
  const nextLabel = prefs.usageMeters?.nextTierName ?? (next === "max" ? "Max" : "Pro+");
  if (isPlanAdminRole(prefs.userRole)) {
    return { kind: "admin-convert", nextTier: next, nextLabel };
  }
  return { kind: "member-request", nextTier: next, nextLabel };
}

export function planAdminPortalHref(prefs: Preferences): string {
  const base = (prefs.adminPortalUrl ?? "https://admin.coop-ai.dev").replace(/\/$/, "");
  if (isPlanAdminRole(prefs.userRole) && (prefs.incomingSeatUpgradeRequests?.length ?? 0) > 0) {
    return `${base}/requests`;
  }
  return base;
}

export function incomingSeatUpgradeCopy(prefs: Preferences): {
  count: number;
  newestEmail?: string;
  toLabel: string;
} | null {
  const incoming = prefs.incomingSeatUpgradeRequests ?? [];
  if (!isPlanAdminRole(prefs.userRole) || incoming.length === 0) {
    return null;
  }
  const newest = incoming[incoming.length - 1];
  const toLabel = newest?.toTier === "max" ? "Max" : "Pro+";
  return {
    count: incoming.length,
    newestEmail: newest?.memberEmail,
    toLabel
  };
}

export function displayIdentitySubtitle(prefs: Preferences): string | undefined {
  if (!preferencesSignedIn(prefs)) {
    return undefined;
  }
  const orgName = displayOrgName(prefs);
  const plan = displayPlanLabel(prefs);
  if (orgName && plan) {
    return `${orgName} · ${plan}`;
  }
  return orgName ?? (plan || undefined);
}

export function accountHubSubtitle(prefs: Preferences): string {
  if (!preferencesSignedIn(prefs)) {
    return "Not signed in";
  }
  const email = prefs.userEmail?.trim();
  if (email) {
    return `Signed in · ${email}`;
  }
  return "Signed in";
}

export function formatQuotaUsageSummary(
  quota: {
    usedCredits: number;
    limitCredits: number;
    remainingCredits: number;
    windowHours: number;
  },
  options?: { exhausted?: boolean }
): string {
  const used = quota.usedCredits ?? Math.max(0, quota.limitCredits - quota.remainingCredits);
  const counts = `${used}K of ${quota.limitCredits}K AI credits used`;
  if (options?.exhausted) {
    return counts;
  }
  return `${counts} - ${quota.windowHours}-hour rolling window`;
}

export function quotaUsedPercent(used: number, limit: number): number {
  if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round((used / limit) * 100)));
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
  if (prefs.usageMeters) {
    const usedRatio =
      typeof prefs.usageMeters.usedRatio === "number"
        ? prefs.usageMeters.usedRatio
        : prefs.usageMeters.auto.usedRatio + prefs.usageMeters.frontier.usedRatio;
    const pct = Math.round(Math.max(0, Math.min(1, usedRatio)) * 100);
    return `${plan} · ${pct}% used`;
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

export function preferencesHubSubtitle(_prefs: Preferences, _pinnedCount: number): string {
  return "Model & chat · Prompt Library";
}

export function integrationDisplayName(provider: IntegrationProvider): string {
  return INTEGRATION_NAMES[provider];
}

export function codeHostDisplayName(provider: CodeHostProvider): string {
  return CODE_HOST_NAMES[provider];
}
