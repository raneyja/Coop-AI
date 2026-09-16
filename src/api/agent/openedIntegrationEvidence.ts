import type { AgentSessionContext } from "./agentTypes";
import { OPENED_ARTIFACT_BODY_CHARS } from "../integrations/integrationHttp";

const MAX_ITEMS = 3;

export type OpenedVendorArtifact = {
  vendor: string;
  title: string;
  url?: string;
  body: string;
};

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

export function listOpenedIntegrationArtifacts(
  context: AgentSessionContext | undefined
): OpenedVendorArtifact[] {
  if (!context) {
    return [];
  }
  const out: OpenedVendorArtifact[] = [];
  for (const issue of asRecords(context.search_jira?.issues)
    .filter((issue) => issue.opened === true || Boolean(asText(issue.description)))
    .slice(0, MAX_ITEMS)) {
    const body = clip(asText(issue.description));
    if (!body) {
      continue;
    }
    out.push({
      vendor: "Jira",
      title: [asText(issue.key), asText(issue.summary)].filter(Boolean).join(" — "),
      url: asText(issue.htmlUrl) || asText(issue.permalink),
      body
    });
  }
  pushDocArtifacts(out, "Confluence", context.search_confluence, "pages");
  pushDocArtifacts(out, "Notion", context.search_notion, "pages");
  pushDocArtifacts(out, "Google Docs", context.search_google_docs, "documents");
  pushDiscussionArtifacts(out, "Slack", context.search_slack, "text");
  pushDiscussionArtifacts(out, "Teams", context.search_teams, "body");
  return out;
}

export function buildInterpretOpenedArtifactPrompt(options: {
  ask: string;
  artifact: OpenedVendorArtifact;
}): string {
  return [
    "In 2–4 sentences, what does this source say about the user's ask?",
    "Quote or paraphrase the body. Teammate English. No tool names, timeouts, HTTP codes, or intern-speak.",
    `Ask: ${options.ask}`,
    `${options.artifact.vendor}: ${options.artifact.title}`,
    options.artifact.url ? `URL: ${options.artifact.url}` : "",
    `Body: ${options.artifact.body}`
  ]
    .filter(Boolean)
    .join("\n");
}

function pushDocArtifacts(
  out: OpenedVendorArtifact[],
  vendor: string,
  payload: Record<string, unknown> | undefined,
  listKey: "pages" | "documents"
): void {
  const opened = asRecords(payload?.[listKey]).filter(
    (page) => page.opened === true || Boolean(asText(page.excerpt))
  );
  for (const page of opened.slice(0, MAX_ITEMS)) {
    const body = clip(asText(page.excerpt));
    if (!body && page.opened !== true) {
      continue;
    }
    out.push({
      vendor,
      title: asText(page.title) || "Untitled",
      url: asText(page.htmlUrl) || asText(page.permalink),
      body
    });
  }
}

function pushDiscussionArtifacts(
  out: OpenedVendorArtifact[],
  vendor: string,
  payload: Record<string, unknown> | undefined,
  bodyKey: "text" | "body"
): void {
  const opened = asRecords(payload?.messages).filter(
    (message) => message.threadOpened === true || message.opened === true
  );
  for (const message of opened.slice(0, MAX_ITEMS)) {
    const body = clip(asText(message[bodyKey]));
    if (!body) {
      continue;
    }
    const channel = asText(message.channelName);
    const user = asText(message.userName) || asText(message.fromUserName);
    out.push({
      vendor,
      title: [channel ? `#${channel}` : "", user ? `@${user}` : ""].filter(Boolean).join(" — ") || vendor,
      url: asText(message.permalink) || asText(message.htmlUrl),
      body
    });
  }
}

function appendJira(lines: string[], payload: Record<string, unknown> | undefined): void {
  const issues = asRecords(payload?.issues)
    .filter((issue) => issue.opened === true || Boolean(asText(issue.description)))
    .slice(0, MAX_ITEMS);
  if (issues.length === 0) {
    return;
  }
  lines.push("Opened Jira tickets. Quote Body when present. If Body is missing, name the ticket and say the full body could not be opened.");
  for (const issue of issues) {
    const key = asText(issue.key) || "unknown";
    const summary = asText(issue.summary);
    const status = asText(issue.status);
    const body = clip(asText(issue.description));
    const meta = [status, summary].filter(Boolean).join(" — ");
    lines.push(meta ? `${key} (${meta})` : key);
    const url = asText(issue.htmlUrl) || asText(issue.permalink);
    if (url) {
      lines.push(url);
    }
    lines.push(body ? `Body: ${body}` : "Body: not attached. Name this ticket anyway.");
  }
}

function appendDocPages(
  lines: string[],
  label: string,
  payload: Record<string, unknown> | undefined,
  listKey: "pages" | "documents"
): void {
  const pages = asRecords(payload?.[listKey]).filter(
    (page) => page.opened === true || Boolean(asText(page.excerpt))
  );
  if (pages.length === 0) {
    return;
  }
  lines.push(
    `Opened ${label} pages. Quote Body when present. If Body is missing, name the page and say the full body could not be opened.`
  );
  for (const page of pages.slice(0, MAX_ITEMS)) {
    const title = asText(page.title) || "Untitled";
    const body = clip(asText(page.excerpt));
    lines.push(title);
    const url = asText(page.htmlUrl) || asText(page.permalink);
    if (url) {
      lines.push(url);
    }
    lines.push(body ? `Body: ${body}` : "Body: not attached. Name this page anyway.");
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
  const messages = asRecords(payload.messages).filter(
    (message) => message.threadOpened === true || message.opened === true
  );
  if (messages.length === 0) {
    if (asRecords(payload.messages).length === 0) {
      lines.push(`${label}: no matching messages. Say “No mention in ${label} of the topic.”`);
    }
    return;
  }
  lines.push(`Opened ${label} threads. Quote Body when the thread or message was opened.`);
  for (const message of messages.slice(0, MAX_ITEMS)) {
    const channel = asText(message.channelName);
    const user = asText(message.userName) || asText(message.fromUserName);
    const meta = [channel ? `#${channel}` : "", user ? `@${user}` : ""].filter(Boolean).join(" — ");
    lines.push(meta || label);
    const url = asText(message.permalink) || asText(message.htmlUrl);
    if (url) {
      lines.push(url);
    }
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
  if (value.length <= OPENED_ARTIFACT_BODY_CHARS) {
    return value;
  }
  return `${value.slice(0, OPENED_ARTIFACT_BODY_CHARS)}…`;
}
