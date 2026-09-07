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
  /** Short query shown in the label (`Searched Confluence for \`plane\``). */
  query?: string;
  /** Expandable hit list / error for the completed trail — not fake thinking. */
  detail?: string;
};

const MAX_HIT_LINES = 5;
const HIT_LINE_CHARS = 96;

export function integrationToolTitle(
  tool: IntegrationActivityTool,
  codeHostProvider: CodeHostProviderPreference = "github"
): string {
  switch (tool) {
    case "confluence":
      return "Confluence";
    case "notion":
      return "Notion";
    case "jira":
      return "Jira";
    case "slack":
      return "Slack";
    case "teams":
      return "Teams";
    case "google-docs":
      return "Google Docs";
    case "code-host":
      switch (codeHostProvider) {
        case "gitlab":
          return "GitLab";
        case "bitbucket":
          return "Bitbucket";
        default:
          return "GitHub";
      }
    default:
      return "integrations";
  }
}

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

/** Live row while a real fetch is in flight. Includes the query when we have one. */
export function integrationRunningActivityLabel(
  tool: IntegrationActivityTool,
  query?: string,
  codeHostProvider: CodeHostProviderPreference = "github"
): string {
  const trimmed = query?.trim();
  if (!trimmed) {
    return integrationActivityLabel(tool, codeHostProvider);
  }
  return `Searching ${integrationToolTitle(tool, codeHostProvider)} for \`${trimmed}\``;
}

/** Durable trail row after a real fetch. Past tense + query — this is what Explored can expand. */
export function integrationCompletedActivityLabel(
  tool: IntegrationActivityTool,
  query?: string,
  codeHostProvider: CodeHostProviderPreference = "github"
): string {
  const title = integrationToolTitle(tool, codeHostProvider);
  const trimmed = query?.trim();
  return trimmed ? `Searched ${title} for \`${trimmed}\`` : `Searched ${title}`;
}

/**
 * Prefer a short repo slug over `owner/repo`, but keep caller extra terms first
 * (Gaps focus phrases, named tickets).
 */
export function preferredIntegrationActivityQuery(terms: string[]): string | undefined {
  const cleaned = terms
    .map((term) => term.trim().replace(/^github:/i, ""))
    .filter(Boolean);
  if (!cleaned.length) {
    return undefined;
  }
  const first = cleaned[0];
  if (first.includes("/")) {
    const slug = first.split("/").pop();
    if (slug && cleaned.includes(slug)) {
      return slug;
    }
  }
  return first;
}

export function formatIntegrationHitDetail(hits: string[], error?: string): string {
  const trimmedError = error?.trim();
  if (trimmedError) {
    return trimmedError;
  }
  const lines = hits.map((hit) => clipHitLine(hit)).filter(Boolean);
  if (!lines.length) {
    return "No matching results";
  }
  return lines.slice(0, MAX_HIT_LINES).join("\n");
}

function clipHitLine(value: string): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (trimmed.length <= HIT_LINE_CHARS) {
    return trimmed;
  }
  return `${trimmed.slice(0, HIT_LINE_CHARS - 1)}…`;
}

/** True for checklist lines that name a real connected tool (not synthesis filler). */
export function isIntegrationActivityLabel(message: string): boolean {
  return (
    /Pulling in Slack messages/i.test(message) ||
    /Searching Teams conversations/i.test(message) ||
    /Reviewing Jira tickets/i.test(message) ||
    /Searching Confluence pages/i.test(message) ||
    /Searching Notion pages/i.test(message) ||
    /^Searching Google Docs…$/i.test(message) ||
    /Searching (GitHub|GitLab|Bitbucket) estate index/i.test(message)
  );
}

/** Planned ellipsis status — live-only, never a durable “Explored N searches” row. */
export function isGenericIntegrationStatusLabel(message: string): boolean {
  return isIntegrationActivityLabel(message);
}

export function stripGenericIntegrationStatus(messages: string[]): string[] {
  return messages.filter((message) => !isGenericIntegrationStatusLabel(message));
}

/** True when this line belongs to `tool` (generic, running, or completed). */
export function isActivityLabelForTool(
  message: string,
  tool: IntegrationActivityTool,
  codeHostProvider: CodeHostProviderPreference = "github"
): boolean {
  const trimmed = message.trim();
  if (!trimmed) {
    return false;
  }
  if (trimmed === integrationActivityLabel(tool, codeHostProvider)) {
    return true;
  }
  if (tool === "code-host") {
    return /^(Searching|Searched) (GitHub|GitLab|Bitbucket)\b/i.test(trimmed);
  }
  const title = integrationToolTitle(tool, codeHostProvider).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`^(Searching|Searched) ${title}\\b`, "i").test(trimmed)) {
    return true;
  }
  if (tool === "jira") {
    return /^(Reviewing|Reviewed) Jira\b/i.test(trimmed);
  }
  if (tool === "slack") {
    return /^(Pulling in|Pulled in) Slack\b/i.test(trimmed);
  }
  return false;
}
