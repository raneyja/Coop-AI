import type { IntegrationChatProvider } from "../chat/types";
import {
  appendMentionScopePromptSection,
  OUT_OF_SCOPE_MENTIONS_SYSTEM_RULE,
  partitionMentionsForQuickAction,
  type MentionScopeRef
} from "./mentionScope";
import {
  integrationSourceLabel,
  listIntegrationSourceLabels,
  listIntegrationSourcesChecklist
} from "./integrationSourceLabels";
import {
  appendCitationKeysSection,
  appendEvidenceQualityInstructions,
  appendSourcesChecklistSection,
  appendSupplementarySourceCitationGuardrails,
  appendUserFocusInstructions,
  supplementaryKeysOmittedFromChecklist,
  truncationNote,
  EVIDENCE_CITATION_RULES
} from "./evidenceSynthesis";

export const INTEGRATION_EVIDENCE_SYSTEM = `You are CoopAI answering from a single primary integration source attached in the evidence card.
Prioritize the attached search results. Cite specific messages, tickets, or pages by title/key.
If search returned no results or an error, say so clearly under **Sources**.
Do not search, cite, or summarize repository files, marketing demo stories, or invented code. If the integration has no relevant hits, say that — do not fall back to a repo explain.
${OUT_OF_SCOPE_MENTIONS_SYSTEM_RULE}

${EVIDENCE_CITATION_RULES}`;

export type IntegrationSynthesisInput = {
  provider: IntegrationChatProvider;
  evidence: Record<string, unknown>;
  owner?: string;
  repo?: string;
  file?: string;
  userQuestion: string;
  /** Specific ask after a slash command / custom prompt — requires **Your question**. */
  userFocus?: string;
  mentionedFiles?: MentionScopeRef[];
  activeRepoId?: string;
};

export function buildIntegrationSynthesisUserPrompt(input: IntegrationSynthesisInput): string {
  const lines: string[] = [];
  const docsOnly = input.provider === "google-docs";
  lines.push("## Task");
  if (docsOnly) {
    lines.push(
      "Answer from attached Google Docs titles only. Do not name repository files or invent code paths (.ts, .js, .py, .go)."
    );
    lines.push(`User ask: ${input.userQuestion.trim()}`);
    lines.push(
      "If the attached titles do not answer the ask, say the attached Google Docs do not cover it and list those titles. Never explain repository middleware from training or Use-repo identity."
    );
  } else {
    lines.push(input.userQuestion.trim());
  }
  lines.push("");
  appendUserFocusInstructions(lines, input.userFocus);
  if (docsOnly) {
    lines.push(
      "## Scope\n- Google Docs slash. Use-repo may have seeded the search query — it is not code to explain."
    );
    lines.push("");
  } else if (input.owner && input.repo) {
    lines.push(`## Scope\n- Repository: ${input.owner}/${input.repo}`);
    if (input.file) lines.push(`- Active file: ${input.file}`);
    appendMentionScopeSection(lines, input);
    lines.push("");
  }
  lines.push("## Evidence bundle");
  lines.push(formatIntegrationEvidenceForPrompt(input.provider, input.evidence));
  lines.push("");

  const searchQuery = typeof input.evidence.query === "string" ? input.evidence.query.trim() : "";
  if (searchQuery) {
    lines.push("## Search context");
    lines.push(`- Query: ${searchQuery}`);
    lines.push("");
  }

  const error = input.evidence.error as string | undefined;
  const resultCount = countIntegrationResults(input.provider, input.evidence);
  appendCitationKeysSection(lines, listIntegrationSourceLabels(input.provider));
  const citationKeys = listIntegrationSourceLabels(input.provider);
  const sourcesChecklist = listIntegrationSourcesChecklist(input.provider, { error, resultCount });
  appendSourcesChecklistSection(lines, sourcesChecklist);
  appendSupplementarySourceCitationGuardrails(
    lines,
    sourcesChecklist,
    supplementaryKeysOmittedFromChecklist(citationKeys, sourcesChecklist)
  );
  appendEvidenceQualityInstructions(lines);
  lines.push("Synthesize from integration evidence only. Out-of-scope @ paths must not replace the integration search results.");
  lines.push("Include a **Sources** section matching the checklist.");
  return lines.join("\n");
}

function appendMentionScopeSection(lines: string[], input: IntegrationSynthesisInput): void {
  if (!input.mentionedFiles?.length || !input.owner || !input.repo) {
    return;
  }
  const targetLabel = `${input.owner}/${input.repo}`;
  const scope = partitionMentionsForQuickAction("integration", input.mentionedFiles, {
    activeRepoId: input.activeRepoId,
    owner: input.owner,
    repo: input.repo
  });
  appendMentionScopePromptSection(lines, {
    targetLabel,
    scope,
    inScopeInstruction: "may add repo context alongside the integration search",
    excludeFromLabel: "Summary / Key findings",
    alternateActionLabel: "Understand Repo"
  });
}

/** Hit count for a single-integration evidence blob (issues / messages / pages / documents). */
export function countIntegrationResults(
  provider: IntegrationChatProvider,
  evidence: Record<string, unknown>
): number {
  switch (provider) {
    case "jira":
      return Array.isArray(evidence.issues) ? evidence.issues.length : 0;
    case "slack":
    case "teams":
      return Array.isArray(evidence.messages) ? evidence.messages.length : 0;
    case "confluence":
    case "notion":
      return Array.isArray(evidence.pages) ? evidence.pages.length : 0;
    case "google-docs":
      return Array.isArray(evidence.documents) ? evidence.documents.length : 0;
    default:
      return 0;
  }
}

/** Canned slash reply when the named tool returned nothing — never invent repo code. */
export function emptyIntegrationSlashResponse(
  provider: IntegrationChatProvider,
  evidence?: Record<string, unknown>
): string {
  const error = typeof evidence?.error === "string" ? evidence.error.trim() : "";
  if (provider === "google-docs") {
    return error
      ? `Google Docs search failed (${error}). /docs searches Google Docs only — not the repository.`
      : "Google Docs has no documents matching this ask. /docs searches Google Docs only — not the repository.";
  }
  const label =
    provider === "jira"
      ? "Jira"
      : provider === "slack"
        ? "Slack"
        : provider === "teams"
          ? "Microsoft Teams"
          : provider === "confluence"
            ? "Confluence"
            : provider === "notion"
              ? "Notion"
              : provider;
  return error
    ? `${label} search failed (${error}). This command does not search the repository.`
    : `${label} returned no matching results. This command does not search the repository.`;
}

const INVENTED_REPO_FILE =
  /(?:^|[\s`'(])((?:[\w.-]+\/)+[\w.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|rb))\b/gi;

/** True when a /docs answer named a repo path that is not in an attached Doc title. */
export function googleDocsSlashLeaksRepoCode(content: string, documentTitles: string[]): boolean {
  const allowed = documentTitles.join("\n").toLowerCase();
  for (const match of content.matchAll(INVENTED_REPO_FILE)) {
    const path = (match[1] ?? "").toLowerCase();
    if (path && !allowed.includes(path)) {
      return true;
    }
  }
  return false;
}

/** Replace a /docs answer that invented repo files with titles-only honesty. */
export function rewriteGoogleDocsSlashIfRepoLeak(content: string, documentTitles: string[]): string {
  if (!googleDocsSlashLeaksRepoCode(content, documentTitles)) {
    return content;
  }
  const titles = documentTitles.map((title) => title.trim()).filter(Boolean).slice(0, 10);
  const list = titles.length
    ? titles.map((title) => `- ${title}`).join("\n")
    : "- (no document titles were attached)";
  return [
    "The attached Google Docs do not describe that in repository code. /docs searches Google Docs only — not the repository.",
    "",
    "Docs returned:",
    list
  ].join("\n");
}

function formatIntegrationEvidenceForPrompt(
  provider: IntegrationChatProvider,
  evidence: Record<string, unknown>
): string {
  const label = integrationSourceLabel(provider);
  if (evidence.error) {
    return `### ${label}\n- Error: ${String(evidence.error)}`;
  }
  switch (provider) {
    case "jira": {
      const issues = (evidence.issues as Array<Record<string, unknown>>) ?? [];
      return (
        `### ${label}\n` +
        (issues.length
          ? issues
              .slice(0, 20)
              .map(
                (issue) =>
                  `- ${String(issue.key)} (${String(issue.status)}): ${String(issue.summary ?? "")}`
              )
              .join("\n") + truncationNote(issues.length, 20)
          : "- No issues found")
      );
    }
    case "slack": {
      const messages = (evidence.messages as Array<Record<string, unknown>>) ?? [];
      return (
        `### ${label}\n` +
        (messages.length
          ? messages
              .slice(0, 20)
              .map(
                (message) =>
                  `- ${String(message.channelName ?? message.fromUserName ?? "unknown")}: ${String(message.text ?? "").slice(0, 200)}`
              )
              .join("\n") + truncationNote(messages.length, 20)
          : "- No messages found")
      );
    }
    case "teams": {
      const messages = (evidence.messages as Array<Record<string, unknown>>) ?? [];
      return (
        `### ${label}\n` +
        (messages.length
          ? messages
              .slice(0, 20)
              .map(
                (message) =>
                  `- ${String(message.fromUserName ?? "unknown")}: ${String(message.body ?? message.text ?? "").slice(0, 200)}`
              )
              .join("\n") + truncationNote(messages.length, 20)
          : "- No messages found")
      );
    }
    case "confluence":
    case "notion": {
      const pages = (evidence.pages as Array<Record<string, unknown>>) ?? [];
      return (
        `### ${label}\n` +
        (pages.length
          ? pages
              .slice(0, 20)
              .map((page) => {
                const title = String(page.title);
                const excerpt = page.excerpt ? `: ${String(page.excerpt).slice(0, 120)}` : "";
                const htmlUrl = page.htmlUrl ? String(page.htmlUrl) : undefined;
                return htmlUrl ? `- [${title}](${htmlUrl})${excerpt}` : `- ${title}${excerpt}`;
              })
              .join("\n") + truncationNote(pages.length, 20)
          : "- No pages found")
      );
    }
    case "google-docs": {
      const documents = (evidence.documents as Array<Record<string, unknown>>) ?? [];
      return (
        `### ${label}\n` +
        (documents.length
          ? documents.slice(0, 20).map((doc) => `- ${String(doc.title)}`).join("\n") +
            truncationNote(documents.length, 20)
          : "- No documents found")
      );
    }
    default:
      return `### ${label}\n- (no structured evidence)`;
  }
}
