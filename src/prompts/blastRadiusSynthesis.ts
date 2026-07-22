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
  blastRadiusSourceLabelCrossRepo,
  blastRadiusSourceLabelDependencies,
  blastRadiusSourceLabelDocsReferences,
  blastRadiusSourceLabelLocalFiles,
  blastRadiusSourceLabelOpenPrs,
  blastRadiusSourceLabelPublicApi,
  blastRadiusSourceLabelRecentChanges,
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
  supplementaryKeysOmittedFromChecklist,
  truncationNote,
  EVIDENCE_CITATION_RULES
} from "./evidenceSynthesis";

/**
 * Blast Radius = code impact first.
 * Prefer SCIP → index → heuristic. CODEOWNERS = who to ping. Open PRs optional.
 * Docs/chat/tickets are secondary only when already attached — never invent them.
 */
export const BLAST_RADIUS_EVIDENCE_SYSTEM = `You estimate code change impact for the primary file in ## Task.
Rank dependents by evidence quality: SCIP (compiler) first, then index, then heuristic import matching last.
Lead with who/what breaks — code dependents and tests. Treat docs/README/.d.ts hits as secondary references (counts only).
CODEOWNERS means who to notify before merging — keep that short.
Open PRs touching the path are optional context when present.
Never claim zero impact when dependency evidence is empty or unverified — say impact was not found in the index.
Be concise: the Sources card already lists files — summarize and prioritize; do not dump every path.
The primary blast-radius target is the open file — do not rewrite impact around out-of-scope @ attachments.
Do not list tsconfig / build-config files as risk surfaces.
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

  const citationKeys = listBlastRadiusSourceLabels(evidence);
  const sourcesChecklist = listBlastRadiusSourcesChecklist(evidence);
  appendCitationKeysSection(lines, citationKeys);
  appendSourcesChecklistSection(lines, sourcesChecklist);
  appendSupplementarySourceCitationGuardrails(
    lines,
    sourcesChecklist,
    supplementaryKeysOmittedFromChecklist(citationKeys, sourcesChecklist)
  );
  appendEvidenceQualityInstructions(lines);
  appendBlastRadiusSummaryGuidance(lines, evidence);
  if (evidence.ciWorkflows?.length) {
    lines.push(
      "- CI workflows reference this path — include brief rollout/verification guidance under **Operational risk**."
    );
  }
  if (evidence.ownersByFile?.length) {
    lines.push(
      "- CODEOWNERS data is attached — name owners to notify for **Top risk surfaces** under **Owners to notify**."
    );
  }
  lines.push(
    "Synthesize impact for the primary target file only. Prefer SCIP-confirmed paths over heuristic ones in Top risk surfaces."
  );
  lines.push(
    "Keep the narrative short: lead Summary with Top risk surfaces (up to 5), mirror them exactly in Direct impact, cite tests in Testing surfaces. Omit empty sections. Treat any docs/chat/tickets as secondary."
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
    "- Apply the partial index coverage caveat: open **Summary** by stating that dependency impact may be incomplete before listing Top risk surfaces."
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

/** Code-first evidence order for the model. Secondary context last and only if present. */
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

  if (evidence.graphMeta) {
    sections.push(
      `- Graph source: ${evidence.graphMeta.source ?? "unknown"} · edges: ${evidence.graphMeta.edgeCount ?? "?"} · lightning: ${evidence.graphMeta.lightningEnabled === false ? "disabled" : "enabled"}`
    );
  }

  if (evidence.directDependents?.length) {
    sections.push(
      `- Code dependents (${evidence.directDependents.length}):\n${evidence.directDependents.slice(0, 12).map((dep) => `  - ${dep}`).join("\n")}` +
        truncationNote(evidence.directDependents.length, 12)
    );
  }
  if (evidence.transitiveDependents?.length) {
    sections.push(
      `- Transitive dependents (${evidence.transitiveDependents.length}):\n${evidence.transitiveDependents.slice(0, 15).map((dep) => `  - ${dep}`).join("\n")}` +
        truncationNote(evidence.transitiveDependents.length, 15)
    );
  }
  if (evidence.dependentDetails?.length) {
    sections.push(
      `- Code dependent details:\n${evidence.dependentDetails
        .slice(0, 12)
        .map((entry) => `  - ${entry.path} (depth ${entry.depth}, ${entry.source})`)
        .join("\n")}` + truncationNote(evidence.dependentDetails.length, 12)
    );
  } else if (!evidence.directDependents?.length && !evidence.transitiveDependents?.length) {
    sections.push("- Impact unverified — no dependents found in index or fallback search.");
  }

  if (evidence.testFiles?.length) {
    sections.push(
      `### ${blastRadiusSourceLabelTests()}\n` +
        evidence.testFiles.slice(0, 10).map((entry) => `- ${entry.path} (${entry.source})`).join("\n") +
        truncationNote(evidence.testFiles.length, 10)
    );
  }

  if (evidence.ownersByFile?.length) {
    sections.push(
      `### ${blastRadiusSourceLabelCodeowners()}\n` +
        evidence.ownersByFile
          .slice(0, 10)
          .map((entry) => `- ${entry.file}: ${entry.owner} (${entry.source})`)
          .join("\n") +
        truncationNote(evidence.ownersByFile.length, 10)
    );
  }

  if (evidence.openPullRequests?.length) {
    sections.push(
      `### ${blastRadiusSourceLabelOpenPrs()}\n` +
        evidence.openPullRequests
          .slice(0, 8)
          .map((pr) => `- #${pr.number} (${pr.state}): ${pr.title}`)
          .join("\n") +
        truncationNote(evidence.openPullRequests.length, 8)
    );
  }

  if (evidence.publicExports?.length) {
    sections.push(
      `### ${blastRadiusSourceLabelPublicApi()}\n` +
        evidence.publicExports
          .slice(0, 8)
          .map((entry) => `- ${entry.symbol} (${entry.kind}, line ${entry.line})`)
          .join("\n") +
        truncationNote(evidence.publicExports.length, 8)
    );
  }

  if (evidence.ciWorkflows?.length) {
    sections.push(
      `### ${blastRadiusSourceLabelCiWorkflows()}\n` +
        evidence.ciWorkflows
          .slice(0, 8)
          .map((wf) => `- ${wf.path}${wf.matchedPath ? ` (matched ${wf.matchedPath})` : ""}`)
          .join("\n") +
        truncationNote(evidence.ciWorkflows.length, 8)
    );
  }

  if (evidence.recentChanges?.length) {
    sections.push(
      `### ${blastRadiusSourceLabelRecentChanges()}\n` +
        evidence.recentChanges
          .slice(0, 8)
          .map((change) => `- #${change.number} (${change.state}): ${change.title}`)
          .join("\n") +
        truncationNote(evidence.recentChanges.length, 8)
    );
  }

  if (evidence.crossRepoConsumers?.length) {
    sections.push(
      `### ${blastRadiusSourceLabelCrossRepo()}\n` +
        evidence.crossRepoConsumers
          .slice(0, 8)
          .map((entry) => `- ${entry.repoId}: ${entry.path}`)
          .join("\n") +
        truncationNote(evidence.crossRepoConsumers.length, 8)
    );
  }

  // Secondary context — only when already attached (not fetched on the hot path).
  const secondary: string[] = [];
  if (evidence.docsReferences?.length) {
    secondary.push(
      `### ${blastRadiusSourceLabelDocsReferences()} (secondary)\n` +
        evidence.docsReferences
          .slice(0, 6)
          .map((entry) => `- ${entry.path} (${entry.source})`)
          .join("\n") +
        truncationNote(evidence.docsReferences.length, 6)
    );
  }
  if (evidence.localFiles?.files?.length) {
    secondary.push(
      `### ${blastRadiusSourceLabelLocalFiles()}\n` +
        evidence.localFiles.files
          .slice(0, 4)
          .map((entry) => `- ${entry.path}`)
          .join("\n")
    );
  }
  if (secondary.length) {
    sections.push("### Secondary context (do not displace code impact)\n" + secondary.join("\n\n"));
  }

  if (evidence.warnings?.length) {
    sections.push(`- Warnings:\n${evidence.warnings.slice(0, 5).map((w) => `  - ${w}`).join("\n")}`);
  }

  return sections.join("\n");
}

function codeDependentDetailsFromEvidence(evidence: BlastRadiusEvidence): BlastRadiusDependentDetail[] {
  if (evidence.dependentDetails?.length) {
    return evidence.dependentDetails.map((entry) => ({
      ...entry,
      source: asGraphEdgeSource(entry.source)
    }));
  }
  const direct = (evidence.directDependents ?? []).map((path) => ({
    path,
    depth: 1 as const,
    source: asGraphEdgeSource(evidence.graphMeta?.source)
  }));
  const transitive = (evidence.transitiveDependents ?? []).map((path) => ({
    path,
    depth: 2 as const,
    source: asGraphEdgeSource(evidence.graphMeta?.source)
  }));
  return [...direct, ...transitive];
}
