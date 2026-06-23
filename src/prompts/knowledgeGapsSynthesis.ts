import type {
  ConfluenceSearchEvidence,
  GoogleDocsSearchEvidence,
  JiraSearchEvidence,
  KnowledgeGapsEvidence,
  NotionSearchEvidence,
  SlackSearchEvidence,
  TeamsSearchEvidence
} from "../context/contextBundleEvidence";
import {
  appendCitationKeysSection,
  appendEvidenceQualityInstructions,
  appendSourcesChecklistSection,
  EVIDENCE_CITATION_RULES
} from "./evidenceSynthesis";
import {
  appendMentionScopePromptSection,
  OUT_OF_SCOPE_MENTIONS_SYSTEM_RULE,
  partitionMentionsForQuickAction,
  type MentionScopeRef
} from "./mentionScope";
import {
  knowledgeGapsSourceLabelConfluence,
  knowledgeGapsSourceLabelDependencies,
  knowledgeGapsSourceLabelJira,
  knowledgeGapsSourceLabelNotion,
  knowledgeGapsSourceLabelGoogleDocs,
  knowledgeGapsSourceLabelOwnership,
  knowledgeGapsSourceLabelScan,
  knowledgeGapsSourceLabelSlack,
  knowledgeGapsSourceLabelTeams,
  listKnowledgeGapsSourceLabels,
  listKnowledgeGapsSourcesChecklist
} from "./knowledgeGapsSourceLabels";
import { ownershipTierLabel } from "./ownershipSourceLabels";

export const KNOWLEDGE_GAPS_EVIDENCE_SYSTEM = `You audit engineering health: missing docs, orphaned code, unclear ownership, and open questions.
List what is unknown and what evidence would reduce risk.
Only cite documentation gaps that appear in the knowledge gap scan bundle or Confluence/Jira/Slack evidence — never invent gap titles from reading source code.
When no knowledge gap scan is attached, say scan evidence is unavailable and omit invented Documentation gaps subsections.
The primary audit target is stated in ## Task (a file path or repository-wide scope) — do not center the audit on out-of-scope @ attachments.
For enterprise readiness, evaluate: runbooks/on-call docs for operational areas, ownership clarity for change approval (CODEOWNERS + commit history), integration configuration documentation, and deployment/CI coverage — cite only what appears in the bundle.
${OUT_OF_SCOPE_MENTIONS_SYSTEM_RULE}

${EVIDENCE_CITATION_RULES}`;

export type KnowledgeGapsSynthesisInput = {
  evidence: KnowledgeGapsEvidence;
  confluence?: ConfluenceSearchEvidence;
  jira?: JiraSearchEvidence;
  slack?: SlackSearchEvidence;
  notion?: NotionSearchEvidence;
  googleDocs?: GoogleDocsSearchEvidence;
  teams?: TeamsSearchEvidence;
  file?: string;
  owner?: string;
  repo?: string;
  userQuestion?: string;
  mentionedFiles?: MentionScopeRef[];
  activeRepoId?: string;
};

export function buildKnowledgeGapsSynthesisUserPrompt(input: KnowledgeGapsSynthesisInput): string {
  const repoWide = !input.file?.trim() && Boolean(input.owner?.trim() && input.repo?.trim());
  const lines: string[] = [];
  lines.push("## Task");
  lines.push(
    input.userQuestion?.trim() ||
      (repoWide
        ? `Audit knowledge gaps across ${input.owner}/${input.repo}: missing docs, unclear ownership, and open questions.`
        : `Audit knowledge gaps for ${input.file ?? "this area"}: missing docs, unclear ownership, and open questions.`)
  );
  lines.push("");
  if (repoWide) {
    lines.push("## Primary target");
    lines.push(`- Repository: ${input.owner}/${input.repo}`);
    appendMentionScopeSection(lines, input);
    lines.push("");
  } else if (input.file) {
    lines.push("## Primary target");
    lines.push(`- File: ${input.file}`);
    if (input.owner && input.repo) {
      lines.push(`- Repository: ${input.owner}/${input.repo}`);
    }
    appendMentionScopeSection(lines, input);
    lines.push("");
  }
  lines.push("## Evidence bundle");
  lines.push(formatKnowledgeGapsForPrompt(
    input.evidence,
    input.confluence,
    input.jira,
    input.slack,
    input.notion,
    input.googleDocs,
    input.teams,
    input.file,
    input.owner,
    input.repo
  ));
  lines.push("");
  appendCitationKeysSection(
    lines,
    listKnowledgeGapsSourceLabels(
      input.evidence,
      input.confluence,
      input.jira,
      input.slack,
      input.notion,
      input.googleDocs,
      input.teams
    )
  );
  appendSourcesChecklistSection(
    lines,
    listKnowledgeGapsSourcesChecklist(
      input.evidence,
      input.confluence,
      input.jira,
      input.slack,
      input.notion,
      input.googleDocs,
      input.teams
    )
  );
  appendEvidenceQualityInstructions(lines);
  appendKnowledgeGapsEnrichmentInstructions(lines);
  lines.push(
    repoWide
      ? "Synthesize repository-wide blind spots from the evidence bundle — prioritize missing docs, unclear ownership, and orphaned areas across the repo."
      : "Synthesize gaps for the primary target file only. Out-of-scope @ paths must not replace the audit for the open file."
  );
  lines.push("Follow the required response structure in your system instructions.");
  return lines.join("\n");
}

function appendKnowledgeGapsEnrichmentInstructions(lines: string[]): void {
  lines.push("## Knowledge gaps enrichment");
  lines.push(
    "- Prioritize gaps that block safe changes: missing runbooks, unclear ownership for change approval, undocumented integration config."
  );
  lines.push(
    "- When Confluence/Jira evidence is present, cross-reference page titles and ticket statuses to scan gaps — do not duplicate or invent gap titles."
  );
  lines.push(
    "- When ownershipReport is present, flag paths with no primary owner or stale commit activity as maintenance risks."
  );
  lines.push(
    "- When jobScan is missing, state scan evidence is unavailable — do not infer Documentation gaps from code inspection."
  );
  lines.push("");
}

function appendMentionScopeSection(lines: string[], input: KnowledgeGapsSynthesisInput): void {
  if (!input.mentionedFiles?.length) {
    return;
  }
  const targetLabel =
    input.owner && input.repo ? `${input.owner}/${input.repo}` : input.file ?? "this area";
  const scope = partitionMentionsForQuickAction("knowledge-gaps", input.mentionedFiles, {
    activeRepoId: input.activeRepoId,
    owner: input.owner,
    repo: input.repo
  });
  appendMentionScopePromptSection(lines, {
    targetLabel,
    scope,
    inScopeInstruction: "may audit documentation and ownership gaps for these in-repo paths",
    excludeFromLabel: "Documentation gaps / Ownership & maintenance",
    alternateActionLabel: "Knowledge Gaps"
  });
}

function formatKnowledgeGapsForPrompt(
  evidence: KnowledgeGapsEvidence,
  confluence: ConfluenceSearchEvidence | undefined,
  jira: JiraSearchEvidence | undefined,
  slack: SlackSearchEvidence | undefined,
  notion: NotionSearchEvidence | undefined,
  googleDocs: GoogleDocsSearchEvidence | undefined,
  teams: TeamsSearchEvidence | undefined,
  file: string | undefined,
  owner?: string,
  repo?: string
): string {
  const sections: string[] = [];
  if (file) {
    sections.push(`### Scope\n- File: ${file}`);
  } else if (owner && repo) {
    sections.push(`### Scope\n- Repository: ${owner}/${repo}`);
  }
  if (evidence.jobScan) {
    const scan = evidence.jobScan;
    sections.push(
      `### ${knowledgeGapsSourceLabelScan()}\n` +
        `- Found gaps: ${scan.foundGaps ?? scan.gaps?.length ?? 0}\n` +
        `- High / medium / low: ${scan.highPriority ?? 0} / ${scan.mediumPriority ?? 0} / ${scan.lowPriority ?? 0}\n` +
        (scan.gaps?.length
          ? scan.gaps
              .slice(0, 20)
              .map((gap) => `- ${String(gap.type ?? "gap")}: ${String(gap.message ?? gap.summary ?? gap.description ?? gap)}`)
              .join("\n")
          : "- (scan completed with no structured gaps in this pass)")
    );
  } else {
    sections.push(
      `### ${knowledgeGapsSourceLabelScan()}\n` +
        "- No automated knowledge-gap scan attached.\n" +
        "- Do not invent Documentation gaps subsections from code inspection; state that scan evidence is unavailable."
    );
  }
  if (confluence) {
    sections.push(
      `### ${knowledgeGapsSourceLabelConfluence()}\n` +
        (confluence.error
          ? `- Error: ${confluence.error}`
          : confluence.pages?.length
            ? confluence.pages
                .slice(0, 15)
                .map((page) => `- ${page.title}${page.excerpt ? `: ${page.excerpt.slice(0, 120)}` : ""}`)
                .join("\n")
            : "- No matching Confluence pages")
    );
  }
  if (jira) {
    sections.push(
      `### ${knowledgeGapsSourceLabelJira()}\n` +
        (jira.error
          ? `- Error: ${jira.error}`
          : jira.issues?.length
            ? jira.issues
                .slice(0, 15)
                .map((issue) => `- ${issue.key} (${issue.status}): ${issue.summary}`)
                .join("\n")
            : "- No matching Jira issues")
    );
  }
  if (slack) {
    sections.push(
      `### ${knowledgeGapsSourceLabelSlack()}\n` +
        (slack.error
          ? `- Error: ${slack.error}`
          : slack.messages?.length
            ? slack.messages
                .slice(0, 10)
                .map((message) => `- ${message.channelName ? `#${message.channelName}` : "Slack"}: ${message.text.slice(0, 160)}`)
                .join("\n")
            : "- No matching Slack discussions")
    );
  }
  if (notion) {
    sections.push(
      `### ${knowledgeGapsSourceLabelNotion()}\n` +
        (notion.error
          ? `- Error: ${notion.error}`
          : notion.pages?.length
            ? notion.pages
                .slice(0, 15)
                .map((page) => `- ${page.title}`)
                .join("\n")
            : "- No matching Notion pages")
    );
  }
  if (googleDocs) {
    sections.push(
      `### ${knowledgeGapsSourceLabelGoogleDocs()}\n` +
        (googleDocs.error
          ? `- Error: ${googleDocs.error}`
          : googleDocs.documents?.length
            ? googleDocs.documents
                .slice(0, 15)
                .map((doc) => `- ${doc.title}`)
                .join("\n")
            : "- No matching Google Docs")
    );
  }
  if (teams) {
    sections.push(
      `### ${knowledgeGapsSourceLabelTeams()}\n` +
        (teams.error
          ? `- Error: ${teams.error}`
          : teams.messages?.length
            ? teams.messages
                .slice(0, 10)
                .map((message) => `- ${message.fromUserName ?? "Teams"}: ${message.body.slice(0, 160)}`)
                .join("\n")
            : "- No matching Teams discussions")
    );
  }
  if (evidence.ownershipReport) {
    sections.push(
      `### ${knowledgeGapsSourceLabelOwnership()}\n` +
        (evidence.ownershipReport.scores?.length
          ? evidence.ownershipReport.scores
              .slice(0, 8)
              .map(
                (score) =>
                  `- @${score.owner} (${ownershipTierLabel(score.tier)})` +
                  `${score.commitCount ? ` · ${score.commitCount} commits (6mo)` : ""}`
              )
              .join("\n")
          : "- No ownership scores for this path")
    );
  }
  if (evidence.dependencyGraph) {
    const deps = evidence.dependencyGraph.directDependents ?? [];
    sections.push(
      `### ${knowledgeGapsSourceLabelDependencies()}\n` +
        (deps.length
          ? `- Direct dependents (${deps.length}):\n${deps.slice(0, 15).map((dep) => `  - ${dep}`).join("\n")}`
          : `- Indexed edges: ${evidence.dependencyGraph.edgeCount ?? 0} (no direct dependents listed)`)
    );
  }
  if (evidence.warnings?.length) {
    sections.push("### Warnings\n" + evidence.warnings.map((warning) => `- ${warning}`).join("\n"));
  }
  return sections.join("\n\n");
}
