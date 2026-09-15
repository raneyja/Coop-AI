import type { AgentSessionContext } from "./agentTypes";

const MAX_BODY_CHARS = 1200;
const MAX_ITEMS = 3;

/**
 * Writer-facing opened artifacts. I3 answers from streamAgentAnswer, which
 * does not attach <jira_tickets> XML — title/status in tool JSON is not enough.
 */
export function formatOpenedIntegrationEvidence(
  context: AgentSessionContext | undefined
): string | undefined {
  if (!context) {
    return undefined;
  }
  const lines: string[] = [];
  appendJira(lines, context.search_jira);
  appendDocPages(lines, "Confluence", context.search_confluence, "pages");
  appendDocPages(lines, "Notion", context.search_notion, "pages");
  appendDocPages(lines, "Google Docs", context.search_google_docs, "documents");
  appendDiscussionThreads(lines, "Slack", context.search_slack, "text");
  appendDiscussionThreads(lines, "Teams", context.search_teams, "body");
  return lines.length > 0 ? lines.join("\n") : undefined;
}

function appendJira(lines: string[], payload: Record<string, unknown> | undefined): void {
  const issues = asRecords(payload?.issues).slice(0, MAX_ITEMS);
  if (issues.length === 0) {
    return;
  }
  lines.push(
    "Opened Jira tickets (the Body line is the decision; title and status are not a decision):"
  );
  for (const issue of issues) {
    const key = asText(issue.key) || "unknown";
    const summary = asText(issue.summary);
    const status = asText(issue.status);
    const body = clip(asText(issue.description));
    const meta = [status, summary].filter(Boolean).join(" — ");
    lines.push(meta ? `${key} (${meta})` : key);
    lines.push(body ? `Body: ${body}` : "Body: not attached.");
  }
}

function appendDocPages(
  lines: string[],
  label: string,
  payload: Record<string, unknown> | undefined,
  listKey: "pages" | "documents"
): void {
  const pages = asRecords(payload?.[listKey]).slice(0, MAX_ITEMS);
  if (pages.length === 0) {
    return;
  }
  lines.push(
    `Opened ${label} pages (the Body line is the decision; the title is not a decision):`
  );
  for (const page of pages) {
    const title = asText(page.title) || "Untitled";
    const body = clip(asText(page.excerpt));
    lines.push(title);
    lines.push(body ? `Body: ${body}` : "Body: not attached.");
  }
}

function appendDiscussionThreads(
  lines: string[],
  label: string,
  payload: Record<string, unknown> | undefined,
  bodyKey: "text" | "body"
): void {
  if (!payload) {
    return;
  }
  const messages = asRecords(payload.messages).slice(0, MAX_ITEMS);
  if (messages.length === 0) {
    lines.push(
      `${label}: no matching messages. That is not a documented decision.`
    );
    return;
  }
  lines.push(
    `Opened ${label} threads (the Body line is the decision; the search snippet is not a decision):`
  );
  for (const message of messages) {
    const channel = asText(message.channelName);
    const user = asText(message.userName) || asText(message.fromUserName);
    const meta = [channel ? `#${channel}` : "", user ? `@${user}` : ""].filter(Boolean).join(" — ");
    lines.push(meta || label);
    const opened = message.threadOpened === true;
    const body = clip(asText(message[bodyKey]));
    if (opened && body) {
      lines.push(`Body: ${body}`);
    } else {
      lines.push("Body: not attached.");
    }
  }
}

function asRecords(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object"
  );
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function clip(value: string): string {
  if (value.length <= MAX_BODY_CHARS) {
    return value;
  }
  return `${value.slice(0, MAX_BODY_CHARS)}…`;
}
