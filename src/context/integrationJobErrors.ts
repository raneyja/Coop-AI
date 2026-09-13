/**
 * Cause-correct integration errors. Shared across Slack / Jira / docs / Teams / code-host.
 * Never blame Settings for an empty query, latest-without-scope, or an allowlist block.
 */

export function emptySearchTopicError(toolLabel: string): string {
  return `Need a topic to search ${toolLabel}.`;
}

export function latestNeedsScopeError(resource: string): string {
  return `Coop can only show the latest ${resource} in an allowed scope. Ask an admin to configure that in Coop Admin.`;
}

export function latestUnsupportedError(toolLabel: string): string {
  return `${toolLabel} cannot list latest items yet. Search with a topic instead.`;
}

/** Only when owner/repo are actually missing and the verb needed a repository. */
export function missingRepoSearchError(toolLabel: string): string {
  return `Set a Use-repo to search ${toolLabel} by repository, or set repository owner and repo in Settings.`;
}

export const SETTINGS_REPO_LIE =
  "Set repository owner and repo in Settings";
