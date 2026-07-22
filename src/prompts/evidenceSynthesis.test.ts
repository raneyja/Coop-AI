import assert from "node:assert/strict";
import {
  appendCitationKeysSection,
  appendEvidenceEnrichmentInstructions,
  appendEvidenceQualityInstructions,
  appendNarrativeCitationInstructions,
  appendSupplementarySourceCitationGuardrails,
  buildSourcesChecklistFromKeys,
  EVIDENCE_CITATION_RULES,
  extractCitationKeysFromSourcesSection,
  GENERAL_CHAT_EVIDENCE_RULES,
  NARRATIVE_CITATION_RULES,
  stripDisallowedNarrativeSourceCitations,
  supplementaryKeysOmittedFromChecklist,
  truncationNote
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

test("NARRATIVE_CITATION_RULES reserves source pills for Sources footer", () => {
  assert.match(NARRATIVE_CITATION_RULES, /Sources.*footer/i);
  assert.match(NARRATIVE_CITATION_RULES, /at most 1-2 inline/i);
  assert.match(NARRATIVE_CITATION_RULES, /do \*\*not\*\* use/i);
});

test("EVIDENCE_CITATION_RULES includes narrative citation rules", () => {
  assert.match(EVIDENCE_CITATION_RULES, /Narrative citation rules/i);
  assert.match(EVIDENCE_CITATION_RULES, /quality and confidence/i);
});

test("appendEvidenceQualityInstructions adds Evidence quality section", () => {
  const lines: string[] = [];
  appendEvidenceQualityInstructions(lines);
  const section = lines.join("\n");
  assert.ok(section.includes("## Evidence quality"));
  assert.ok(section.includes("responsibly concluded"));
  assert.ok(section.includes("strong / medium / weak / limited"));
  assert.ok(section.includes("missing PR, issue, discussion, or documentation"));
  assert.ok(section.includes("provenance"));
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

test("appendNarrativeCitationInstructions forbids pills outside Sources", () => {
  const lines: string[] = [];
  appendNarrativeCitationInstructions(lines);
  const section = lines.join("\n");
  assert.ok(section.includes("## Narrative citation rules"));
  assert.ok(section.includes("Do **not** use"));
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

test("GENERAL_CHAT_EVIDENCE_RULES covers citations, strength, empty integrations, and source weighting", () => {
  assert.match(GENERAL_CHAT_EVIDENCE_RULES, /strong, medium, weak, or limited/i);
  assert.match(GENERAL_CHAT_EVIDENCE_RULES, /<empty>/);
  assert.match(GENERAL_CHAT_EVIDENCE_RULES, /pull requests and commit history/i);
  assert.match(GENERAL_CHAT_EVIDENCE_RULES, /Slack\/Teams/i);
  assert.match(GENERAL_CHAT_EVIDENCE_RULES, /Never invent ticket IDs, PR numbers/i);
  assert.match(GENERAL_CHAT_EVIDENCE_RULES, /Cite concrete file paths/i);
});

console.log(`\nevidenceSynthesis: ${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  process.exit(1);
}
