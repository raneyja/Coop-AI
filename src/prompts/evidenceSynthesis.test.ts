import assert from "node:assert/strict";
import {
  appendCitationKeysSection,
  appendEvidenceEnrichmentInstructions,
  appendEvidenceQualityInstructions,
  EVIDENCE_CITATION_RULES,
  EVIDENCE_ENRICHMENT_RULES,
  EVIDENCE_QUALITY_RULES,
  GENERAL_CHAT_EVIDENCE_RULES
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

test("EVIDENCE_QUALITY_RULES covers strength, provenance, and missing evidence", () => {
  assert.match(EVIDENCE_QUALITY_RULES, /strong, medium, weak, or limited/i);
  assert.match(EVIDENCE_QUALITY_RULES, /provenance/i);
  assert.match(EVIDENCE_QUALITY_RULES, /rationale/i);
  assert.match(EVIDENCE_QUALITY_RULES, /missing evidence/i);
  assert.match(EVIDENCE_QUALITY_RULES, /Do not repeat the same/i);
});

test("EVIDENCE_CITATION_RULES aligns quality with Sources card", () => {
  assert.match(EVIDENCE_CITATION_RULES, /quality and confidence/i);
  assert.match(EVIDENCE_CITATION_RULES, /Sources card/i);
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
  assert.ok(section.includes("Do not over-cite"));
});

test("appendCitationKeysSection is unchanged for non-empty keys", () => {
  const lines: string[] = [];
  appendCitationKeysSection(lines, ["[Sources: GitHub]"]);
  assert.ok(lines.some((line) => line.includes("## Citation keys")));
  assert.ok(lines.some((line) => line.includes("[Sources: GitHub]")));
});

test("EVIDENCE_ENRICHMENT_RULES covers diff summary, evolution, rationale, and target precision", () => {
  assert.match(EVIDENCE_ENRICHMENT_RULES, /targetLabel/i);
  assert.match(EVIDENCE_ENRICHMENT_RULES, /introducingDiffSummary/i);
  assert.match(EVIDENCE_ENRICHMENT_RULES, /evolution/i);
  assert.match(EVIDENCE_ENRICHMENT_RULES, /rationaleRanking/i);
  assert.match(EVIDENCE_ENRICHMENT_RULES, /pathEvolution/i);
});

test("appendEvidenceEnrichmentInstructions adds Evidence enrichment section", () => {
  const lines: string[] = [];
  appendEvidenceEnrichmentInstructions(lines);
  const section = lines.join("\n");
  assert.ok(section.includes("## Evidence enrichment"));
  assert.ok(section.includes("targetLabel"));
  assert.ok(section.includes("introducingDiffSummary"));
  assert.ok(section.includes("evolution.commitCountSinceIntroduction"));
  assert.ok(section.includes("primary rationale source"));
  assert.ok(section.includes("pathEvolution"));
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
