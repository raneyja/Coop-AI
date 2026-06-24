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
  appendEvidenceEnrichmentInstructions,
  appendEvidenceQualityInstructions,
  appendSourcesChecklistSection,
  appendSupplementarySourceCitationGuardrails,
  appendNarrativeCitationInstructions,
  supplementaryKeysOmittedFromChecklist,
  EVIDENCE_CITATION_RULES
} from "./evidenceSynthesis";

export const INTEGRATION_EVIDENCE_SYSTEM = `You are CoopAI answering from a single primary integration source attached in the evidence card.
Prioritize the attached search results. Cite specific messages, tickets, or pages by title/key.
If search returned no results or an error, say so clearly under **Sources**.
${OUT_OF_SCOPE_MENTIONS_SYSTEM_RULE}

${EVIDENCE_CITATION_RULES}`;

export type IntegrationSynthesisInput = {
  provider: IntegrationChatProvider;
  evidence: Record<string, unknown>;
  owner?: string;
  repo?: string;
  file?: string;
  userQuestion: string;
  mentionedFiles?: MentionScopeRef[];
  activeRepoId?: string;
};

export function buildIntegrationSynthesisUserPrompt(input: IntegrationSynthesisInput): string {
  const lines: string[] = [];
  lines.push("## Task");
  lines.push(input.userQuestion.trim());
  lines.push("");
  if (input.owner && input.repo) {
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
  appendNarrativeCitationInstructions(lines);
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

function countIntegrationResults(provider: IntegrationChatProvider, evidence: Record<string, unknown>): number {
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
              .join("\n")
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
              .join("\n")
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
              .join("\n")
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
              .join("\n")
          : "- No pages found")
      );
    }
    case "google-docs": {
      const documents = (evidence.documents as Array<Record<string, unknown>>) ?? [];
      return (
        `### ${label}\n` +
        (documents.length
          ? documents.slice(0, 20).map((doc) => `- ${String(doc.title)}`).join("\n")
          : "- No documents found")
      );
    }
    default:
      return `### ${label}\n- (no structured evidence)`;
  }
}
