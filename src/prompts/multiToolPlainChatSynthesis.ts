/**
 * Multi-tool plain-chat synthesis (Phase 1).
 * Used when the planner selects 2+ tools (or 1 tool without single-provider routing)
 * and we must NOT steal the turn into Jira-only / Slack-only synthesis.
 */
import type { IntegrationChatProvider } from "../chat/types";
import type { IntegrationSearchEvidenceLike } from "../context/integrationEvidenceVisibility";
import {
  appendCitationKeysSection,
  appendEvidenceQualityInstructions,
  appendSourcesChecklistSection
} from "./evidenceSynthesis";

export type MultiToolIntegrationSnapshot = Partial<
  Record<IntegrationChatProvider, IntegrationSearchEvidenceLike | null | undefined>
>;

export type MultiToolPlainChatInput = {
  userQuestion: string;
  owner?: string;
  repo?: string;
  file?: string;
  tools: IntegrationChatProvider[];
  integrations: MultiToolIntegrationSnapshot;
  connected?: Partial<Record<IntegrationChatProvider, boolean>>;
  /** Optional trust status line from the intent planner. */
  statusLine?: string;
};

const TOOL_TITLE: Record<IntegrationChatProvider, string> = {
  jira: "Jira",
  slack: "Slack",
  teams: "Teams",
  confluence: "Confluence",
  notion: "Notion",
  "google-docs": "Google Docs"
};

function hitSummary(
  provider: IntegrationChatProvider,
  evidence: IntegrationSearchEvidenceLike | null | undefined,
  connected?: boolean
): string {
  const label = TOOL_TITLE[provider];
  if (!evidence) {
    if (connected === false) {
      return `${label}: not connected — search skipped.`;
    }
    if (connected === true) {
      return `${label}: connected but no search result attached (budget or skip).`;
    }
    return `${label}: search not run.`;
  }
  if (evidence.error?.trim()) {
    return `${label}: error — ${evidence.error.trim()}`;
  }
  const issues = evidence.issues?.length ?? 0;
  const messages = evidence.messages?.length ?? 0;
  const pages = evidence.pages?.length ?? 0;
  const docs = evidence.documents?.length ?? 0;
  const parts: string[] = [];
  if (issues) {
    parts.push(`${issues} issue(s)`);
  }
  if (messages) {
    parts.push(`${messages} message(s)`);
  }
  if (pages) {
    parts.push(`${pages} page(s)`);
  }
  if (docs) {
    parts.push(`${docs} doc(s)`);
  }
  if (parts.length === 0) {
    return `${label}: searched — no hits.`;
  }
  return `${label}: ${parts.join(", ")}.`;
}

function evidenceBlock(
  provider: IntegrationChatProvider,
  evidence: IntegrationSearchEvidenceLike | null | undefined
): string {
  if (!evidence) {
    return `(no ${TOOL_TITLE[provider]} evidence attached)`;
  }
  const lines: string[] = [];
  if (evidence.error) {
    lines.push(`error: ${evidence.error}`);
  }
  if (provider === "jira") {
    for (const issue of records(evidence.issues).slice(0, 8)) {
      lines.push(`- ${textField(issue, "key", "issue")}: ${textField(issue, "summary")}`.trim());
    }
  } else if (provider === "slack" || provider === "teams") {
    for (const message of records(evidence.messages).slice(0, 8)) {
      const author =
        provider === "slack"
          ? textField(message, "channelName", "thread")
          : textField(message, "fromUserName", "unknown");
      const body =
        provider === "slack"
          ? textField(message, "text")
          : textField(message, "body");
      lines.push(`- ${author}: ${body.slice(0, 240)}`);
    }
  } else if (provider === "confluence" || provider === "notion") {
    for (const page of records(evidence.pages).slice(0, 8)) {
      const url = textField(page, "htmlUrl");
      lines.push(`- ${textField(page, "title", "page")}${url ? ` (${url})` : ""}`);
    }
  } else {
    for (const doc of records(evidence.documents).slice(0, 8)) {
      const url = textField(doc, "htmlUrl");
      lines.push(`- ${textField(doc, "title", "doc")}${url ? ` (${url})` : ""}`);
    }
  }
  return lines.length > 0 ? lines.join("\n") : `(empty ${TOOL_TITLE[provider]} payload)`;
}

function records(items: unknown[] | undefined): Array<Record<string, unknown>> {
  return (items ?? []).filter(
    (item): item is Record<string, unknown> => Boolean(item) && typeof item === "object"
  );
}

function textField(record: Record<string, unknown>, field: string, fallback = ""): string {
  const value = record[field];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export function buildMultiToolPlainChatUserPrompt(input: MultiToolPlainChatInput): string {
  const repo =
    input.owner && input.repo ? `${input.owner}/${input.repo}` : "the active repository";
  const file = input.file?.trim();
  const status = input.statusLine?.trim();

  const summaryLines = input.tools.map((tool) =>
    hitSummary(tool, input.integrations[tool], input.connected?.[tool])
  );

  const evidenceSections = input.tools
    .map((tool) => {
      const title = TOOL_TITLE[tool];
      return [`### ${title}`, evidenceBlock(tool, input.integrations[tool])].join("\n");
    })
    .join("\n\n");

  let prompt = [
    "You are answering a plain-chat question that needs multiple connected tools.",
    "Use the integration evidence below together with repository context.",
    "Do not pretend a tool was searched when the snapshot says it was skipped or disconnected.",
    "Prefer concrete citations (ticket keys, thread links, page titles) when present.",
    "",
    status ? `Intent: ${status}.` : undefined,
    `Repository: ${repo}`,
    file ? `Active file: ${file}` : undefined,
    "",
    "## User question",
    input.userQuestion.trim(),
    "",
    "## Integration search summary",
    ...summaryLines,
    "",
    "## Integration evidence",
    evidenceSections
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");

  prompt = appendSourcesChecklistSection(prompt, {
    includeIntegrations: true,
    includeCode: true
  });
  prompt = appendCitationKeysSection(prompt);
  prompt = appendEvidenceQualityInstructions(prompt);
  return prompt;
}
