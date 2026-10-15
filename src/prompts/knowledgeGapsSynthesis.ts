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
  knowledgeGapScanCoverageFromJobScan,
  knowledgeGapScanIncompleteCopy,
  knowledgeGapScanCoverageAudienceLabel,
  isInfraDependencyGraphGap
} from "../context/knowledgeGapScanCoverage";
import {
  isKnowledgeGapsCodeRuleAudit,
  knowledgeGapsGatherQuery,
  resolveKnowledgeGapsAuditScope
} from "../context/knowledgeGapsFocus";
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
import { formatOwnershipReportForPrompt } from "./ownershipSynthesis";
import { ORG_DOCS_EVIDENCE_LABEL, orgDocsSynthesisGuardrail } from "../workspace/repoEvidenceIsolation";

/** The same source boundary applies to focused rules and ordinary health audits. */
const KNOWLEDGE_GAPS_SOURCE_BOUNDARY_RULE =
  "A query or lookup establishes selection criteria, not permission to perform an operation. Preserve every shown constraint when describing that selection; authorization requires the relevant checks and subsequent execution path. This distinction also applies to factual premises inside open questions. Preserve branch conditions, earlier rejects, alternative outcomes, and exception handling whenever they qualify a finding. Skipping one guard establishes only that guard's bypass, never downstream reachability, absence of other checks, or an unchecked write. Earlier guards and normal return from intervening awaited calls remain conditions; an unattached callee may reject or throw. A comment establishes what its author stated, not independently verified behavior or intent. Exact source quotes establish the quoted text; they do not by themselves establish the explanation's correctness.";

export const KNOWLEDGE_GAPS_EVIDENCE_SYSTEM = `You audit engineering health using only attached evidence from the Sources card and synthesis bundle.
${KNOWLEDGE_GAPS_SOURCE_BOUNDARY_RULE}
Universal behavior claims require tracing the relevant input conditions in attached source. One example does not establish behavior for every input: identify the condition that causes the observed result and check relevant counterexamples. Describe a defect with the narrowest condition the implementation supports.
Separate observed implementation behavior from the expected contract. A function name alone is not a formal specification. Without attached tests, documentation, or an explicit user requirement establishing intent, describe a potential defect conditional on the expected behavior and ask for that intent to be confirmed.
Partial source windows establish only the conditions and operations shown. They cannot prove complete repository coverage or absence of implementation, documentation, tests, or policy. Unshown conditions and called implementations remain unverified; names and call edges cannot substitute for their source.
When intent is unverified, do not label behavior a confirmed error, blocker, or wrong result and then qualify that claim later. Put the condition in the finding itself: observed behavior first, potential defect only if the expected contract requires different behavior. Naming conventions do not establish that contract. An import or call edge proves a dependency, not that callers inevitably receive wrong results; caller impact requires a verified contract and relevant inputs.
When ### Focus file excerpts are attached, you MAY name documentation, ownership, or default-on risks that are visible in those excerpts (allowlists, call caps, missing confirmation). Cite the path. Still fail: inventing files not attached, foreign-repo paths, or a 40-bullet dump.
When focus excerpts are absent, list scan-backed gaps and integration hits only — never invent gap subsections from code inspection or generic framework knowledge.
Documentation gap subsections must come from knowledge gap scan entries, opened Confluence/Notion/Google Docs Body lines, Jira Body lines, opened Slack/Teams Body lines, explicit integration errors in the bundle, or attached focus file excerpts.
Titles alone are not documentation gaps — summarize attached Body content (or state Body not attached).
Never treat a local or wrong-project AGENTS.md / Cursor rule as Use-repo gaps evidence. If scan evidence is empty, say the scan could not verify gaps — do not claim “no gaps” from an unrelated AGENTS file.
The primary audit target is stated in ## Task — do not center the audit on out-of-scope @ attachments.
When ## User focus / ## Primary topic is present, audit those subsystems first — leftover open-editor ownership is secondary at most.
Org Confluence/Notion hits are org-wide supplementary docs — never the active repository's architecture source of truth.
${OUT_OF_SCOPE_MENTIONS_SYSTEM_RULE}

${EVIDENCE_CITATION_RULES}`;

export const KNOWLEDGE_GAPS_CODE_RULE_AUDIT_MARKER = "## Focused code rule audit";

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
  /** Specific ask after a slash command / custom prompt — answer in the opening prose. */
  userFocus?: string;
  mentionedFiles?: MentionScopeRef[];
  activeRepoId?: string;
};

export function buildKnowledgeGapsSynthesisUserPrompt(input: KnowledgeGapsSynthesisInput): string {
  const userFocus =
    knowledgeGapsGatherQuery(input.userFocus) ??
    knowledgeGapsGatherQuery(input.evidence.userFocus);
  const scope = resolveKnowledgeGapsAuditScope({
    file: input.file,
    userFocus,
    focusHitPaths: input.evidence.focusSearchPaths
  });
  if (isKnowledgeGapsCodeRuleAudit(userFocus)) {
    return buildFocusedCodeRuleAuditPrompt(input, userFocus!, scope);
  }
  const repoWide =
    !scope.focusPrimary &&
    !input.file?.trim() &&
    Boolean(input.owner?.trim() && input.repo?.trim());
  const lines: string[] = [];
  lines.push("## Task");
  if (scope.focusPrimary && scope.gatherQuery) {
    // Focus wins over the canned quick-action task sentence (which still names the open file).
    lines.push(
      `Audit knowledge gaps for the user's focus — ${scope.gatherQuery}: missing docs, unclear ownership, and open questions for those subsystems.`
    );
  } else {
    lines.push(
      input.userQuestion?.trim() ||
        (repoWide
          ? `Audit knowledge gaps across ${input.owner}/${input.repo}: missing docs, unclear ownership, and open questions.`
          : `Audit knowledge gaps for ${input.file ?? "this area"}: missing docs, unclear ownership, and open questions.`)
    );
  }
  lines.push("");
  appendUserFocusInstructions(lines, userFocus);

  if (scope.focusPrimary && scope.gatherQuery) {
    lines.push("## Primary topic");
    lines.push(`- Focus (primary gather query): ${scope.gatherQuery}`);
    for (const topic of scope.focusTopics) {
      lines.push(
        `- Subsystem topic (must address gaps or state no evidence found): ${topic}`
      );
    }
    if (input.owner && input.repo) {
      lines.push(`- Repository: ${input.owner}/${input.repo}`);
    }
    if (scope.relatedOpenFile) {
      lines.push(
        `- Related open file (secondary code anchor — not the Summary headline): ${scope.relatedOpenFile}`
      );
    }
    if (scope.secondaryUnrelatedFile) {
      lines.push(
        `- Open editor (secondary — unrelated to focus): ${scope.secondaryUnrelatedFile}`
      );
      lines.push(
        "- Do not make ownership of the unrelated open editor the Summary headline topic."
      );
    }
    appendMentionScopeSection(lines, input);
    lines.push("");
  } else if (repoWide) {
    lines.push("## Repository");
    lines.push(`- ${input.owner}/${input.repo}`);
    appendMentionScopeSection(lines, input);
    lines.push("");
  } else if (input.file) {
    lines.push("## Open file");
    lines.push(`- File: ${input.file}`);
    if (input.owner && input.repo) {
      lines.push(`- Repository: ${input.owner}/${input.repo}`);
    }
    appendMentionScopeSection(lines, input);
    lines.push("");
  }

  lines.push(ATTACHED_FACTS_HEADING);
  lines.push(
    formatKnowledgeGapsForPrompt(
      input.evidence,
      input.confluence,
      input.jira,
      input.slack,
      input.notion,
      input.googleDocs,
      input.teams,
      scope.focusPrimary ? scope.relatedOpenFile : input.file,
      input.owner,
      input.repo,
      scope
    )
  );
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
  const citationKeys = listKnowledgeGapsSourceLabels(
    input.evidence,
    input.confluence,
    input.jira,
    input.slack,
    input.notion,
    input.googleDocs,
    input.teams
  );
  const sourcesChecklist = listKnowledgeGapsSourcesChecklist(
    input.evidence,
    input.confluence,
    input.jira,
    input.slack,
    input.notion,
    input.googleDocs,
    input.teams
  );
  appendSourcesChecklistSection(lines, sourcesChecklist);
  appendSupplementarySourceCitationGuardrails(lines, sourcesChecklist, [
    knowledgeGapsSourceLabelOwnership(),
    knowledgeGapsSourceLabelDependencies(),
    ...supplementaryKeysOmittedFromChecklist(citationKeys, sourcesChecklist)
  ]);
  appendEvidenceQualityInstructions(lines);
  appendIntegrationDocsResponseContract(lines, {
    notionPages: input.notion?.pages,
    confluencePages: input.confluence?.pages,
    googleDocs: input.googleDocs?.documents,
    targetSection: "Documentation gaps"
  });
  if (
    (input.confluence?.pages?.length ?? 0) > 0 ||
    (input.notion?.pages?.length ?? 0) > 0 ||
    (input.googleDocs?.documents?.length ?? 0) > 0
  ) {
    lines.push(`## ${ORG_DOCS_EVIDENCE_LABEL}`);
    lines.push(orgDocsSynthesisGuardrail(input.owner, input.repo));
    lines.push("");
  }
  appendKnowledgeGapsResponseContract(lines, input, scope.focusPrimary);
  if (scope.focusPrimary) {
    lines.push(
      "Synthesize gaps for the ## Primary topic focus subsystems first. Cover each listed subsystem topic with evidence-backed gaps or an explicit no-evidence line. Open-file ownership is secondary at most when the open editor is unrelated to focus. Out-of-scope @ paths must not replace the focus audit."
    );
  } else {
    lines.push(
      repoWide
        ? "Synthesize repository-wide blind spots from attached sources — prioritize missing docs, unclear ownership, and orphaned areas across the repo."
        : "Audit the open file only. Out-of-scope @ paths must not replace that audit."
    );
  }
  lines.push("Follow the required response structure in your system instructions.");
  return lines.join("\n");
}

function buildFocusedCodeRuleAuditPrompt(
  input: KnowledgeGapsSynthesisInput,
  userFocus: string,
  scope: ReturnType<typeof resolveKnowledgeGapsAuditScope>
): string {
  const lines = [
    KNOWLEDGE_GAPS_CODE_RULE_AUDIT_MARKER,
    userFocus,
    "Answer the original question with two sections only: **Source-grounded review** and **Open questions**. Begin directly with the first heading. Keep one to three distinct findings relevant to the request; do not duplicate a condition and its operation as separate findings.",
    "Each finding consists of a short title, one condition-bound sentence, and a small exact numeric source quote. Preserve the full condition, including when execution reaches the operation. End the finding after its quote; do not add an uncited factual premise or infer unreviewed input, lifecycle, or policy behavior. A selected implementation can require a second exact quote of its attached definition.",
    "Keep numeric comparisons literal: a fallback and lower-bound comparison do not establish matching every possible stored value. Describe the shown predicate rather than assuming the data domain. For chained library calls, describe the shown callback expressions and local conditional throw; library dispatch, equality semantics, or database behavior require an attached definition. Headings must preserve the same conditions and evidence boundaries as their findings.",
    "Each open question consists of an interrogative sentence tied to a cited finding, followed by a prospective test or documentation suggestion. Keep at most three. Do not preface questions with unverified factual assertions. Unreviewed input handling and later calls are questions to verify, not established execution paths. Proposed checks do not imply that tests or documents already exist or are missing.",
    "Establish only the conditions and operations directly visible in the attached numbered source and relevant to the original request. Do not replace the requested analysis with unrelated findings or scan coverage.",
    "Describe a guard when execution reaches that check. Earlier rejects may run first; one quoted guard cannot establish the same error for every call to its containing function.",
    "A shown input check or call establishes that local boundary, not the behavior of unreviewed callers, decoding, called implementations, or later execution. Ask how those boundaries connect when their source is not attached.",
    KNOWLEDGE_GAPS_SOURCE_BOUNDARY_RULE,
    "Partial source and search misses cannot establish exhaustive coverage or absence of implementation, documentation, tests, or intended policy. One observed check does not establish that it is the only check or that passing it guarantees the final outcome.",
    "Names and framework conventions cannot prove behavior, intended policy, or operational guarantees. Review attached definitions or leave those effects unknown.",
    "When a branch selects an implementation, trace the exact selected identifier to its attached definition. Do not substitute a similarly named implementation. Quote the selection and the relevant definition before attributing called behavior to that path.",
    "Every established rule needs a small numeric start:end:path citation fence quoting contiguous, exact supplied source lines. Never merge nonadjacent ranges with an ellipsis. Use only reviewed paths; never invent test directories, owners, or source locations.",
    "Use only enclosing function or type identity established by attached source; do not infer it from a filename. A call quote proves that call in the shown context, not unreviewed earlier or later behavior.",
    "If no relevant code or document bodies are attached, state the coverage limit in 1–3 sentences and stop. Missing searches do not prove that source, documentation, tests, or policy are absent.",
    "Documentation can settle intent only when an attached body establishes it. Treat org docs as supplementary. Without supporting docs, add at most one final sentence about that evidence limit; omit generic recommendations and health-scan sections."
  ];
  appendMentionScopeSection(lines, input);
  // The focused contract uses reviewed code/docs, not generic health-scan flags.
  lines.push(formatKnowledgeGapsForPrompt({
    userFocus, focusSearchQuery: input.evidence.focusSearchQuery,
    focusSearchPaths: input.evidence.focusSearchPaths, focusFiles: input.evidence.focusFiles
  }, input.confluence, input.jira, input.slack, input.notion, input.googleDocs, input.teams,
  scope.relatedOpenFile, input.owner, input.repo, scope));
  appendCitationKeysSection(lines, listKnowledgeGapsSourceLabels(input.evidence,
    input.confluence, input.jira, input.slack, input.notion, input.googleDocs, input.teams));
  return lines.join("\n\n");
}

function appendKnowledgeGapsResponseContract(
  lines: string[],
  input: KnowledgeGapsSynthesisInput,
  focusPrimary = false
): void {
  const hasFocusExcerpts = Boolean(
    input.evidence.focusFiles?.some((file) => (file.content ?? "").trim())
  );
  const scanGaps = input.evidence.jobScan?.gaps ?? [];
  const documentationGaps = scanGaps.filter((gap) => {
    if (gap.type === "focus_search_miss") {
      return false;
    }
    if (isInfraDependencyGraphGap(gap)) {
      return false;
    }
    if (String(gap.message ?? "").includes("No indexed code")) {
      return false;
    }
    return (
      gap.type === "missing_docs" ||
      gap.type === "tribal_knowledge" ||
      gap.type === "default_on_risk" ||
      gap.type === "wrong_file_evidence" ||
      gap.type === "canned_miss" ||
      gap.type === "ui_for_api"
    );
  });
  const ownerGaps = scanGaps.filter((gap) => gap.type === "missing_owner");
  const integrationGaps = scanGaps.filter(
    (gap) =>
      gap.type === "integration_unknown" ||
      gap.type === "ops_unknown" ||
      gap.type === "missing_runbook" ||
      gap.type === "missing_ops"
  );

  lines.push("## Response contract (required)");
  lines.push(
    "Source findings must distinguish observed behavior from a verified expected contract in the finding itself, not a later disclaimer. Without attached tests, documentation, or an explicit user requirement proving intent, do not label behavior a confirmed error, blocker, or wrong result. A function name is not contract evidence. State potential defects conditionally and confirm intent before prescribing a correction. An import or call edge establishes a dependency only; do not claim inevitable wrong caller results without the relevant inputs and expected contract."
  );
  lines.push(
    "Missing search hits or unattached source bodies establish a coverage limit, not that documentation, ownership, or an implementation does not exist. Describe such results as unknown or not found in this pass. Only assert absence when attached evidence actually proves it; never turn unavailable evidence into a confirmed gap.",
    "Recommendations are prospective: describe what should be checked or changed. Never assume a proposed patch was applied or repeat a prior chat claim of a fix as fact. The actual attached source body is authoritative for current behavior; an unapplied suggestion does not change it."
  );
  lines.push(
    "Ownership coverage flags (missing_owner, orphaned, absent scores) are retrieval or scan limits, not proof that no declared owner or CODEOWNERS entry exists. Apply this distinction to every section, including reviewer checks, recommendations, and suggested contacts. Authors/reviewers are contact candidates, not declared owners. Aggregate commit counts do not establish last-quarter inactivity; use dated activity and the attached analysis time. Missing or contradictory dates mean recency is unknown. Slack presence does not establish repository activity."
  );
  lines.push(
    "When ownership coverage is incomplete, recommend checking the current ownership policy first. Do not recommend adding a CODEOWNERS entry, assigning an owner, or resolving a high-priority ownership gap solely from missing_owner/orphaned scan flags. A policy change requires verified policy evidence establishing the missing or incorrect entry; otherwise responsibility remains an open verification question."
  );
  if (focusPrimary) {
    lines.push(
      "The opening must lead with the ## Primary topic focus subsystems (docs/ownership gaps or explicit no-evidence). Do not make ownership of an unrelated open editor the headline."
    );
  }
  if (hasFocusExcerpts) {
    lines.push(KNOWLEDGE_GAPS_SOURCE_BOUNDARY_RULE);
    lines.push("Keep this source audit compact: at most three relevant findings and three specific open questions. Preserve the complete conditions and call boundaries supported by attached source. Quote small exact numeric source slices; unrelated operations and unreviewed behavior remain outside the findings.");
    lines.push(
      "Opening — PASS: acknowledge the attached source. Include a separate **Source-grounded review** section before scan coverage sections: answer the user's function or implementation question from the attached bodies, trace relevant behavior and boundary conditions, distinguish observed behavior from an unverified intended contract, and cite verified numeric source ranges when supplied. Keep these findings outside Summary so coverage summarization cannot replace them. Generic missing_docs/missing_owner flags do not substitute for reading the attached function. If no concrete source-backed issue is established, state that narrowly with the reviewed evidence. FAIL: claiming no indexed code; generic scan flags as the only answer; empty “looks good”; a 40-bullet dump."
    );
    lines.push(
      "After the source findings, include **Open questions** with at most three specific uncertainties that follow from those findings. Tie each question to its source finding and suggest documentation or a test that would settle the intended policy. Missing docs/searches do not prove a policy is absent. Do not infer unreviewed conditions, calls, final outcomes, or guarantees from one observed operation."
    );
  }
  lines.push("**Documentation gaps** must include, in order (after the attached page titles above):");
  for (const gap of documentationGaps) {
    lines.push(`- Scan gap subsection from [Sources: Knowledge gap scan]: ${String(gap.message ?? gap.type ?? "gap")}`);
  }
  if (
    !input.notion?.pages?.length &&
    !input.confluence?.pages?.length &&
    !input.googleDocs?.documents?.length &&
    documentationGaps.length === 0
  ) {
    lines.push("- State that no documentation integration hits or scan gaps were attached.");
  }

  if (ownerGaps.length > 0) {
    if (focusPrimary) {
      lines.push(
        "**Ownership & maintenance** — include missing_owner scan gaps only as secondary when they relate to focus topics; never headline unrelated open-file ownership over the focus ask."
      );
    } else {
      lines.push("**Ownership & maintenance** — include one subsection per missing_owner scan gap only.");
    }
  } else {
    lines.push(
      "- **Omit Ownership & maintenance entirely** — scan has no missing_owner gaps; do not invent owner or maintainer questions from ownership signals."
    );
  }

  if (integrationGaps.length > 0) {
    lines.push("**Integration & operations** — include one subsection per integration/ops scan gap only.");
  } else {
    lines.push(
      "- **Omit Integration & operations entirely** — scan has no integration/ops gaps; do not invent plugin, deploy, or configuration questions."
    );
  }

  const scanGapCount = documentationGaps.length + ownerGaps.length + integrationGaps.length;
  const coverage = knowledgeGapScanCoverageFromJobScan(input.evidence.jobScan);
  const hasDocHits =
    Boolean(input.notion?.pages?.length) ||
    Boolean(input.confluence?.pages?.length) ||
    Boolean(input.googleDocs?.documents?.length);
  if (hasFocusExcerpts) {
    lines.push("- Lead with the established source behavior. Describe incomplete documentation/scan coverage briefly after the code review; it must not replace or reorder the code half of the answer.");
  } else if (coverage === "scan_incomplete") {
    lines.push(
      `- The opening must start: "${knowledgeGapScanIncompleteCopy()}" Name attached documentation or ownership gaps on real repo paths. FAIL: treating a missing Coop dependency graph as the documentation audit; recommending GitHub Dependency Submission API, depcruise, or inventing blast-radius. Do not quote raw API errors or internal coverage tokens.`
    );
  } else if (scanGapCount === 0 && hasDocHits) {
    lines.push(
      '- The opening must start: "Automated scan found no structured gaps in this pass; attached doc review suggests…" — summarize doc-review follow-ups; do not contradict the zero-gap scan or claim the scan reported documentation gaps.'
    );
  } else if (scanGapCount === 0) {
    lines.push(
      "- The opening should state the coverage limit. Focus search misses are not confirmed product gaps and do not establish a completed clean scan. With no relevant code bodies or document evidence, answer in 1–3 sentences and stop; omit sections, contacts, guessed paths, manual-grep instructions, and generic recommendations."
    );
  } else {
    lines.push(
      "- The opening must acknowledge Notion/Confluence/Google Docs hits when present and cite scan gaps verbatim — never claim zero documentation when Notion pages are attached."
    );
  }
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
  repo?: string,
  scope?: ReturnType<typeof resolveKnowledgeGapsAuditScope>
): string {
  const sections: string[] = [];
  if (scope?.focusPrimary && scope.gatherQuery) {
    sections.push(
      `### Scope\n- Focus gather query: ${scope.gatherQuery}\n` +
        (scope.focusTopics.length
          ? scope.focusTopics.map((topic) => `- Topic: ${topic}`).join("\n") + "\n"
          : "") +
        (owner && repo ? `- Repository: ${owner}/${repo}\n` : "") +
        (scope.relatedOpenFile ? `- Related open file: ${scope.relatedOpenFile}\n` : "") +
        (scope.secondaryUnrelatedFile
          ? `- Open editor (secondary — unrelated to focus): ${scope.secondaryUnrelatedFile}`
          : "")
    );
  } else if (file) {
    sections.push(`### Scope\n- File: ${file}`);
  } else if (owner && repo) {
    sections.push(`### Scope\n- Repository: ${owner}/${repo}`);
  }
  const focusQuery = evidence.focusSearchQuery ?? scope?.gatherQuery;
  const focusPaths = evidence.focusSearchPaths ?? [];
  if (focusQuery || focusPaths.length || evidence.focusFiles?.length) {
    sections.push(
      `### Focus search\n` +
        (focusQuery ? `- Query: ${focusQuery}\n` : "") +
        (focusPaths.length
          ? `- Hit paths:\n${focusPaths
              .slice(0, 12)
              .map((path) => `  - ${path}`)
              .join("\n")}`
          : "- No focus-ranked paths attached") +
        (evidence.focusFiles?.length
          ? `\n- Attached bodies: ${evidence.focusFiles
              .slice(0, 6)
              .map((fileHit) => fileHit.path)
              .join(", ")}`
          : "")
    );
  }
  const excerpts = formatFocusFileExcerpts(evidence.focusFiles);
  if (excerpts) {
    sections.push(excerpts);
  }
  if (evidence.jobScan) {
    const scan = evidence.jobScan;
    const coverage = knowledgeGapScanCoverageFromJobScan(scan);
    sections.push(
      `### ${knowledgeGapsSourceLabelScan()}\n` +
        `- Found gaps: ${scan.foundGaps ?? scan.gaps?.length ?? 0}\n` +
        `- Scan status: ${knowledgeGapScanCoverageAudienceLabel(coverage)}\n` +
        `- High / medium / low: ${scan.highPriority ?? 0} / ${scan.mediumPriority ?? 0} / ${scan.lowPriority ?? 0}\n` +
        (scan.gaps?.length
          ? scan.gaps
              .slice(0, 20)
              .map((gap) => {
                const message = String(gap.message ?? gap.summary ?? gap.description ?? "gap");
                return gap.type === "missing_owner" || gap.type === "missing_docs"
                  ? `- Coverage flag (${gap.type}): scan reported ${message}; absence is not established.`
                  : `- ${message}`;
              })
              .join("\n") + truncationNote(scan.gaps.length, 20)
          : "- (scan completed with no structured gaps in this pass)")
    );
  } else if (!(evidence.focusFiles?.some((file) => (file.content ?? "").trim()))) {
    sections.push(
      `### ${knowledgeGapsSourceLabelScan()}\n` +
        "- No automated knowledge-gap scan attached.\n" +
        "- Do not invent Documentation gaps subsections from code inspection; state that scan evidence is unavailable."
    );
  } else {
    sections.push(
      `### ${knowledgeGapsSourceLabelScan()}\n` +
        "- No automated knowledge-gap scan attached.\n" +
        "- Focus file excerpts are attached — audit docs/ownership/default-on risks visible in those excerpts. Do not claim the code is missing."
    );
  }
  if (confluence) {
    sections.push(
      `### ${knowledgeGapsSourceLabelConfluence()} (${ORG_DOCS_EVIDENCE_LABEL})\n` +
        (confluence.error
          ? `- Error: ${confluence.error}`
          : confluence.pages?.length
            ? confluence.pages
                .slice(0, 15)
                .map((page) => formatOpenedDocLine(page.title, page.excerpt))
                .join("\n") + truncationNote(confluence.pages.length, 15)
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
                .map(
                  (issue) =>
                    formatOpenedDocLine(
                      `${issue.key} (${issue.status}): ${issue.summary}`,
                      issue.description
                    )
                )
                .join("\n") + truncationNote(jira.issues.length, 15)
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
                .map((message) =>
                  formatOpenedDiscussionLine(
                    message.channelName ? `#${message.channelName}` : "Slack",
                    message.text,
                    message.threadOpened === true
                  )
                )
                .join("\n") + truncationNote(slack.messages.length, 10)
            : "- No matching Slack discussions")
    );
  }
  if (notion) {
    sections.push(
      `### ${knowledgeGapsSourceLabelNotion()} (${ORG_DOCS_EVIDENCE_LABEL})\n` +
        (notion.error
          ? `- Error: ${notion.error}`
          : notion.pages?.length
            ? notion.pages
                .slice(0, 15)
                .map((page) => formatOpenedDocLine(page.title, page.excerpt))
                .join("\n") + truncationNote(notion.pages.length, 15)
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
                .map((doc) => formatOpenedDocLine(doc.title, doc.excerpt))
                .join("\n") + truncationNote(googleDocs.documents.length, 15)
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
                .map((message) =>
                  formatOpenedDiscussionLine(
                    message.fromUserName ?? "Teams",
                    message.text ?? message.body ?? "",
                    message.threadOpened === true
                  )
                )
                .join("\n") + truncationNote(teams.messages.length, 10)
            : "- No matching Teams discussions")
    );
  }
  if (evidence.ownershipReport) {
    sections.push(
      `### ${knowledgeGapsSourceLabelOwnership()}\n` +
        formatOwnershipReportForPrompt(evidence.ownershipReport)
    );
  }
  if (evidence.dependencyGraph) {
    const deps = evidence.dependencyGraph.directDependents ?? [];
    sections.push(
      `### ${knowledgeGapsSourceLabelDependencies()}\n` +
        (deps.length
          ? `- Retrieved file dependencies (${deps.length}; sample, not complete caller coverage):\n${deps.slice(0, 15).map((dep) => `  - ${dep}`).join("\n")}` +
            truncationNote(deps.length, 15)
          : `- Indexed edges: ${evidence.dependencyGraph.edgeCount ?? 0} (no file dependencies listed)`) +
        `\n- Graph provenance: ${evidence.dependencyGraph.source ?? "unknown"}. Symbol use is unverified in this file-level evidence; do not call these named-function callers or claim behavior propagates without traced symbol use, relevant inputs and expected contract.`
    );
  }
  if (evidence.warnings?.length) {
    sections.push("### Warnings\n" + evidence.warnings.map((warning) => `- ${warning}`).join("\n"));
  }
  return sections.join("\n\n");
}

const OPENED_ARTIFACT_BODY_CHARS = 1_200;

/** Opened doc/ticket body for Gaps — title alone is not enough. */
function formatOpenedDocLine(title: string, body: string | undefined): string {
  const clipped = body?.trim()
    ? body.trim().length > OPENED_ARTIFACT_BODY_CHARS
      ? `${body.trim().slice(0, OPENED_ARTIFACT_BODY_CHARS)}…`
      : body.trim()
    : undefined;
  return `- ${title}\n  Body: ${clipped ?? "not attached."}`;
}

/** Opened Slack/Teams thread — search snippet without threadOpened is not a decision. */
function formatOpenedDiscussionLine(
  label: string,
  text: string,
  threadOpened: boolean
): string {
  if (threadOpened && text.trim()) {
    const clipped =
      text.trim().length > OPENED_ARTIFACT_BODY_CHARS
        ? `${text.trim().slice(0, OPENED_ARTIFACT_BODY_CHARS)}…`
        : text.trim();
    return `- ${label}\n  Body: ${clipped}`;
  }
  return `- ${label}\n  Body: not attached.`;
}

function formatFocusFileExcerpts(
  files: KnowledgeGapsEvidence["focusFiles"]
): string | undefined {
  const excerpts = (files ?? [])
    .filter((file) => file.path.trim() && (file.content ?? "").trim())
    .slice(0, 16)
    .map((file) => {
      const body = file.content ?? "";
      // Gather already selects bounded, complete source windows. A second prefix
      // cut can silently discard relevant evidence that was selected.
      const shown = body;
      if (Number.isInteger(file.startLine) && Number(file.startLine) >= 1) {
        const start = Number(file.startLine);
        const sourceLines = shown.split("\n");
        const numbered = sourceLines.map((line, index) => `L${start + index}: ${line}`).join("\n");
        return `#### ${file.path}\nVerified source lines ${start}–${start + sourceLines.length - 1}. Cite implementation claims with numeric start:end:path citation fences using only these supplied lines; omit L prefixes from the quoted code.${file.truncated ? " This is a source window; unshown code was not inspected in synthesis." : ""}\n${numbered}`;
      }
      return `#### ${file.path}\nSource line offsets unavailable. Cite this path without inventing line numbers.\n${shown}`;
    });
  if (excerpts.length === 0) {
    return undefined;
  }
  return `### Focus file excerpts\n${excerpts.join("\n\n")}`;
}
