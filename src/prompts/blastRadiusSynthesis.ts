import type { BlastRadiusEvidence } from "../context/contextBundleEvidence";
import {
  rankCodeDependentsByRisk,
  asGraphEdgeSource,
  type BlastRadiusDependentDetail
} from "../engines/blastRadiusDependentsFallback";
import {
  appendMentionScopePromptSection,
  OUT_OF_SCOPE_MENTIONS_SYSTEM_RULE,
  partitionMentionsForQuickAction,
  type MentionScopeRef
} from "./mentionScope";
import {
  blastRadiusSourceLabelCiWorkflows,
  blastRadiusSourceLabelCodeowners,
  blastRadiusSourceLabelConfluence,
  blastRadiusSourceLabelCrossRepo,
  blastRadiusSourceLabelDependencies,
  blastRadiusSourceLabelDocsReferences,
  blastRadiusSourceLabelJira,
  blastRadiusSourceLabelLocalFiles,
  blastRadiusSourceLabelOpenPrs,
  blastRadiusSourceLabelPublicApi,
  blastRadiusSourceLabelRecentChanges,
  blastRadiusSourceLabelSlack,
  blastRadiusSourceLabelNotion,
  blastRadiusSourceLabelGoogleDocs,
  blastRadiusSourceLabelTeams,
  blastRadiusSourceLabelTests,
  hasPartialIndexCoverage,
  listBlastRadiusSourceLabels,
  listBlastRadiusSourcesChecklist
} from "./blastRadiusSourceLabels";
import {
  appendCitationKeysSection,
  appendEvidenceQualityInstructions,
  appendSourcesChecklistSection,
  appendSupplementarySourceCitationGuardrails,
  appendNarrativeCitationInstructions,
  supplementaryKeysOmittedFromChecklist,
  EVIDENCE_CITATION_RULES
} from "./evidenceSynthesis";
import { appendIntegrationDocsResponseContract } from "./integrationDocsResponseContract";

export const BLAST_RADIUS_EVIDENCE_SYSTEM = `You analyze change impact from the evidence bundle only — dependents, APIs, integrations, and operational risk.
Gold standard: short and scannable. Prefer bullets over paragraphs. The Sources card already lists files — never re-dump paths in the narrative.
When ## Top risk surfaces is present, those ranked items (≤5) lead **Summary** and are the entire **Direct impact** — do not expand beyond that set.
Code dependents (tests, examples, integration) are the primary blast surface; docs/README/.d.ts hits are secondary — counts only, not full lists.
Mention transitive effects and testing surfaces only when the bundle includes that evidence.
The primary blast-radius target is the open file in ## Task — do not rewrite impact analysis around out-of-scope @ attachments.
Never invent dependents, callers, services, or APIs absent from the bundle. Empty or unverified dependency evidence → say impact was **not found in the index** — never claim the change "will not impact" anything or that "nothing depends on it".
**Hard omit** **Transitive dependents**, **APIs & integrations**, **Operational risk**, and **Testing surfaces** when the bundle has no matching evidence.
${OUT_OF_SCOPE_MENTIONS_SYSTEM_RULE}

${EVIDENCE_CITATION_RULES}`;

export type BlastRadiusSynthesisInput = {
  evidence: BlastRadiusEvidence;
  file: string;
  owner?: string;
  repo?: string;
  userQuestion?: string;
  mentionedFiles?: MentionScopeRef[];
  activeRepoId?: string;
};

export function buildBlastRadiusSynthesisUserPrompt(input: BlastRadiusSynthesisInput): string {
  const { evidence, file, userQuestion } = input;
  const lines: string[] = [];

  lines.push("## Task");
  lines.push(
    userQuestion?.trim() ||
      `Analyze the blast radius of changing ${file}. What breaks, what depends on it, and what should be tested?`
  );
  lines.push("");
  lines.push("## Primary target");
  lines.push(`- File: ${file}`);
  if (input.owner && input.repo) {
    lines.push(`- Repository: ${input.owner}/${input.repo}`);
  }
  appendMentionScopeSection(lines, input);
  lines.push("");
  lines.push("## Evidence bundle");
  lines.push(formatBlastRadiusForPrompt(evidence, file));
  lines.push("");

  appendCitationKeysSection(lines, listBlastRadiusSourceLabels(evidence));
  const sourcesChecklist = listBlastRadiusSourcesChecklist(evidence);
  const citationKeys = listBlastRadiusSourceLabels(evidence);
  appendSourcesChecklistSection(lines, sourcesChecklist);
  appendIntegrationDocsResponseContract(lines, {
    confluencePages: evidence.confluenceSearch?.pages,
    notionPages: evidence.notionSearch?.pages,
    googleDocs: evidence.googleDocsSearch?.documents,
    targetSection: "APIs & integrations"
  });
  appendNarrativeCitationInstructions(lines);
  appendSupplementarySourceCitationGuardrails(
    lines,
    sourcesChecklist,
    supplementaryKeysOmittedFromChecklist(citationKeys, sourcesChecklist)
  );
  appendEvidenceQualityInstructions(lines);
  appendBlastRadiusSummaryGuidance(lines, evidence);
  appendBlastRadiusBrevityGuardrails(lines, evidence);
  lines.push(
    "Synthesize impact for the primary target file only. Out-of-scope @ paths must not replace the dependency evidence for the open file."
  );
  lines.push(
    "Keep the answer short: **Summary** (top risks) → **Direct impact** (same list) → optional evidence-backed sections → **Testing surfaces** (if tests) → **Sources**. Hard omit empty sections. Never invent dependents."
  );
  lines.push("Follow the required response structure in your system instructions.");

  return lines.join("\n");
}

function appendBlastRadiusSummaryGuidance(lines: string[], evidence: BlastRadiusEvidence): void {
  if (!hasPartialIndexCoverage(evidence)) {
    return;
  }
  lines.push("## Summary guidance");
  lines.push(
    "- Open **Summary** with the partial index coverage caveat from `[Sources: Dependency graph]` before impact conclusions or **Top risk surfaces**."
  );
  lines.push(
    "- Lower evidence strength when the dependency graph notes partial index coverage; do not treat listed dependents as exhaustive."
  );
  lines.push("");
}

function appendBlastRadiusBrevityGuardrails(lines: string[], evidence: BlastRadiusEvidence): void {
  lines.push("## Blast brevity (required)");
  lines.push(
    "- Max 2 sentences in **Summary**; **Direct impact** is only the ranked Top risk surfaces (≤5 lines)."
  );
  lines.push(
    "- Hard omit **Transitive dependents**, **APIs & integrations**, **Operational risk**, and **Testing surfaces** when those evidence slices are absent — never invent fillers."
  );
  if (!hasCodeDependentEvidence(evidence)) {
    lines.push(
      "- Dependency evidence is empty/unverified — say impact was **not found in the index**. Do not invent dependents, callers, or zero-impact claims."
    );
  }
  if (evidence.ciWorkflows?.length) {
    lines.push(
      "- CI workflows are attached — put ≤3 short bullets under **Operational risk** (which workflows; what to verify). No deploy essays."
    );
  }
  if (evidence.ownersByFile?.length) {
    lines.push(
      "- CODEOWNERS data is attached — one line in **Summary** or **Operational risk**: notify owners of **Top risk surfaces** before merge."
    );
  }
  if (evidence.testFiles?.length) {
    lines.push("- Test files are attached — list ≤5 under **Testing surfaces**; omit that section if none.");
  } else {
    lines.push("- No test evidence — omit **Testing surfaces** entirely.");
  }
  lines.push("");
}

function hasCodeDependentEvidence(evidence: BlastRadiusEvidence): boolean {
  return Boolean(
    evidence.dependentDetails?.length ||
      evidence.directDependents?.length ||
      evidence.transitiveDependents?.length
  );
}

function appendMentionScopeSection(lines: string[], input: BlastRadiusSynthesisInput): void {
  if (!input.mentionedFiles?.length) {
    return;
  }
  const targetLabel =
    input.owner && input.repo ? `${input.owner}/${input.repo}` : input.file;
  const scope = partitionMentionsForQuickAction("blast-radius", input.mentionedFiles, {
    activeRepoId: input.activeRepoId,
    owner: input.owner,
    repo: input.repo
  });
  appendMentionScopePromptSection(lines, {
    targetLabel,
    scope,
    inScopeInstruction: "may include as additional blast surfaces",
    excludeFromLabel: "Summary / Direct impact / Transitive dependents",
    alternateActionLabel: "Blast Radius"
  });
}

function formatBlastRadiusForPrompt(evidence: BlastRadiusEvidence, file: string): string {
  const sections: string[] = [`### ${blastRadiusSourceLabelDependencies()}`, `- Target file: ${file}`];
  const codeDetails = codeDependentDetailsFromEvidence(evidence);
  const topRisk = rankCodeDependentsByRisk(codeDetails, 5);

  if (topRisk.length > 0) {
    sections.push(
      `### Top risk surfaces (use these first in Summary and Direct impact)\n${topRisk
        .map((entry, index) => `${index + 1}. ${entry.path} — ${entry.riskReason} (${entry.source})`)
        .join("\n")}`
    );
  }

  if (evidence.directDependents?.length) {
    sections.push(
      `- Code dependents (${evidence.directDependents.length}):\n${evidence.directDependents.slice(0, 12).map((dep) => `  - ${dep}`).join("\n")}`
    );
  }
  if (evidence.docsReferences?.length) {
    sections.push(
      `### ${blastRadiusSourceLabelDocsReferences()}\n` +
        evidence.docsReferences
          .slice(0, 10)
          .map((entry) => `- ${entry.path} (${entry.source})`)
          .join("\n")
    );
  }
  if (evidence.transitiveDependents?.length) {
    sections.push(
      `- Transitive dependents (${evidence.transitiveDependents.length}):\n${evidence.transitiveDependents.slice(0, 15).map((dep) => `  - ${dep}`).join("\n")}`
    );
  }
  if (evidence.dependentDetails?.length) {
    sections.push(
      `- Code dependent details:\n${evidence.dependentDetails
        .slice(0, 12)
        .map((entry) => `  - ${entry.path} (depth ${entry.depth}, ${entry.source})`)
        .join("\n")}`
    );
  } else if (!evidence.directDependents?.length && !evidence.transitiveDependents?.length) {
    sections.push("- Impact unverified — no dependents found in index or fallback search.");
  }
  if (evidence.graphMeta) {
    sections.push(
      `- Graph source: ${evidence.graphMeta.source ?? "unknown"} · edges: ${evidence.graphMeta.edgeCount ?? "?"} · lightning: ${evidence.graphMeta.lightningEnabled === false ? "disabled" : "enabled"}`
    );
  }

  if (evidence.testFiles?.length) {
    sections.push(
      `### ${blastRadiusSourceLabelTests()}\n` +
        evidence.testFiles.slice(0, 10).map((entry) => `- ${entry.path} (${entry.source})`).join("\n")
    );
  }

  if (evidence.publicExports?.length) {
    sections.push(
      `### ${blastRadiusSourceLabelPublicApi()}\n` +
        evidence.publicExports
          .slice(0, 10)
          .map((entry) => `- ${entry.symbol} (${entry.kind}, line ${entry.line})`)
          .join("\n")
    );
  }

  if (evidence.recentChanges?.length) {
    sections.push(
      `### ${blastRadiusSourceLabelRecentChanges()}\n` +
        evidence.recentChanges
          .slice(0, 10)
          .map((change) => `- #${change.number} (${change.state}): ${change.title}`)
          .join("\n")
    );
  }

  if (evidence.openPullRequests?.length) {
    sections.push(
      `### ${blastRadiusSourceLabelOpenPrs()}\n` +
        evidence.openPullRequests
          .slice(0, 10)
          .map((pr) => `- #${pr.number} (${pr.state}): ${pr.title}`)
          .join("\n")
    );
  }

  if (evidence.ownersByFile?.length) {
    sections.push(
      `### ${blastRadiusSourceLabelCodeowners()}\n` +
        evidence.ownersByFile
          .slice(0, 10)
          .map((entry) => `- ${entry.file}: @${entry.owner} (${entry.source})`)
          .join("\n")
    );
  }

  if (evidence.jiraSearch) {
    sections.push(
      `### ${blastRadiusSourceLabelJira()}\n` +
        (evidence.jiraSearch.error
          ? `- Error: ${evidence.jiraSearch.error}`
          : evidence.jiraSearch.issues?.length
            ? evidence.jiraSearch.issues
                .slice(0, 8)
                .map((issue) => `- ${issue.key}: ${issue.summary} (${issue.status})`)
                .join("\n")
            : "- No matching Jira issues")
    );
  }

  if (evidence.confluenceSearch) {
    sections.push(
      `### ${blastRadiusSourceLabelConfluence()}\n` +
        (evidence.confluenceSearch.error
          ? `- Error: ${evidence.confluenceSearch.error}`
          : evidence.confluenceSearch.pages?.length
            ? evidence.confluenceSearch.pages
                .slice(0, 8)
                .map((page) => `- ${page.title}`)
                .join("\n")
            : "- No matching Confluence pages")
    );
  }

  if (evidence.ciWorkflows?.length) {
    sections.push(
      `### ${blastRadiusSourceLabelCiWorkflows()}\n` +
        evidence.ciWorkflows
          .slice(0, 8)
          .map((entry) => `- ${entry.path} references ${entry.matchedPath}`)
          .join("\n")
    );
  }

  if (evidence.crossRepoConsumers?.length) {
    sections.push(
      `### ${blastRadiusSourceLabelCrossRepo()}\n` +
        evidence.crossRepoConsumers
          .slice(0, 8)
          .map((entry) => `- ${entry.repoId}: ${entry.path} (${entry.source})`)
          .join("\n")
    );
  }

  if (evidence.slackSearch) {
    sections.push(
      `### ${blastRadiusSourceLabelSlack()}\n` +
        (evidence.slackSearch.error
          ? `- Error: ${evidence.slackSearch.error}`
          : evidence.slackSearch.messages?.length
            ? evidence.slackSearch.messages
                .slice(0, 8)
                .map((message) => `- ${message.channelName ?? "Slack"}: ${message.text.slice(0, 160)}`)
                .join("\n")
            : "- No matching Slack messages")
    );
  }

  if (evidence.notionSearch) {
    sections.push(
      `### ${blastRadiusSourceLabelNotion()}\n` +
        (evidence.notionSearch.error
          ? `- Error: ${evidence.notionSearch.error}`
          : evidence.notionSearch.pages?.length
            ? evidence.notionSearch.pages
                .slice(0, 8)
                .map((page) => `- ${page.title}`)
                .join("\n")
            : "- No matching Notion pages")
    );
  }

  if (evidence.googleDocsSearch) {
    sections.push(
      `### ${blastRadiusSourceLabelGoogleDocs()}\n` +
        (evidence.googleDocsSearch.error
          ? `- Error: ${evidence.googleDocsSearch.error}`
          : evidence.googleDocsSearch.documents?.length
            ? evidence.googleDocsSearch.documents
                .slice(0, 8)
                .map((doc) => `- ${doc.title}`)
                .join("\n")
            : "- No matching Google Docs")
    );
  }

  if (evidence.teamsSearch) {
    sections.push(
      `### ${blastRadiusSourceLabelTeams()}\n` +
        (evidence.teamsSearch.error
          ? `- Error: ${evidence.teamsSearch.error}`
          : evidence.teamsSearch.messages?.length
            ? evidence.teamsSearch.messages
                .slice(0, 8)
                .map((message) => `- ${message.fromUserName ?? "Teams"}: ${message.text.slice(0, 160)}`)
                .join("\n")
            : "- No matching Teams messages")
    );
  }

  if (evidence.localFiles?.files?.length) {
    sections.push(
      `### ${blastRadiusSourceLabelLocalFiles()}\n` +
        evidence.localFiles.files.map((entry) => `- ${entry.path}`).join("\n")
    );
  }

  if (evidence.warnings?.length) {
    sections.push("### Warnings\n" + evidence.warnings.map((warning) => `- ${warning}`).join("\n"));
  }

  return sections.join("\n\n");
}

function codeDependentDetailsFromEvidence(evidence: BlastRadiusEvidence): BlastRadiusDependentDetail[] {
  if (evidence.dependentDetails?.length) {
    return evidence.dependentDetails.map((entry) => ({
      ...entry,
      source: asGraphEdgeSource(entry.source)
    }));
  }
  const source = asGraphEdgeSource(evidence.graphMeta?.source);
  return [
    ...(evidence.directDependents ?? []).map((path) => ({ path, depth: 1, source })),
    ...(evidence.transitiveDependents ?? []).map((path) => ({ path, depth: 2, source }))
  ];
}
