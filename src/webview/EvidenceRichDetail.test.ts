import assert from "node:assert/strict";
import type { DecisionRationaleRank } from "../types/decisionTimeline";
import {
  groupRationaleByRole,
  parseEvidenceTargetMeta,
  resolveEvidenceTargetMetaLabel,
  summarizeEvidenceEvolution
} from "./EvidenceRichDetail";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (error) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${error instanceof Error ? error.message : String(error)}`);
  }
}

test("parseEvidenceTargetMeta extracts file lines and repo", () => {
  const parsed = parseEvidenceTargetMeta("src/chat/session.ts:12-24 · coop-ai/extension");
  assert.equal(parsed?.file, "src/chat/session.ts");
  assert.equal(parsed?.lines, "lines 12-24");
  assert.equal(parsed?.repo, "coop-ai/extension");
});

test("resolveEvidenceTargetMetaLabel keeps detailed meta when target overlaps", () => {
  const merged = resolveEvidenceTargetMetaLabel(
    "src/chat/session.ts · lines 12-24 · coop-ai/extension",
    "src/chat/session.ts"
  );
  assert.equal(merged, "src/chat/session.ts · lines 12-24 · coop-ai/extension");
});

test("summarizeEvidenceEvolution formats touched count and last change", () => {
  const summary = summarizeEvidenceEvolution({
    commitCountSinceIntroduction: 4,
    lastModifiedAt: "2026-06-18T12:30:00Z",
    lastModifiedAuthor: "@dana"
  });
  assert.equal(summary, "Touched 4 times since introduction; last change 2026-06-18 by @dana");
});

test("groupRationaleByRole orders rationale provenance background", () => {
  const ranks: DecisionRationaleRank[] = [
    { source: "jira:COOP-12", role: "background", label: "Jira COOP-12" },
    { source: "pr:410", role: "rationale", label: "PR #410" },
    { source: "commit:abc1234", role: "provenance", label: "Commit abc1234" }
  ];
  const grouped = groupRationaleByRole(ranks);
  assert.deepEqual(grouped.map((entry) => entry.role), [
    "rationale",
    "provenance",
    "background"
  ]);
});

const total = passed + failed;
console.log(`\nEvidenceRichDetail: ${passed}/${total} tests passed`);
if (failed > 0) {
  process.exit(1);
}
