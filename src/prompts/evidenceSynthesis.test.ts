import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { agentSearchSkipNote, buildAgentAnswerPrompt } from "../api/agent/parseAgentToolPlan";
import {
  appendCitationKeysSection,
  appendEvidenceEnrichmentInstructions,
  appendEvidenceQualityInstructions,
  appendNarrativeCitationInstructions,
  appendSupplementarySourceCitationGuardrails,
  appendUserFocusInstructions,
  ATTACHED_FACTS_HEADING,
  buildSourcesChecklistFromKeys,
  EVIDENCE_CITATION_RULES,
  extractCitationKeysFromSourcesSection,
  GENERAL_CHAT_EVIDENCE_RULES,
  AGENT_REPO_HUNT_RULES,
  EMPTY_EVIDENCE_HONESTY_RULE,
  NARRATIVE_CITATION_RULES,
  stripDisallowedNarrativeSourceCitations,
  stripTemplateSectionHeadings,
  supplementaryKeysOmittedFromChecklist,
  truncationNote,
  USER_FOCUS_SECTION_TITLE
} from "./evidenceSynthesis";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

test("NARRATIVE_CITATION_RULES keeps source pills out of a Sources footer", () => {
  assert.match(NARRATIVE_CITATION_RULES, /Do not emit a \*\*Sources\*\* section/i);
  assert.match(NARRATIVE_CITATION_RULES, /at most 1-2 inline/i);
  assert.match(NARRATIVE_CITATION_RULES, /plain language/i);
});

test("EVIDENCE_CITATION_RULES includes narrative citation rules", () => {
  assert.match(EVIDENCE_CITATION_RULES, /Narrative citation rules/i);
  assert.match(EVIDENCE_CITATION_RULES, /quality and confidence/i);
});

test("appendEvidenceQualityInstructions adds grounding without intern-speak", () => {
  const lines: string[] = [];
  appendEvidenceQualityInstructions(lines);
  const section = lines.join("\n");
  assert.ok(section.includes("## Grounding"));
  assert.ok(section.includes("Answer only from attached facts"));
  assert.ok(section.includes("missing PR, issue, discussion, or documentation"));
  assert.ok(section.includes("inference"));
  assert.equal(section.includes("evidence bundle"), false);
  assert.equal(section.includes("evidence strength (strong / medium / weak"), false);
});

test("appendUserFocusInstructions requires opening prose for specific asks", () => {
  const lines: string[] = [];
  appendUserFocusInstructions(lines, "how does a work item flow from create → board?");
  const section = lines.join("\n");
  assert.ok(section.includes("## User focus (required)"));
  assert.ok(section.includes("how does a work item flow from create → board?"));
  assert.ok(section.includes("Do not add a **Your question**, **Answer**, or **Summary** heading"));
  assert.ok(section.includes("primary deliverable"));
  assert.ok(section.includes("## Section quality gates (strict pass / fail)"));
  assert.ok(section.includes("PASS:"));
  assert.ok(section.includes("FAIL:"));
  assert.ok(section.includes("generic SaaS narrative"));
  assert.ok(section.includes("restates, paraphrases, or truncates the user's question"));
  assert.ok(section.includes("Opening prose"));
  assert.equal(section.includes(`include a dedicated **${USER_FOCUS_SECTION_TITLE}**`), false);
});

test("stripTemplateSectionHeadings drops Answer/Summary/Your question titles", () => {
  const stripped = stripTemplateSectionHeadings(
    "**Answer**\n\nAuth lives in `src/auth.ts`.\n\n**Your question**\n\nWhere is auth?\n\n**How it works**\n- middleware"
  );
  assert.equal(stripped.includes("**Answer**"), false);
  assert.equal(stripped.includes("**Your question**"), false);
  assert.ok(stripped.includes("Auth lives in `src/auth.ts`."));
  assert.ok(stripped.includes("**How it works**"));
});

test("appendUserFocusInstructions is a no-op when focus is empty", () => {
  const lines: string[] = [];
  appendUserFocusInstructions(lines, "  ");
  appendUserFocusInstructions(lines, undefined);
  assert.equal(lines.length, 0);
});

test("buildSourcesChecklistFromKeys replaces default line when extra matches citation key", () => {
  const checklist = buildSourcesChecklistFromKeys(
    ["[Sources: Dependency graph]", "[Sources: Test files]"],
    ["[Sources: Dependency graph] — Index coverage is partial; dependency impact may be incomplete."]
  );
  assert.equal(checklist.length, 2);
  assert.equal(
    checklist[0],
    "[Sources: Dependency graph] — Index coverage is partial; dependency impact may be incomplete."
  );
  assert.ok(checklist[1].includes("summarize what this source contributed"));
});

test("appendCitationKeysSection steers keys to Sources footer", () => {
  const lines: string[] = [];
  appendCitationKeysSection(lines, ["[Sources: GitHub]"]);
  assert.ok(lines.some((line) => line.includes("## Citation keys")));
  assert.ok(lines.some((line) => line.includes("[Sources: GitHub]")));
  assert.ok(lines.some((line) => line.includes("at most 1-2")));
});

test("appendEvidenceEnrichmentInstructions adds Evidence enrichment section when enrichment is present", () => {
  const lines: string[] = [];
  appendEvidenceEnrichmentInstructions(lines, true);
  const section = lines.join("\n");
  assert.ok(section.includes("## Evidence enrichment"));
  assert.ok(section.includes("targetLabel"));
  assert.ok(section.includes("introducingDiffSummary"));
  assert.ok(section.includes("evolution.commitCountSinceIntroduction"));
  assert.ok(section.includes("primary rationale source"));
  assert.ok(section.includes("pathEvolution"));
});

test("appendEvidenceEnrichmentInstructions is gated off when no enrichment is present", () => {
  const lines: string[] = [];
  appendEvidenceEnrichmentInstructions(lines, false);
  assert.equal(lines.length, 0);
});

test("truncationNote flags omitted rows only past the shown limit", () => {
  assert.equal(truncationNote(3, 5), "");
  assert.equal(truncationNote(5, 5), "");
  assert.equal(truncationNote(8, 5), "\n- …and 3 more (omitted)");
});

test("appendSupplementarySourceCitationGuardrails omits narrative citations for absent checklist keys", () => {
  const lines: string[] = [];
  appendSupplementarySourceCitationGuardrails(
    lines,
    ["[Sources: Anchor files] — summarize what this source contributed to your answer"],
    ["[Sources: Ownership signals]", "[Sources: Dependency graph]"]
  );
  const section = lines.join("\n");
  assert.ok(section.includes("## Citation guardrails"));
  assert.ok(section.includes("[Sources: Ownership signals]"));
  assert.ok(section.includes("[Sources: Dependency graph]"));
  assert.ok(section.includes("absent"));
});

test("appendNarrativeCitationInstructions forbids a Sources footer", () => {
  const lines: string[] = [];
  appendNarrativeCitationInstructions(lines);
  const section = lines.join("\n");
  assert.ok(section.includes("## Narrative citation rules"));
  assert.ok(section.includes("Do **not** emit a **Sources** footer"));
});

test("supplementaryKeysOmittedFromChecklist returns keys missing from checklist", () => {
  const omitted = supplementaryKeysOmittedFromChecklist(
    ["[Sources: Anchor files]", "[Sources: Ownership signals]"],
    ["[Sources: Anchor files] — summarize"]
  );
  assert.deepEqual(omitted, ["[Sources: Ownership signals]"]);
});

test("stripDisallowedNarrativeSourceCitations removes pills from narrative sections", () => {
  const input = [
    "**Summary**",
    "Repo overview [Sources: Anchor files] with extra [Sources: Ownership signals].",
    "",
    "**Architecture**",
    "Uses patterns from [Sources: Ownership signals] and [Sources: Dependency graph].",
    "",
    "**Sources**",
    "- [Sources: Anchor files] — anchor files loaded",
    "- [Sources: Ownership signals] — ownership context"
  ].join("\n");
  const stripped = stripDisallowedNarrativeSourceCitations(input);
  assert.ok(!stripped.includes("Architecture**\nUses patterns from [Sources:"));
  assert.ok(stripped.includes("[Sources: Anchor files] — anchor files loaded"));
  assert.match(stripped, /Summary[\s\S]*\[Sources: Anchor files\]/);
  assert.ok(!stripped.includes("[Sources: Dependency graph]"));
});

test("extractCitationKeysFromSourcesSection reads allowed keys", () => {
  const keys = extractCitationKeysFromSourcesSection(
    "**Sources**\n- [Sources: GitHub commit abc1234] — intro\n- [Sources: PR #99] — review"
  );
  assert.deepEqual(keys, ["[Sources: GitHub commit abc1234]", "[Sources: PR #99]"]);
});

test("GENERAL_CHAT_EVIDENCE_RULES covers citations, empty integrations, and source weighting", () => {
  assert.match(GENERAL_CHAT_EVIDENCE_RULES, /came back empty/i);
  assert.match(GENERAL_CHAT_EVIDENCE_RULES, /pull requests and commit history/i);
  assert.match(GENERAL_CHAT_EVIDENCE_RULES, /Slack\/Teams/i);
  assert.match(GENERAL_CHAT_EVIDENCE_RULES, /Never invent ticket IDs, PR numbers/i);
  assert.match(GENERAL_CHAT_EVIDENCE_RULES, /Cite concrete file paths/i);
  assert.match(GENERAL_CHAT_EVIDENCE_RULES, /this isn.t a full count/i);
  assert.match(GENERAL_CHAT_EVIDENCE_RULES, /how many/i);
  assert.doesNotMatch(GENERAL_CHAT_EVIDENCE_RULES, /search sample was empty/i);
  assert.doesNotMatch(GENERAL_CHAT_EVIDENCE_RULES, /search samples \/ capped result sets/i);
  assert.doesNotMatch(GENERAL_CHAT_EVIDENCE_RULES, /strong, medium, weak, or limited/i);
});

test("AGENT_REPO_HUNT_RULES forbids inventing absences and restating the ask", () => {
  assert.match(AGENT_REPO_HUNT_RULES, /index miss/i);
  assert.match(AGENT_REPO_HUNT_RULES, /absent from the repository/i);
  assert.match(AGENT_REPO_HUNT_RULES, /I couldn.t find \{symbol\} in this repo/i);
  assert.match(AGENT_REPO_HUNT_RULES, /restating|paraphrasing/i);
  assert.match(AGENT_REPO_HUNT_RULES, /Do not use a \*\*Your question\*\* heading/);
  assert.match(AGENT_REPO_HUNT_RULES, /bodies were not attached/);
  assert.match(AGENT_REPO_HUNT_RULES, /clone/i);
  assert.match(AGENT_REPO_HUNT_RULES, /ValidationError/);
  assert.match(AGENT_REPO_HUNT_RULES, /OpenAPI/i);
  assert.doesNotMatch(AGENT_REPO_HUNT_RULES, /index returned no usable/i);
});

test("hunt answer prompt and skipNote use teammate miss copy", () => {
  const prompt = buildAgentAnswerPrompt({ message: "Where is requireAuth?" });
  assert.match(prompt, /couldn.t find that symbol in this repo/i);
  assert.match(prompt, /one talk track/i);
  assert.match(prompt, /Never leave a \*\*Heading\*\* with an empty body/);
  assert.match(prompt, /bodies were not attached/);
  assert.match(prompt, /Path-only search hits are not ripples/);
  assert.match(prompt, /57:66:src\/server\/integrationApi\.ts/);
  assert.doesNotMatch(prompt, /never conclude the team never decided/i);
  assert.doesNotMatch(prompt, /title and status alone/i);
  assert.doesNotMatch(prompt, /body was not attached/i);
  const withBody = buildAgentAnswerPrompt({
    message: "Where is requireAuth?",
    openedEvidence: "COOP-101\nBody: Chose GitHub App over PAT."
  });
  assert.match(withBody, /Opened artifacts/);
  assert.match(withBody, /Chose GitHub App over PAT/);
  assert.doesNotMatch(prompt, /index returned no usable/i);
  const skip = agentSearchSkipNote(["requireAuth"]);
  assert.match(skip, /couldn.t find that symbol in this repo/i);
  assert.doesNotMatch(skip, /index returned no usable/i);
});

test("synthesis builders do not use a writer-facing Evidence bundle heading", () => {
  assert.equal(ATTACHED_FACTS_HEADING, "## What we found");
  const files = [
    "src/prompts/decisionSynthesis.ts",
    "src/prompts/ownershipSynthesis.ts",
    "src/prompts/blastRadiusSynthesis.ts",
    "src/prompts/knowledgeGapsSynthesis.ts",
    "src/prompts/integrationSynthesis.ts"
  ];
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    assert.equal(src.includes("## Evidence bundle"), false, file);
    assert.ok(src.includes("ATTACHED_FACTS_HEADING"), file);
  }
});

test("empty-evidence honesty quotes Body and forbids timeout jargon", () => {
  assert.match(EMPTY_EVIDENCE_HONESTY_RULE, /Quote Body/);
  assert.match(EMPTY_EVIDENCE_HONESTY_RULE, /gather budget/);
});

console.log(`\nevidenceSynthesis: ${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  process.exit(1);
}
