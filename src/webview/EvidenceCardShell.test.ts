import assert from "node:assert/strict";
import {
  qualityStatusLabel,
  resolveEvidenceCardHeaderStatus
} from "./EvidenceCardShell";
import { summarizeBlastRadius } from "./evidenceCardSummary";
import type { BlastRadiusEvidence } from "../context/contextBundleEvidence";

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

test("header status prefers summary.quality over completeness-driven statusTone", () => {
  const evidence: BlastRadiusEvidence = {
    file: "src/config/responseDeadline.ts",
    directDependents: ["src/chat/CoopChatSession.ts"],
    graphMeta: { edgeCount: 10, source: "import-parse", lightningEnabled: false },
    completeness: "partial"
  };
  const summary = summarizeBlastRadius(evidence, evidence.file!);
  assert.equal(summary.quality, "strong");

  // Simulate the old Blast card bypass: statusTone from completeness=partial.
  const resolved = resolveEvidenceCardHeaderStatus({
    summary,
    statusTone: "partial",
    statusLabel: "Medium evidence",
    sources: [{ provider: "github", detail: "1 code dependent(s)" }]
  });

  assert.equal(resolved.status, "Strong evidence");
  assert.equal(resolved.statusTone, "default");
  assert.equal(qualityStatusLabel(summary.quality), "Strong evidence");
});

test("without summary, falls back to statusTone/statusLabel", () => {
  const resolved = resolveEvidenceCardHeaderStatus({
    statusTone: "partial",
    statusLabel: "Medium evidence",
    sources: [{ provider: "github", detail: "1 code dependent(s)" }]
  });
  assert.equal(resolved.status, "Medium evidence");
  assert.equal(resolved.statusTone, "partial");
});

console.log(`\nEvidenceCardShell: ${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  process.exit(1);
}
