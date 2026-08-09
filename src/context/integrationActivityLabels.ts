import type { CodeHostProviderPreference } from "../chat/types";

/** Tools that can appear in the thinking/activity checklist while they run. */
export type IntegrationActivityTool =
  | "confluence"
  | "notion"
  | "jira"
  | "slack"
  | "teams"
  | "google-docs"
  | "code-host";

export type IntegrationToolActivityEvent = {
  tool: IntegrationActivityTool;
  phase: "start" | "done";
  label: string;
};

export function integrationActivityLabel(
  tool: IntegrationActivityTool,
  codeHostProvider: CodeHostProviderPreference = "github"
): string {
  switch (tool) {
    case "confluence":
      return "Searching Confluence pages…";
    case "notion":
      return "Searching Notion pages…";
    case "jira":
      return "Reviewing Jira tickets…";
    case "slack":
      return "Pulling in Slack messages…";
    case "teams":
      return "Searching Teams conversations…";
    case "google-docs":
      return "Searching Google Docs…";
    case "code-host":
      switch (codeHostProvider) {
        case "gitlab":
          return "Searching GitLab estate index…";
        case "bitbucket":
          return "Searching Bitbucket estate index…";
        default:
          return "Searching GitHub estate index…";
      }
    default:
      return "Gathering integration context…";
  }
}

/** True for checklist lines that name a real connected tool (not synthesis filler). */
export function isIntegrationActivityLabel(message: string): boolean {
  return (
    /Pulling in Slack messages/i.test(message) ||
    /Searching Teams conversations/i.test(message) ||
    /Reviewing Jira tickets/i.test(message) ||
    /Searching Confluence pages/i.test(message) ||
    /Searching Notion pages/i.test(message) ||
    /Searching Google Docs/i.test(message) ||
    /Searching (GitHub|GitLab|Bitbucket) estate index/i.test(message)
  );
}
