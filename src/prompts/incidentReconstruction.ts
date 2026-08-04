/**
 * Incident / on-call answer assembly — symptoms → code paths → tickets/threads → gaps.
 *
 * Never present a code-only skim as a complete incident answer when integrations
 * were configured: require an explicit integrations section (hits or searched-empty /
 * not-connected).
 */

import {
  isIntegrationConnectedForSources,
  isIntegrationNotConnectedError,
  type IntegrationSearchEvidenceLike
} from "../context/integrationEvidenceVisibility";
import { isIncidentShapedQuery } from "../context/incidentIntent";
import {
  appendCitationKeysSection,
  appendEvidenceQualityInstructions,
  appendSourcesChecklistSection,
  truncationNote
} from "./evidenceSynthesis";

export const INCIDENT_SECTION_SYMPTOMS = "Symptoms";
export const INCIDENT_SECTION_CODE_PATHS = "Code paths";
export const INCIDENT_SECTION_TICKETS_THREADS = "Tickets / threads";
export const INCIDENT_SECTION_GAPS = "Gaps";

export type IncidentIntegrationSnapshot = {
  jira?: IntegrationSearchEvidenceLike | null;
  slack?: IntegrationSearchEvidenceLike | null;
  /** Prefer preference flags when search was skipped (disconnected / budget). */
  jiraConnected?: boolean;
  slackConnected?: boolean;
};

export type IncidentReconstructionInput = {
  userQuestion: string;
  owner?: string;
  repo?: string;
  file?: string;
  integrations: IncidentIntegrationSnapshot;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasSection(content: string, heading: string): boolean {
  return new RegExp(`^\\*\\*${escapeRegExp(heading)}\\*\\*\\s*$`, "im").test(content);
}

function issueCount(evidence: IntegrationSearchEvidenceLike | null | undefined): number {
  return evidence?.issues?.length ?? 0;
}

function messageCount(evidence: IntegrationSearchEvidenceLike | null | undefined): number {
  return evidence?.messages?.length ?? 0;
}

export type IncidentIntegrationStatus =
  | { state: "hits"; count: number; detail: string }
  | { state: "empty"; detail: string }
  | { state: "not_connected"; detail: string }
  | { state: "error"; detail: string }
  | { state: "not_searched"; detail: string };

export function resolveIncidentIntegrationStatus(
  provider: "jira" | "slack",
  evidence: IntegrationSearchEvidenceLike | null | undefined,
  connectedHint?: boolean
): IncidentIntegrationStatus {
  const label = provider === "jira" ? "Jira" : "Slack";
  const count = provider === "jira" ? issueCount(evidence) : messageCount(evidence);

  if (!evidence) {
    if (connectedHint === false) {
      return {
        state: "not_connected",
        detail: `${label} is not connected — ticket/thread search was unavailable for this turn.`
      };
    }
    if (connectedHint === true) {
      return {
        state: "not_searched",
        detail: `${label} is connected but no search result was attached (budget elapsed or fetch skipped). Do not treat this as proof that no ${label.toLowerCase()} activity existed.`
      };
    }
    return {
      state: "not_searched",
      detail: `${label} search was not run for this turn — connection status unknown.`
    };
  }

  const error = evidence.error?.trim();
  if (error && isIntegrationNotConnectedError(error)) {
    return {
      state: "not_connected",
      detail: `${label} is not connected (${error}).`
    };
  }
  if (error) {
    return {
      state: "error",
      detail: `${label} search failed: ${error}. Do not treat this as proof that no incident existed.`
    };
  }

  if (!isIntegrationConnectedForSources(evidence) && connectedHint === false) {
    return {
      state: "not_connected",
      detail: `${label} is not connected — ticket/thread search was unavailable for this turn.`
    };
  }

  if (count > 0) {
    const unit = provider === "jira" ? "issue(s)" : "thread(s)/message(s)";
    return {
      state: "hits",
      count,
      detail: `${label}: ${count} ${unit} in the attached search sample.`
    };
  }

  return {
    state: "empty",
    detail: `Searched ${label}; no matching tickets/threads in the attached sample. Empty search ≠ proof that no incident existed — check other channels, time range, or keys.`
  };
}

/** Build the required Tickets / threads bullets from integration evidence. */
export function buildIncidentTicketsThreadsBullets(
  integrations: IncidentIntegrationSnapshot
): string[] {
  const jira = resolveIncidentIntegrationStatus("jira", integrations.jira, integrations.jiraConnected);
  const slack = resolveIncidentIntegrationStatus("slack", integrations.slack, integrations.slackConnected);
  return [`- ${jira.detail}`, `- ${slack.detail}`];
}

/** Required **Gaps** bullets — always present for incident answers. */
export function buildIncidentGapsBullets(integrations: IncidentIntegrationSnapshot): string[] {
  const jira = resolveIncidentIntegrationStatus("jira", integrations.jira, integrations.jiraConnected);
  const slack = resolveIncidentIntegrationStatus("slack", integrations.slack, integrations.slackConnected);
  const bullets: string[] = [];

  if (jira.state === "empty" || slack.state === "empty") {
    bullets.push(
      "- Integration search returned empty for at least one connected tool — expand time range, try `/jira` / `/slack` with a key or channel, or check ops dashboards."
    );
  }
  if (jira.state === "not_connected" || slack.state === "not_connected") {
    bullets.push(
      "- Connect missing tools in Coop Settings (Jira / Slack) so the next incident ask can pull tickets and threads."
    );
  }
  if (jira.state === "error" || slack.state === "error" || jira.state === "not_searched" || slack.state === "not_searched") {
    bullets.push(
      "- Integration evidence is incomplete this turn — retry while connected, or gather tickets/threads manually."
    );
  }
  if (bullets.length === 0) {
    bullets.push(
      "- Confirm whether attached tickets/threads match the open code path; note any missing owners, runbooks, or dashboards."
    );
  }
  bullets.push(
    "- Still deliver code-path and ops next steps from the attached files — do not stop at “no Jira.”"
  );
  return bullets;
}

export function appendIncidentReconstructionContract(
  lines: string[],
  integrations: IncidentIntegrationSnapshot
): void {
  lines.push("## Required response structure (incident / on-call)");
  lines.push("Use these sections in order (**Title** on its own line; blank line before each):");
  lines.push("");
  lines.push(`**Answer**`);
  lines.push("1-2 sentences: what failed / what the open path does, plus whether tickets/threads were found.");
  lines.push("");
  lines.push(`**${INCIDENT_SECTION_SYMPTOMS}**`);
  lines.push("Observable failure signals from the ask and code (retries, webhook errors, stuck sync).");
  lines.push("");
  lines.push(`**${INCIDENT_SECTION_CODE_PATHS}**`);
  lines.push(
    "Concrete paths/symbols from attached evidence (active Use-repo only). Cite with citation fences when quoting existing code."
  );
  lines.push("");
  lines.push(`**${INCIDENT_SECTION_TICKETS_THREADS}**`);
  lines.push("Required — never omit. Use the integration outcomes below verbatim as bullets (you may add hit titles/keys when present):");
  for (const bullet of buildIncidentTicketsThreadsBullets(integrations)) {
    lines.push(bullet);
  }
  lines.push(
    "PASS: states searched + hits, or searched + empty, or not connected/unavailable. FAIL: code-only skim that implies a full incident reconstruction; claiming “no incident” solely because Jira/Slack was empty."
  );
  lines.push("");
  lines.push(`**${INCIDENT_SECTION_GAPS}**`);
  lines.push("Required — always include. Cover missing tickets/threads, disconnected tools, and ops follow-ups:");
  for (const bullet of buildIncidentGapsBullets(integrations)) {
    lines.push(bullet);
  }
  lines.push("");
  lines.push("**Next steps**");
  lines.push("Actionable code + ops checks (logs, requeue, feature flags, owners) even when integrations are empty.");
  lines.push("");
}

function formatJiraEvidence(evidence: IntegrationSearchEvidenceLike | null | undefined): string {
  if (!evidence) {
    return "- (no Jira block attached)";
  }
  if (evidence.error?.trim()) {
    return `- Error: ${evidence.error.trim()}`;
  }
  const issues = evidence.issues ?? [];
  if (issues.length === 0) {
    return "- <empty> — searched; no issues in sample";
  }
  const lines = issues.slice(0, 8).map((issue) => {
    const row = issue as { key?: string; summary?: string; status?: string };
    const key = row.key?.trim() || "?";
    const summary = row.summary?.trim() || "(no summary)";
    const status = row.status?.trim() ? ` [${row.status.trim()}]` : "";
    return `- ${key}${status}: ${summary}`;
  });
  return lines.join("\n") + truncationNote(issues.length, 8);
}

function formatSlackEvidence(evidence: IntegrationSearchEvidenceLike | null | undefined): string {
  if (!evidence) {
    return "- (no Slack block attached)";
  }
  if (evidence.error?.trim()) {
    return `- Error: ${evidence.error.trim()}`;
  }
  const messages = evidence.messages ?? [];
  if (messages.length === 0) {
    return "- <empty> — searched; no messages in sample";
  }
  const lines = messages.slice(0, 8).map((message) => {
    const row = message as { channelName?: string; text?: string; userName?: string };
    const channel = row.channelName?.trim() ? `#${row.channelName.replace(/^#/, "")}` : "channel?";
    const who = row.userName?.trim() || "someone";
    const text = (row.text ?? "").trim().slice(0, 160);
    return `- ${channel} (${who}): ${text || "(no text)"}`;
  });
  return lines.join("\n") + truncationNote(messages.length, 8);
}

/** User-message synthesis prompt for incident-shaped plain chat. */
export function buildIncidentReconstructionUserPrompt(input: IncidentReconstructionInput): string {
  const lines: string[] = [];
  lines.push("## Task");
  lines.push(input.userQuestion.trim());
  lines.push("");
  lines.push(
    "This ask is incident / on-call shaped. Reconstruct symptoms → code paths → tickets/threads → gaps. Stay on the active Use-repo evidence only."
  );
  lines.push("");
  if (input.owner && input.repo) {
    lines.push("## Scope");
    lines.push(`- Repository: ${input.owner}/${input.repo}`);
    if (input.file) {
      lines.push(`- Active file: ${input.file}`);
    }
    lines.push("");
  }

  lines.push("## Integration search outcomes (authoritative for Tickets / threads)");
  const jiraStatus = resolveIncidentIntegrationStatus(
    "jira",
    input.integrations.jira,
    input.integrations.jiraConnected
  );
  const slackStatus = resolveIncidentIntegrationStatus(
    "slack",
    input.integrations.slack,
    input.integrations.slackConnected
  );
  lines.push(`### Jira — ${jiraStatus.state}`);
  lines.push(jiraStatus.detail);
  lines.push(formatJiraEvidence(input.integrations.jira));
  lines.push("");
  lines.push(`### Slack — ${slackStatus.state}`);
  lines.push(slackStatus.detail);
  lines.push(formatSlackEvidence(input.integrations.slack));
  lines.push("");

  appendIncidentReconstructionContract(lines, input.integrations);
  appendCitationKeysSection(lines, ["[Sources: Code]", "[Sources: Jira]", "[Sources: Slack]"]);
  appendSourcesChecklistSection(lines, [
    "[Sources: Code] — paths/symbols that explain the failure or retry path",
    "[Sources: Jira] — tickets found, or explicit empty / not connected",
    "[Sources: Slack] — threads found, or explicit empty / not connected"
  ]);
  appendEvidenceQualityInstructions(lines);
  lines.push(
    "Never present a code-only skim as a complete incident answer. Empty Jira/Slack means searched-and-empty or not-connected — not “no incident happened.”"
  );
  return lines.join("\n");
}

function insertSectionBeforeSources(content: string, heading: string, body: string): string {
  const block = `\n\n**${heading}**\n${body.trim()}\n`;
  if (hasSection(content, heading)) {
    return content;
  }
  const sourcesIdx = content.search(/\n\*\*Sources\*\*\s*$/im);
  if (sourcesIdx >= 0) {
    return `${content.slice(0, sourcesIdx)}${block}${content.slice(sourcesIdx)}`;
  }
  return `${content.trimEnd()}${block}`;
}

/**
 * Post-process: ensure incident answers always include Code paths, Tickets / threads, and Gaps.
 * Empty integrations still require an explicit gap / tickets section.
 */
export function enrichIncidentReconstructionResponse(
  content: string,
  integrations: IncidentIntegrationSnapshot
): string {
  let result = content.trim();
  if (!result) {
    result = "**Answer**\nIncident reconstruction from attached evidence.";
  }

  if (!hasSection(result, INCIDENT_SECTION_CODE_PATHS)) {
    result = insertSectionBeforeSources(
      result,
      INCIDENT_SECTION_CODE_PATHS,
      "- See attached file and code evidence for the failure / retry path."
    );
  }

  if (!hasSection(result, INCIDENT_SECTION_TICKETS_THREADS)) {
    result = insertSectionBeforeSources(
      result,
      INCIDENT_SECTION_TICKETS_THREADS,
      buildIncidentTicketsThreadsBullets(integrations).join("\n")
    );
  }

  if (!hasSection(result, INCIDENT_SECTION_GAPS)) {
    result = insertSectionBeforeSources(
      result,
      INCIDENT_SECTION_GAPS,
      buildIncidentGapsBullets(integrations).join("\n")
    );
  }

  return result.replace(/\n{3,}/g, "\n\n").trim();
}

/** Extract jira/slack blocks from a context bundle for incident assembly. */
export function incidentIntegrationsFromBundle(
  bundle: unknown,
  connectionHints?: { jiraConnected?: boolean; slackConnected?: boolean }
): IncidentIntegrationSnapshot {
  const entries = Array.isArray(bundle) ? bundle : [];
  let jira: IntegrationSearchEvidenceLike | undefined;
  let slack: IntegrationSearchEvidenceLike | undefined;
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const data = (entry as { data?: Record<string, unknown> }).data;
    if (!data) {
      continue;
    }
    if (!jira && data.jiraSearch && typeof data.jiraSearch === "object") {
      jira = data.jiraSearch as IntegrationSearchEvidenceLike;
    }
    if (!slack && data.slackSearch && typeof data.slackSearch === "object") {
      slack = data.slackSearch as IntegrationSearchEvidenceLike;
    }
  }
  return {
    jira,
    slack,
    jiraConnected: connectionHints?.jiraConnected,
    slackConnected: connectionHints?.slackConnected
  };
}

export { isIncidentShapedQuery };
