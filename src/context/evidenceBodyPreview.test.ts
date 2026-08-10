import assert from "node:assert/strict";
import {
  buildCodeSnippetPreview,
  buildDeterministicEvidencePreview,
  resolveEvidenceBodyPreview,
  shouldRequestEvidenceAiPreview
} from "./evidenceBodyPreview";
import { sanitizeEvidenceAiOverview } from "./evidencePreviewModel";

async function run(): Promise<void> {
  let passed = 0;
  let failed = 0;
  const test = async (name: string, fn: () => void | Promise<void>) => {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}`);
      console.error(`    ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
  };

  await test("deterministic preview keeps subject and caps mega body", () => {
    const mega = [
      "feat: session auth implementation (#4411)",
      "",
      ...Array.from({ length: 80 }, (_, i) => `* chore: line ${i} empty state for god-mode`)
    ].join("\n");
    const preview = buildDeterministicEvidencePreview(mega);
    assert.ok(preview.startsWith("feat: session auth"));
    assert.ok(preview.length <= 360);
    assert.ok(!preview.includes("line 40"));
  });

  await test("AI overview preferred over raw dump", () => {
    const preview = resolveEvidenceBodyPreview({
      overview: "Session auth mega-PR that also touched many apps.",
      rawText: "feat: session auth\n" + "x".repeat(2000)
    });
    assert.equal(preview, "Session auth mega-PR that also touched many apps.");
  });

  await test("shouldRequestEvidenceAiPreview skips tiny subjects", () => {
    assert.equal(shouldRequestEvidenceAiPreview("fix typo"), false);
    assert.equal(
      shouldRequestEvidenceAiPreview("feat: session auth\n\n" + "x".repeat(400)),
      true
    );
  });

  await test("sanitizeEvidenceAiOverview rejects empty / trims long", () => {
    assert.equal(sanitizeEvidenceAiOverview("  hi  "), undefined);
    const long = "A".repeat(500);
    const cleaned = sanitizeEvidenceAiOverview(long);
    assert.ok(cleaned && cleaned.length <= 360);
  });

  await test("code snippet preview focuses on class and caps lines", () => {
    const lines = [
      "# copyright header",
      "from django.db import models",
      "",
      "class StateGroup(models.TextChoices):",
      "    BACKLOG = \"backlog\", \"Backlog\"",
      "    UNSTARTED = \"unstarted\", \"Unstarted\"",
      ...Array.from({ length: 40 }, (_, i) => `    # filler ${i}`),
      "class State(models.Model):",
      "    name = models.CharField()"
    ];
    const { preview, truncated, startLine } = buildCodeSnippetPreview(lines.join("\n"), {
      focusTerms: ["StateGroup"]
    });
    assert.equal(truncated, true);
    assert.ok(preview.includes("class StateGroup"));
    assert.ok(!preview.includes("filler 35"));
    assert.ok(startLine >= 1);
    assert.ok(preview.split("\n").length <= 16);
  });

  console.log(`\nevidenceBodyPreview: ${passed}/${passed + failed} tests passed`);
  if (failed > 0) {
    process.exit(1);
  }
}

void run();
