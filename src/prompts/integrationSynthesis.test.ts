import assert from "node:assert/strict";
import {
  countIntegrationResults,
  emptyIntegrationSlashResponse,
  rewriteGoogleDocsSlashIfRepoLeak
} from "./integrationSynthesis";

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

test("countIntegrationResults is zero when Google Docs search is empty", () => {
  assert.equal(countIntegrationResults("google-docs", { documents: [] }), 0);
  assert.equal(countIntegrationResults("google-docs", {}), 0);
});

test("empty /docs reply never falls back to repo code", () => {
  const text = emptyIntegrationSlashResponse("google-docs", { documents: [] });
  assert.match(text, /Google Docs has no documents matching this ask/);
  assert.match(text, /not the repository/);
  assert.equal(/api_authentication|\.py|\.ts/.test(text), false);
});

test("rewriteGoogleDocsSlashIfRepoLeak strips invented auth.js paths", () => {
  const leaked = `The middleware lives in src/middleware/auth.js and validates tokens.`;
  const rewritten = rewriteGoogleDocsSlashIfRepoLeak(leaked, ["Coop AI — Architecture Overview"]);
  assert.match(rewritten, /\/docs searches Google Docs only/);
  assert.ok(!rewritten.includes("src/middleware/auth.js"));
  assert.ok(rewritten.includes("Coop AI — Architecture Overview"));
});

test("rewriteGoogleDocsSlashIfRepoLeak keeps a docs-only answer", () => {
  const ok = `**Answer**\nSee "Coop AI — Architecture Overview" for the high-level product story. It does not describe auth middleware.`;
  assert.equal(rewriteGoogleDocsSlashIfRepoLeak(ok, ["Coop AI — Architecture Overview"]), ok);
});

const total = passed + failed;
console.log(`\nintegrationSynthesis: ${passed}/${total} tests passed`);
if (failed > 0) {
  process.exit(1);
}
