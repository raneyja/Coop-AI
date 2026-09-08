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

test("footer blurb is human-readable code intelligence copy", () => {
  assert.match(siteConfig.footerBlurb, /VS Code code intelligence/i);
  assert.match(siteConfig.footerBlurb, /review/i);
  assert.equal(siteConfig.footerBlurb.includes(": Deep-Index"), false);
  assert.equal(siteConfig.footerBlurb.includes("query company Slack and Jira live"), false);
});

test("footer does not reuse the dense SEO meta string", () => {
  assert.notEqual(siteConfig.footerBlurb, siteConfig.seo.defaultDescription);
});

test("footer slogan does not keep the old trace-and-owners line", () => {
  assert.equal(siteConfig.footerBlurb.includes("trace decisions"), false);
  assert.equal(siteConfig.footerBlurb.includes("find owners"), false);
});

console.log(`\nsite.config: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
