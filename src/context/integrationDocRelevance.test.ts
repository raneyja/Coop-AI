import assert from "node:assert/strict";
import {
  filterDocPagesForUseRepo,
  sanitizeIntegrationSnippet,
  scoreDocPageForUseRepo
} from "./integrationDocRelevance";

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

test("sanitizeIntegrationSnippet removes replacement chars and highlight markers", () => {
  const out = sanitizeIntegrationSnippet("Hello \uFFFD world @@@hl@@@x@@@endhl@@@");
  assert.equal(out, "Hello world x");
});

test("filterDocPagesForUseRepo prefers Use-repo pages over Coop bleed", () => {
  const filtered = filterDocPagesForUseRepo(
    [
      { title: "Coop AI Demo templates", excerpt: "ADR \uFFFD\uFE0F" },
      { title: "Plane notifications", excerpt: "unrelated" },
      { title: "Documenso runbook", excerpt: "signing status for documenso" }
    ],
    { repo: "documenso", focusTerms: ["signing"] }
  );
  assert.equal(filtered.length, 1);
  assert.match(filtered[0]!.title, /Documenso/i);
  assert.ok(!filtered[0]!.excerpt?.includes("\uFFFD"));
});

test("filterDocPagesForUseRepo keeps Coop pages when Use-repo is Coop-AI", () => {
  const filtered = filterDocPagesForUseRepo(
    [{ title: "Coop AI — Architecture Overview", excerpt: "ADR" }],
    { owner: "raneyja", repo: "Coop-AI" }
  );
  assert.equal(filtered.length, 1);
});

test("scoreDocPageForUseRepo boosts focus term matches", () => {
  const base = scoreDocPageForUseRepo(
    { title: "Documenso overview", excerpt: "general" },
    { repo: "documenso" }
  );
  const focused = scoreDocPageForUseRepo(
    { title: "Documenso overview", excerpt: "signing status" },
    { repo: "documenso", focusTerms: ["signing"] }
  );
  assert.ok(focused > base);
});

const total = passed + failed;
console.log(`\nintegrationDocRelevance: ${passed}/${total} tests passed`);
if (failed > 0) {
  process.exit(1);
}
