import type { CodeHostPullRequestSnippet } from "../context/codeHostContext";

export function assessCompletenessFromSignals(
  directDependents: string[],
  openPullRequests: CodeHostPullRequestSnippet[],
  slackSearch: { messages: unknown[] } | undefined
): "full" | "partial" | "minimal" {
  if (directDependents.length > 0 && (openPullRequests.length > 0 || (slackSearch?.messages.length ?? 0) > 0)) {
    return "full";
  }
  if (directDependents.length > 0 || openPullRequests.length > 0 || (slackSearch?.messages.length ?? 0) > 0) {
    return "partial";
  }
  return "minimal";
}
