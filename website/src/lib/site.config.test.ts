import assert from "node:assert/strict";
import { siteConfig } from "./site.config";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
  }
}

test("footer slogan names Coop as a code intelligence agent", () => {
  assert.equal(
    siteConfig.seo.defaultDescription,
    "CoopAI is a code intelligence agent for VS Code. Understand and write code, using context from your entire code stack."
  );
});

test("footer slogan does not keep the old trace-and-owners line", () => {
  assert.equal(siteConfig.seo.defaultDescription.includes("trace decisions"), false);
  assert.equal(siteConfig.seo.defaultDescription.includes("find owners"), false);
});

console.log(`\nsite.config: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
