import {
  CODE_HOST_PROVIDERS,
  isCodeHostProvider,
  type CodeHostProvider
} from "../api/codeHosts/types";
import type { OrgIntegrationStatusEntry } from "../chat/integrationStatusTypes";
import type { IntegrationStatus } from "../integrations/healthMonitor";

/**
 * Prefs shape used to decide "connected for quick actions."
 * Mirrors Settings Ready sources without importing webview modules.
 */
export type CodeHostConnectionPrefs = {
  orgIntegrationStatuses?: OrgIntegrationStatusEntry[];
  hasGitHubAppInstalled?: boolean;
  hasGitLabAppInstalled?: boolean;
  hasBitbucketAppInstalled?: boolean;
};

export type DeepIndexStatusLike = {
  status?: string;
  enabled?: boolean;
};

/**
 * Deep-Indexed for quick actions = picker "Indexed": indexStatus === "ready".
 * Do not require lightningEnabled — Ready-but-not-enabled still means the
 * Use-repo index is usable for chat/QA evidence.
 */
export function isDeepIndexedForQuickActions(status: DeepIndexStatusLike | undefined | null): boolean {
  return status?.status === "ready";
}

/**
 * Settings-equivalent connected hosts: orgIntegrationStatuses Ready/installed
 * OR has*AppInstalled. Union — never AppInstalled alone as the only path.
 * needsReconnect / scopeNeedsReconnect on an org entry still blocks that org path
 * (matches codeHostReady), but AppInstalled can still promote.
 */
export function connectedCodeHostsFromPrefs(prefs: CodeHostConnectionPrefs): Set<CodeHostProvider> {
  const connected = new Set<CodeHostProvider>();
  for (const host of CODE_HOST_PROVIDERS) {
    if (isHostConnectedForQuickActions(prefs, host)) {
      connected.add(host);
    }
  }
  return connected;
}

export function isHostConnectedForQuickActions(
  prefs: CodeHostConnectionPrefs,
  host: CodeHostProvider
): boolean {
  const entry = prefs.orgIntegrationStatuses?.find((item) => item.provider === host);
  if (entry?.installed && !entry.needsReconnect && !entry.scopeNeedsReconnect) {
    return true;
  }
  if (host === "github" && prefs.hasGitHubAppInstalled) {
    return true;
  }
  if (host === "gitlab" && prefs.hasGitLabAppInstalled) {
    return true;
  }
  if (host === "bitbucket" && prefs.hasBitbucketAppInstalled) {
    return true;
  }
  return false;
}

/**
 * Online for quick actions if the live probe is not offline, OR the host is
 * Settings-connected, OR the active Use-repo on that host is Deep-Indexed.
 */
export function isCodeHostOnlineForQuickActions(
  host: CodeHostProvider,
  options: {
    probeStatus?: IntegrationStatus;
    connectedHosts: ReadonlySet<CodeHostProvider>;
    indexedHosts: ReadonlySet<CodeHostProvider>;
  }
): boolean {
  if (options.probeStatus === "healthy" || options.probeStatus === "degraded") {
    return true;
  }
  return options.connectedHosts.has(host) || options.indexedHosts.has(host);
}

/**
 * Candidate repo ids for index-status lookup: request id first, then built id,
 * then workspace list matches (case-insensitive). Request host wins.
 */
export function repoIdCandidatesForIndexStatus(options: {
  codeHost: CodeHostProvider;
  requestRepoId?: string;
  owner?: string;
  repo?: string;
  workspaceRepoIds?: readonly string[];
}): string[] {
  const { codeHost, owner, repo, workspaceRepoIds } = options;
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (value: string | undefined) => {
    const trimmed = value?.trim();
    if (!trimmed || seen.has(trimmed)) {
      return;
    }
    seen.add(trimmed);
    out.push(trimmed);
  };

  const requestRepoId = options.requestRepoId?.trim();
  if (requestRepoId) {
    const lower = requestRepoId.toLowerCase();
    if (lower.startsWith(`${codeHost}:`)) {
      push(requestRepoId);
    }
  }

  if (owner?.trim() && repo?.trim()) {
    push(`${codeHost}:${owner.trim()}/${repo.trim()}`);
  }

  if (workspaceRepoIds?.length) {
    for (const candidate of out.slice()) {
      const needle = candidate.toLowerCase();
      for (const workspaceId of workspaceRepoIds) {
        if (workspaceId.toLowerCase() === needle) {
          push(workspaceId);
        }
      }
    }
    // Also accept workspace ids for this host whose owner/repo match ignoring case.
    if (owner?.trim() && repo?.trim()) {
      const suffix = `${owner.trim()}/${repo.trim()}`.toLowerCase();
      for (const workspaceId of workspaceRepoIds) {
        const lower = workspaceId.toLowerCase();
        if (lower.startsWith(`${codeHost}:`) && lower.endsWith(suffix)) {
          push(workspaceId);
        }
      }
    }
  }

  return out;
}

export function indexedHostsFromReadyProvider(
  provider: CodeHostProvider | undefined,
  indexReady: boolean
): Set<CodeHostProvider> {
  const hosts = new Set<CodeHostProvider>();
  if (indexReady && isCodeHostProvider(provider)) {
    hosts.add(provider);
  }
  return hosts;
}
