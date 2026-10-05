import type { BlastRadiusEvidence } from "../context/contextBundleEvidence";
import {
  extractBlastSearchSymbols,
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
  hasVerifiedRemoteBlastDependents,
  listBlastRadiusSourceLabels,
  listBlastRadiusSourcesChecklist
} from "./blastRadiusSourceLabels";
import {
  appendCitationKeysSection,
  appendEvidenceQualityInstructions,
  appendSourcesChecklistSection,
  appendSupplementarySourceCitationGuardrails,
  appendUserFocusInstructions,
  supplementaryKeysOmittedFromChecklist,
  truncationNote,
  ATTACHED_FACTS_HEADING,
  EVIDENCE_CITATION_RULES
} from "./evidenceSynthesis";
import { appendIntegrationDocsResponseContract } from "./integrationDocsResponseContract";

export const BLAST_RADIUS_EVIDENCE_SYSTEM = `You analyze change impact: dependents, APIs, integrations, and operational risk.
Be concise: the Sources card already shows full file lists — summarize and prioritize; do not repeat every path in the narrative.
Prefer production / app / lib callers in Top risk surfaces and Direct impact. Stories, e2e, and unit tests are secondary — label them as test surfaces under Testing surfaces, not as primary blast.
Path prefixes are ranking heuristics, not proof a caller is deployed in production. Describe retrieved dependency relations without inventing deployment classification. No confirmed callers means coverage is unverified, never safe to change. Distinguish a positional parameter's local name from its type/arity/return contract: renaming that local parameter alone does not require caller changes or prove a compile failure. An import edge establishes a file dependency, not a call to a named symbol unless its use is verified in caller body or a symbol-level edge. Do not claim any/every behavior change necessarily affects an importer. Listed edges, even verified ones, do not establish complete graph coverage; claim completeness only with independently attached coverage evidence.
Be explicit about transitive effects when dependency data is available.
The primary blast-radius target is the open file in ## Task — do not rewrite impact analysis around out-of-scope @ attachments.
When Jira issues are attached: cite only tickets that mention the target file/symbol or are clearly about this change. Do not invent a link from "same repository" alone — say when a ticket is only loosely repo-related.
${OUT_OF_SCOPE_MENTIONS_SYSTEM_RULE}

${EVIDENCE_CITATION_RULES}`;

export type BlastRadiusSynthesisInput = {
  evidence: BlastRadiusEvidence;
  file: string;
  owner?: string;
  repo?: string;
  userQuestion?: string;
  /** Specific ask after a slash command / custom prompt — answer in the opening prose. */
  userFocus?: string;
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
  appendUserFocusInstructions(lines, input.userFocus);
  lines.push("## Open file");
  lines.push(`- File: ${file}`);
  if (input.owner && input.repo) {
    lines.push(`- Repository: ${input.owner}/${input.repo}`);
  }
  appendMentionScopeSection(lines, input);
  lines.push("");
  lines.push(ATTACHED_FACTS_HEADING);
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
  appendSupplementarySourceCitationGuardrails(
    lines,
    sourcesChecklist,
    supplementaryKeysOmittedFromChecklist(citationKeys, sourcesChecklist)
  );
  appendEvidenceQualityInstructions(lines);
  appendBlastRadiusSummaryGuidance(lines, evidence);
  if (evidence.ciWorkflows?.length) {
    lines.push(
      "- CI workflows reference this path — include rollout/verification guidance: which workflows run, what to watch during deploy, and how to validate the change."
    );
  }
  if (evidence.ownersByFile?.length) {
    lines.push(
      "- CODEOWNERS data is attached — recommend notifying owners of **Top risk surfaces** before merging."
    );
  }
  lines.push(
    "Audit impact for the open file only. Out-of-scope @ paths must not replace the dependency evidence for that file."
  );
  lines.push(
    "Keep the narrative short: lead with ## Top risk surfaces in **Summary** (production callers first), mirror them exactly in **Direct impact** (no extra paths), cite test/story/e2e files in **Testing surfaces**, treat docs references as secondary."
  );
  if (extractBlastSearchSymbols(input.userFocus || input.userQuestion, input.file).length > 0) {
    lines.push(
      "If the task names a function or identifier: **Direct impact** is callers of that identifier. Files that only import the same module for other exports are Weak / not \"will break.\" Do not treat every importer of the file as a breakage of the named function."
    );
  }
  lines.push("Follow the required response structure in your system instructions.");

  return lines.join("\n");
}

function appendBlastRadiusSummaryGuidance(lines: string[], evidence: BlastRadiusEvidence): void {
  const named = (evidence.namedAskSymbols ?? []).filter((symbol) => symbol.trim());
  const hasCodeDependents =
    (evidence.directDependents?.length ?? 0) > 0 ||
    (evidence.transitiveDependents?.length ?? 0) > 0 ||
    (evidence.dependentDetails?.length ?? 0) > 0;

  if (!hasCodeDependents) {
    lines.push("## Thin evidence (required)");
    lines.push(
      "- No code dependents were confirmed this turn. Answer in 1–3 sentences: impact is unverified (not zero impact). **Direct impact:** none confirmed. Then stop."
    );
    lines.push(
      "- Do **not** invent Direct impact, Testing surfaces, APIs, or Operational risk from reading the target file body."
    );
    if (named.length > 0) {
      lines.push(
        `- Callers of ${named.join(", ")} were not confirmed. Compatibility depends on the actual change; this graph slice did not list call sites and cannot certify safety. Next: search for \`${named[0]}(\` — do not list guessed paths.`
      );
    }
    lines.push("");
    return;
  }

  if (named.length > 0 && !(evidence.directDependents?.length)) {
    lines.push("## When callers are unconfirmed");
    lines.push(
      `- Callers of ${named.join(", ")} were not confirmed this turn. Compatibility depends on the actual change; absence from this graph slice does not certify safety. **Direct impact:** none confirmed. Do not list file paths. Next: search for \`${named[0]}(\`.`
    );
    lines.push("");
    return;
  }
  if (hasVerifiedRemoteBlastDependents(evidence)) {
    lines.push("## Opening guidance");
    lines.push(
      "- Listed dependency relations come from the remote graph. Lead with those retrieved relations, then state that total coverage is unverified unless separate coverage evidence is attached."
    );
    lines.push(
      "- Import-parse edges prove file dependencies, not named-symbol calls. Without caller body or symbol-level use evidence, name the importer as a file dependent and leave named-function effects unverified."
    );
    lines.push("");
    return;
  }
  if (!hasPartialIndexCoverage(evidence)) {
    return;
  }
  lines.push("## Opening guidance");
  lines.push(
    "- Open with the partial index coverage caveat from `[Sources: Dependency graph]` before impact conclusions or **Top risk surfaces**."
  );
  lines.push(
    "- Lower evidence strength when the dependency graph notes partial index coverage; do not treat listed dependents as exhaustive."
  );
  lines.push("");
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
  const named = (evidence.namedAskSymbols ?? []).filter((symbol) => symbol.trim());
  if (named.length > 0) {
    sections.push(
      `- Named function(s): ${named.join(", ")}. **Direct impact / will break** is callers of ${named.join(" / ")} only. Files that import this module for other exports are Weak — omit them from Direct impact.`
    );
    if (!(evidence.directDependents?.length)) {
      sections.push(
        `- Callers of ${named.join(", ")} are **unconfirmed**. Do not list any path under Direct impact.`
      );
    }
  }
  const codeDetails = codeDependentDetailsFromEvidence(evidence);
  const topRisk = rankCodeDependentsByRisk(codeDetails, 5);

  if (topRisk.length > 0) {
    sections.push(
      `### Top risk surfaces (use these first in Summary and Direct impact)\n${topRisk
        .map((entry, index) => `${index + 1}. ${entry.path} — dependency relation; deployment classification unverified (${entry.source})`)
        .join("\n")}`
    );
  }

  if (evidence.directDependents?.length) {
    sections.push(
      `- Code dependents (${evidence.directDependents.length}):\n${evidence.directDependents.slice(0, 12).map((dep) => `  - ${dep}`).join("\n")}` +
        truncationNote(evidence.directDependents.length, 12)
    );
  }
  if (evidence.docsReferences?.length) {
    sections.push(
      `### ${blastRadiusSourceLabelDocsReferences()}\n` +
        evidence.docsReferences
          .slice(0, 10)
          .map((entry) => `- ${entry.path} (${entry.source})`)
          .join("\n") +
        truncationNote(evidence.docsReferences.length, 10)
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
        .map((entry) => {
          const strength = entry.strength ? `, ${entry.strength}` : "";
          return `  - ${entry.path} (depth ${entry.depth}, ${entry.source}${strength})`;
        })
        .join("\n")}` + truncationNote(evidence.dependentDetails.length, 12)
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
        evidence.testFiles.slice(0, 10).map((entry) => `- ${entry.path} (${entry.source})`).join("\n") +
        truncationNote(evidence.testFiles.length, 10)
    );
  }

  if (evidence.publicExports?.length) {
    sections.push(
      `### ${blastRadiusSourceLabelPublicApi()}\n` +
        evidence.publicExports
          .slice(0, 10)
          .map((entry) => `- ${entry.symbol} (${entry.kind}, line ${entry.line})`)
          .join("\n") +
        truncationNote(evidence.publicExports.length, 10)
    );
  }

  if (evidence.recentChanges?.length) {
    sections.push(
      `### ${blastRadiusSourceLabelRecentChanges()}\n` +
        evidence.recentChanges
          .slice(0, 10)
          .map((change) => `- #${change.number} (${change.state}): ${change.title}`)
          .join("\n") +
        truncationNote(evidence.recentChanges.length, 10)
    );
  }

  if (evidence.openPullRequests?.length) {
    sections.push(
      `### ${blastRadiusSourceLabelOpenPrs()}\n` +
        evidence.openPullRequests
          .slice(0, 10)
          .map((pr) => `- #${pr.number} (${pr.state}): ${pr.title}`)
          .join("\n") +
        truncationNote(evidence.openPullRequests.length, 10)
    );
  }

  if (evidence.ownersByFile?.length) {
    sections.push(
      `### ${blastRadiusSourceLabelCodeowners()}\n` +
        evidence.ownersByFile
          .slice(0, 10)
          .map((entry) => `- ${entry.file}: @${entry.owner} (${entry.source})`)
          .join("\n") +
        truncationNote(evidence.ownersByFile.length, 10)
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
                .join("\n") + truncationNote(evidence.jiraSearch.issues.length, 8)
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
                .join("\n") + truncationNote(evidence.confluenceSearch.pages.length, 8)
            : "- No matching Confluence pages")
    );
  }

  if (evidence.ciWorkflows?.length) {
    sections.push(
      `### ${blastRadiusSourceLabelCiWorkflows()}\n` +
        evidence.ciWorkflows
          .slice(0, 8)
          .map((entry) => `- ${entry.path} references ${entry.matchedPath}`)
          .join("\n") +
        truncationNote(evidence.ciWorkflows.length, 8)
    );
  }

  if (evidence.crossRepoConsumers?.length) {
    sections.push(
      `### ${blastRadiusSourceLabelCrossRepo()}\n` +
        evidence.crossRepoConsumers
          .slice(0, 8)
          .map((entry) => `- ${entry.repoId}: ${entry.path} (${entry.source})`)
          .join("\n") +
        truncationNote(evidence.crossRepoConsumers.length, 8)
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
                .join("\n") + truncationNote(evidence.slackSearch.messages.length, 8)
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
                .join("\n") + truncationNote(evidence.notionSearch.pages.length, 8)
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
                .join("\n") + truncationNote(evidence.googleDocsSearch.documents.length, 8)
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
                .map((message) => `- ${message.fromUserName ?? "Teams"}: ${(message.text ?? message.body ?? "").slice(0, 160)}`)
                .join("\n") + truncationNote(evidence.teamsSearch.messages.length, 8)
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

function asBlastCallStrength(value: string | undefined): "strong" | "weak" | undefined {
  return value === "strong" || value === "weak" ? value : undefined;
}

function codeDependentDetailsFromEvidence(evidence: BlastRadiusEvidence): BlastRadiusDependentDetail[] {
  if (evidence.dependentDetails?.length) {
    return evidence.dependentDetails.map((entry) => ({
      path: entry.path,
      depth: entry.depth,
      source: asGraphEdgeSource(entry.source),
      strength: asBlastCallStrength(entry.strength)
    }));
  }
  const source = asGraphEdgeSource(evidence.graphMeta?.source);
  return [
    ...(evidence.directDependents ?? []).map((path) => ({ path, depth: 1, source })),
    ...(evidence.transitiveDependents ?? []).map((path) => ({ path, depth: 2, source }))
  ];
}

const ZERO_IMPACT_CLAIM =
  /\b(?:0|zero|no)\s+(?:code\s+)?dependents?\b|\b(?:will\s+not|won'?t|does\s+not|doesn'?t)\s+break\b|\bno\s+impact\b|\bnothing\s+depends\b|\bimpact\s+is\s+(?:none|negligible|zero)\b/i;

/** True when the model claimed safe/zero impact despite empty or unverified evidence. */
export function blastResponseClaimsZeroImpact(content: string): boolean {
  return ZERO_IMPACT_CLAIM.test(content);
}

/**
 * Empty-graph blast: replace the essay so “unverified” cannot sit above
 * invented Direct impact / Testing / APIs from the file body alone.
 */
export function honestUnverifiedBlastAnswer(file?: string): string {
  const where = file?.trim() ? ` \`${file.trim()}\`` : " this file";
  return [
    `Impact for${where} is **unverified** — no dependents were confirmed in the index this turn.`,
    "",
    "That is not the same as zero impact. I can’t list will-break files or invent APIs / testing surfaces from the file body alone.",
    "",
    "**Direct impact**",
    "",
    "None confirmed."
  ].join("\n");
}

/**
 * Named-function blast with no confirmed callers: replace the essay so
 * “unverified” cannot sit above a guessed Direct impact list.
 */
export function honestNamedFunctionBlastAnswer(symbols: string[], file?: string): string {
  const names = symbols.filter((symbol) => symbol.trim());
  const named = names[0] ?? "this function";
  const where = file?.trim() ? ` in \`${file.trim()}\`` : "";
  return [
    `\`${named}\` is defined${where}. Compatibility depends on the actual change and its callers; a local positional-parameter rename alone does not change the call contract.`,
    "",
    "This turn’s graph did not confirm those call sites, so I can’t list will-break files with confidence. That is not the same as nothing breaks.",
    "",
    "**Direct impact**",
    "",
    "None confirmed in the index this turn.",
    "",
    "**What to do next**",
    "",
    `Search this repo for \`${named}(\` (the call). An import of a sibling export from the same file is not a \`${named}\` breakage.`
  ].join("\n");
}

/**
 * Prevent “0 dependents / no impact” claims when evidence is empty/unverified,
 * and prepend production-ranked callers when the model omitted them.
 * Empty graph: **replace** the essay — never prepend a caveat and keep fluff.
 */
export function importOnlyNamedBlastAnswer(evidence: BlastRadiusEvidence | undefined): string | undefined {
  if (!evidence) return undefined;
  const named = (evidence.namedAskSymbols ?? []).filter((symbol) => symbol.trim());
  const details = codeDependentDetailsFromEvidence(evidence);
  const ranked = rankCodeDependentsByRisk(details, 8);
  if (!named.length || !ranked.length || details.some((entry) => entry.source !== "import-parse" || entry.strength === "strong")) return undefined;
  return [
    `Named-symbol impact for \`${named.join(", ")}\` is **unverified** in this turn.`,
    "", "**Verified file dependencies**", "",
    ...ranked.map((entry) => `- \`${entry.path}\` — file dependency; named-symbol use unverified.`),
    "",
    "These edges do not establish calls to the requested symbol, complete dependency coverage, or inevitable behavioral impact. They also do not establish an implementation defect or the intended contract.",
    "", "**What to check next**", "",
    "Verify the requested symbol's use in these remote caller bodies, then assess the proposed change against the actual inputs and expected contract. Missing call evidence does not mean the change is safe."
  ].join("\n");
}

export function enrichBlastRadiusResponse(
  content: string,
  evidence: BlastRadiusEvidence | undefined
): string {
  if (!evidence) {
    return content;
  }
  const named = (evidence.namedAskSymbols ?? []).filter((symbol) => symbol.trim());
  const details = codeDependentDetailsFromEvidence(evidence);
  const ranked = rankCodeDependentsByRisk(details, 8);
  const trimmed = content.trim();
  const claimsZero = blastResponseClaimsZeroImpact(trimmed);
  const hasDependents = ranked.length > 0;

  const importOnlyAnswer = importOnlyNamedBlastAnswer(evidence);
  if (importOnlyAnswer) return importOnlyAnswer;

  if (!hasDependents) {
    return named.length > 0
      ? honestNamedFunctionBlastAnswer(named, evidence.file)
      : honestUnverifiedBlastAnswer(evidence.file);
  }

  if (hasDependents) {
    const missingTop = ranked
      .slice(0, 5)
      .filter((entry) => !trimmed.includes(entry.path));
    if (missingTop.length === 0 && !claimsZero) {
      return content;
    }
    const lines = ranked.slice(0, 5).map((entry) => {
      const surface = entry.riskReason.toLowerCase().includes("test")
        ? "test surface"
        : "code dependent; deployment classification unverified";
      return `- \`${entry.path}\` (${surface})`;
    });
    const lead = [
      "**Direct impact (index / search)**",
      "",
      ...lines,
      "",
      claimsZero
        ? "Do not treat missing SCIP edges as zero impact — callers above were found via dependency or symbol search."
        : "",
      ""
    ]
      .filter((line) => line !== undefined)
      .join("\n");
    return `${lead}${trimmed}`;
  }

  return content;
}
