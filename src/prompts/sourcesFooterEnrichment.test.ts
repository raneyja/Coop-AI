import assert from "node:assert/strict";
import {
  enrichSourcesFooter,
  groupedIntegrationDocLabel,
  MAX_SOURCES_FOOTER_BULLETS,
  sourceBulletPriority,
  VIEW_ALL_SOURCES_LINK
} from "./sourcesFooterEnrichment";

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

test("sourceBulletPriority ranks commits and PRs above doc pages", () => {
  assert.ok(
    sourceBulletPriority("[Sources: GitHub commit abc1234]") <
      sourceBulletPriority("[Sources: PR #42]")
  );
  assert.ok(
    sourceBulletPriority("[Sources: PR #42]") < sourceBulletPriority("[Sources: Confluence pages (3 reviewed)]")
  );
});

test("enrichSourcesFooter groups per-page Confluence bullets", () => {
  const input = [
    "**Summary**",
    "Evidence is medium.",
    "",
    "**Sources**",
    "- [Sources: Confluence ADR 1] — first page",
    "- [Sources: Confluence ADR 2] — second page",
    "- [Sources: Confluence ADR 3] — third page"
  ].join("\n");

  const enriched = enrichSourcesFooter(input);
  assert.ok(enriched.includes(groupedIntegrationDocLabel("Confluence", 3)));
  assert.equal((enriched.match(/- \[Sources: Confluence ADR/g) ?? []).length, 0);
});

test(`enrichSourcesFooter keeps top ${MAX_SOURCES_FOOTER_BULLETS} and adds view-all link`, () => {
  const input = [
    "**Summary**",
    "Done.",
    "",
    "**Sources**",
    "- [Sources: Confluence A] — a",
    "- [Sources: Confluence B] — b",
    "- [Sources: Notion C] — c",
    "- [Sources: GitHub commit deadbeef] — commit",
    "- [Sources: PR #99] — pr"
  ].join("\n");

  const enriched = enrichSourcesFooter(input);
  const bullets = enriched
    .split("\n")
    .filter((line) => line.trimStart().startsWith("- [Sources:"));
  assert.equal(bullets.length, MAX_SOURCES_FOOTER_BULLETS);
  assert.ok(enriched.includes(VIEW_ALL_SOURCES_LINK));
  assert.ok(bullets.some((line) => line.includes("GitHub commit")));
  assert.ok(bullets.some((line) => line.includes("PR #99")));
});

test("enrichSourcesFooter leaves three-or-fewer bullets unchanged when already grouped", () => {
  const input = [
    "**Summary**",
    "Done.",
    "",
    "**Sources**",
    "- [Sources: GitHub commit abc1234] — commit",
    "- [Sources: PR #1] — pr"
  ].join("\n");

  assert.equal(enrichSourcesFooter(input), input);
});

if (failed > 0) {
  console.error(`\nsourcesFooterEnrichment: ${failed} failed, ${passed} passed`);
  process.exit(1);
}

console.log(`sourcesFooterEnrichment: ${passed} passed`);
