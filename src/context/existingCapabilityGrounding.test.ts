import assert from "node:assert/strict";
import {
  buildExistingCapabilitySynthesisUserPrompt,
  enrichExistingCapabilityResponse,
  extractExistingCapabilityEvidence,
  formatExistingCapabilityEvidenceBlock,
  isFeatureAddAsk,
  normalizeCapabilityToken,
  parseAskedCapability,
  shapedEvidenceAllowsAddNew,
  shapedEvidenceRequiresExtend
} from "./existingCapabilityGrounding";

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

/** Fixture mirroring plane issue_relation_mapper.py with blocked_by ↔ blocking. */
const ISSUE_RELATION_MAPPER_WITH_BLOCKED_BY = `
# apps/api/plane/utils/issue_relation_mapper.py

RELATION_TYPE_MAP = {
    "blocking": "blocked_by",
    "blocked_by": "blocking",
    "duplicate": "duplicate",
    "relates_to": "relates_to",
}

def get_inverse_relation(relation_type: str) -> str:
    return RELATION_TYPE_MAP.get(relation_type, relation_type)

# Validation belongs in IssueRelationViewSet — mirror blocking ↔ blocked_by.
`.trim();

const ISSUE_RELATION_MAPPER_WITHOUT_BLOCKED_BY = `
# apps/api/plane/utils/issue_relation_mapper.py

RELATION_TYPE_MAP = {
    "blocking": "blocking",
    "duplicate": "duplicate",
    "relates_to": "relates_to",
}

def get_inverse_relation(relation_type: str) -> str:
    return RELATION_TYPE_MAP.get(relation_type, relation_type)
`.trim();

const SMOKE_ASK =
  "We're adding a blocked by link type so issues can declare what blocks them. Where should validation live?";

test("detects ticket-style blocked-by feature add ask", () => {
  assert.equal(isFeatureAddAsk(SMOKE_ASK), true);
  assert.equal(isFeatureAddAsk("what does this mapper do?"), false);
  assert.equal(isFeatureAddAsk("stuck PENDING → COMPLETED"), false);
});

test("parses blocked by → blocked_by", () => {
  const parsed = parseAskedCapability(SMOKE_ASK);
  assert.ok(parsed);
  assert.equal(parsed!.token, "blocked_by");
  assert.equal(normalizeCapabilityToken("blockedBy"), "blocked_by");
  assert.equal(normalizeCapabilityToken("blocked-by"), "blocked_by");
});

test("open mapper with blocked_by → already-exists + extend synthesis", () => {
  const evidence = extractExistingCapabilityEvidence({
    filePath: "apps/api/plane/utils/issue_relation_mapper.py",
    fileContent: ISSUE_RELATION_MAPPER_WITH_BLOCKED_BY,
    ask: SMOKE_ASK
  });
  assert.ok(evidence);
  assert.equal(evidence!.verdict, "already-exists");
  assert.equal(evidence!.capability, "blocked_by");
  assert.ok(evidence!.hits.length > 0);
  assert.ok(evidence!.hits.some((h) => /blocked_by/i.test(h.snippet)));
  assert.ok(evidence!.relatedSymbols.includes("blocking"));
  assert.ok(evidence!.extendPoints.length > 0);

  const shaped = buildExistingCapabilitySynthesisUserPrompt({
    ask: SMOKE_ASK,
    evidence: evidence!
  });
  assert.ok(shapedEvidenceRequiresExtend(shaped));
  assert.ok(/already exists/i.test(shaped));
  assert.ok(/\bextend\b/i.test(shaped));
  assert.ok(!shapedEvidenceAllowsAddNew(shaped));
  // Must not recommend greenfield add of blocked_by
  assert.ok(/Do \*\*not\*\* propose greenfield/i.test(shaped));
  assert.ok(/IssueRelationViewSet|validation|ViewSet/i.test(shaped));

  const block = formatExistingCapabilityEvidenceBlock(evidence!);
  assert.ok(block.includes("verdict: already-exists"));
  assert.ok(block.includes("blocked_by"));
});

test("mapper without blocked_by → add-new still allowed", () => {
  const evidence = extractExistingCapabilityEvidence({
    filePath: "apps/api/plane/utils/issue_relation_mapper.py",
    fileContent: ISSUE_RELATION_MAPPER_WITHOUT_BLOCKED_BY,
    ask: SMOKE_ASK
  });
  assert.ok(evidence);
  assert.equal(evidence!.verdict, "add-new");
  assert.equal(evidence!.hits.length, 0);

  const shaped = buildExistingCapabilitySynthesisUserPrompt({
    ask: SMOKE_ASK,
    evidence: evidence!
  });
  assert.ok(shapedEvidenceAllowsAddNew(shaped));
  assert.ok(!shapedEvidenceRequiresExtend(shaped));
});

test("does not recommend duplicate when symbol present in open file", () => {
  const evidence = extractExistingCapabilityEvidence({
    filePath: "apps/api/plane/utils/issue_relation_mapper.py",
    fileContent: ISSUE_RELATION_MAPPER_WITH_BLOCKED_BY,
    ask: "Adding a blocked_by relation type for issue links"
  });
  assert.ok(evidence);
  assert.equal(evidence!.verdict, "already-exists");
  const shaped = buildExistingCapabilitySynthesisUserPrompt({
    ask: "Adding a blocked_by relation type for issue links",
    evidence: evidence!
  });
  assert.match(shaped, /duplicate/i);
  assert.match(shaped, /already exists/i);
  assert.ok(!/verdict:\s*add-new/i.test(shaped));
});

test("response enricher prepends already-exists when model goes greenfield", () => {
  const evidence = extractExistingCapabilityEvidence({
    filePath: "apps/api/plane/utils/issue_relation_mapper.py",
    fileContent: ISSUE_RELATION_MAPPER_WITH_BLOCKED_BY,
    ask: SMOKE_ASK
  })!;
  const greenfield = "**Answer**\nAdd a new blocked_by link type to the mapper dict.";
  const enriched = enrichExistingCapabilityResponse(greenfield, evidence);
  assert.ok(/already exists/i.test(enriched));
  assert.ok(/\bextend\b/i.test(enriched));
  assert.ok(enriched.indexOf("Already exists") < enriched.indexOf("Add a new blocked_by"));
});

test("response enricher leaves add-new answers alone", () => {
  const evidence = extractExistingCapabilityEvidence({
    filePath: "apps/api/plane/utils/issue_relation_mapper.py",
    fileContent: ISSUE_RELATION_MAPPER_WITHOUT_BLOCKED_BY,
    ask: SMOKE_ASK
  })!;
  const answer = "**Answer**\nAdd blocked_by to RELATION_TYPE_MAP mirroring blocking.";
  assert.equal(enrichExistingCapabilityResponse(answer, evidence), answer);
});

const total = passed + failed;
console.log(`\nexistingCapabilityGrounding: ${passed}/${total} tests passed`);
if (failed > 0) {
  process.exit(1);
}
