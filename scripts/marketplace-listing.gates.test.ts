/**
 * CI gate: Marketplace listing fields must stay correct in package.json + README.
 * Live gallery overwrites from the VSIX on every publish.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

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

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  description?: string;
  categories?: string[];
  publisher?: string;
  name?: string;
};

const readme = readFileSync(join(root, "README.md"), "utf8");
const stackAsset = join(root, "website/public/screenshots/docs/extension-from-your-stack.png");
const stackUrl = "https://coop-ai.dev/screenshots/docs/extension-from-your-stack.png";

test("publisher and extension id stay coop-ai.coop-ai", () => {
  assert.equal(pkg.publisher, "coop-ai");
  assert.equal(pkg.name, "coop-ai");
});

test("categories are exactly AI then Chat (no Machine Learning)", () => {
  assert.deepEqual(pkg.categories, ["AI", "Chat"]);
});

test("short description leads with AI Code intelligence + zero-clone framing", () => {
  const description = pkg.description ?? "";
  assert.match(description, /^AI Code intelligence for VS Code\./);
  assert.match(description, /without downloading to your local machine/i);
});

test("README opener matches Marketplace overview copy", () => {
  assert.match(readme, /^# CoopAI\n\nAI Code intelligence for VS Code\.\n/);
  assert.match(
    readme,
    /Understand, write, search, and edit code from any codehost, without downloading to your local machine\. Add context from any tool within your stack to improve accuracy\./
  );
  assert.match(readme, /CoopAI answers from an indexed remote map plus on-demand file fetches\./);
});

test("README first image is the Stack banner (not the old sidebar screenshot)", () => {
  const firstImage = readme.match(/!\[[^\]]*\]\(([^)]+)\)/);
  assert.ok(firstImage, "README must include at least one image");
  assert.equal(firstImage![1], stackUrl);
  assert.equal(readme.includes("extension-sidebar-light.png"), false);
});

test("Stack banner asset exists for website deploy", () => {
  assert.equal(existsSync(stackAsset), true, `missing ${stackAsset}`);
});

console.log(`\nmarketplace-listing gates: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
