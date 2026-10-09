import assert from "node:assert/strict";
import {
  languageFromFilePath,
  languageTagMatchesPath,
  normalizeNumberedCitationFences,
  locatorFromProseLine,
  resolveCitePathForLanguageFence,
  tryParseCitationLocator,
  tryParseFenceInfoLocator
} from "./codeCitationLocator";
import { lightHighlight } from "./lightHighlight";
import { tryParseCitationLocator as adminLocator } from "../../../admin/src/lib/codeCitationLocator";
import { tryParseCitationLocator as websiteLocator } from "../../../website/src/lib/codeCitationLocator";
import { normalizeNumberedCitationFences as adminNormalize } from "../../../admin/src/lib/codeCitationLocator";
import { normalizeNumberedCitationFences as websiteNormalize } from "../../../website/src/lib/codeCitationLocator";

let passed = 0;
let failed = 0;

test("numbered source paths cannot become citation locators", () => {
  for (const parse of [tryParseCitationLocator, adminLocator, websiteLocator]) {
    for (const row of ["3|packages/prisma/generated/types.ts", "3 | src/config.ts", "3|src/config.ts:4", "1:2:3|src/config.ts"]) {
      assert.equal(parse(row), null, row);
    }
  }
});

test("numbered footer recovery is bounded to explicit source labels and ordered rows", () => {
  for (const normalize of [normalizeNumberedCitationFences, adminNormalize, websiteNormalize]) {
    const raw = "```\n10|export default {\n11|  appDirectory: 'app',\n: apps/remix/react-router.config.ts\n```";
    assert.equal(normalize(raw), "```10:11:apps/remix/react-router.config.ts\nexport default {\n  appDirectory: 'app',\n```");
    assert.equal(normalize(normalize(raw)), normalize(raw));
    assert.equal(normalize("```\n6 | node_modules\n: `.gitignore`\n```"), "```6:6:.gitignore\nnode_modules\n```");
    const base = "```\n4|node_modules\n: .dockerignore\n```";
    for (const rejected of [
      base.replace("4|", "0|"), base.replace("4|", "9007199254740992|"),
      base.replace("4|node_modules", "4|node_modules\n3|.idea"),
      base.replace("4|node_modules", "4|node_modules\n4|.idea"),
      base.replace("4|node_modules", "node_modules"),
      base.replace(": .dockerignore", ": https://example.com"),
      base.replace(": .dockerignore", ": *.ts"),
      base.replace(": .dockerignore", ": unrelated prose"),
      base.replace("```\n", "```patch\n"), base.replace("```\n", "```bash\n"),
      base.replace("```\n", "```1:1:AGENTS.md\n"),
      base.replace("```\n", "```0:1:AGENTS.md\n"),
      base.slice(0, -3)
    ]) assert.equal(normalize(rejected), rejected, rejected);
  }
});

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

test("numeric locator parses path and lines", () => {
  const locator = tryParseCitationLocator(
    "42:68:apps/api/plane/api/middleware/api_authentication.py"
  );
  assert.ok(locator);
  assert.equal(locator?.startLine, 42);
  assert.equal(locator?.endLine, 68);
  assert.equal(locator?.path, "apps/api/plane/api/middleware/api_authentication.py");
});

test("root file coordinates work across extension, admin, and website", () => {
  for (const parse of [tryParseCitationLocator, adminLocator, websiteLocator]) {
    assert.deepEqual(parse("18:26:AGENTS.md"), { path: "AGENTS.md", startLine: 18, endLine: 26 });
    assert.deepEqual(parse("package.json:1-8"), { path: "package.json", startLine: 1, endLine: 8 });
    assert.deepEqual(parse("README.md:42"), { path: "README.md", startLine: 42, endLine: 42 });
    assert.equal(parse("example.com"), null);
    assert.equal(parse("2:1:AGENTS.md"), null);
    assert.equal(parse("1:2:*.md"), null);
    assert.equal(parse("1:2:https://example.com"), null);
  }
});

test("path:range locator parses Cursor form", () => {
  const locator = tryParseCitationLocator(
    "apps/space/components/issues/issue-layouts/utils.tsx:4-14"
  );
  assert.ok(locator);
  assert.equal(locator?.startLine, 4);
  assert.equal(locator?.endLine, 14);
  assert.equal(locator?.path, "apps/space/components/issues/issue-layouts/utils.tsx");
});

test("backtick-wrapped numeric locator parses", () => {
  const locator = tryParseCitationLocator(
    "`1:11:apps/web/core/components/issues/issue-layouts/filters/applied-filters/state-group.tsx`"
  );
  assert.ok(locator);
  assert.equal(locator?.startLine, 1);
  assert.equal(locator?.endLine, 11);
  assert.equal(
    locator?.path,
    "apps/web/core/components/issues/issue-layouts/filters/applied-filters/state-group.tsx"
  );
});

test("language-prefixed info-string locator parses", () => {
  const locator = tryParseFenceInfoLocator(
    "tsx 4:14:apps/space/components/issues/issue-layouts/utils.tsx"
  );
  assert.ok(locator);
  assert.equal(locator?.startLine, 4);
  assert.equal(locator?.path, "apps/space/components/issues/issue-layouts/utils.tsx");
});

test("prose See `path` is not a locator", () => {
  assert.equal(
    tryParseCitationLocator("See `packages/lib/server-only/public-api/get-api-token-by-token.ts`:"),
    null
  );
});

test("bold-wrapped path parses as locator", () => {
  const locator = tryParseCitationLocator(
    "**apps/space/components/issues/issue-layouts/utils.tsx**"
  );
  assert.ok(locator);
  assert.equal(locator?.path, "apps/space/components/issues/issue-layouts/utils.tsx");
});

test("placeholder locator recovers path without lines", () => {
  const locator = tryParseCitationLocator(
    "startLine:endLine:apps/api/plane/api/middleware/api_authentication.py"
  );
  assert.ok(locator);
  assert.equal(locator?.path, "apps/api/plane/api/middleware/api_authentication.py");
  assert.equal(locator?.startLine, undefined);
  assert.equal(locator?.endLine, undefined);
});

test("language tags are not citations", () => {
  assert.equal(tryParseCitationLocator("typescript"), null);
  assert.equal(tryParseCitationLocator("python"), null);
  assert.equal(tryParseCitationLocator("TEXT"), null);
});

test("path-only locator works", () => {
  const locator = tryParseCitationLocator("src/webview/ChatPanel.tsx");
  assert.ok(locator);
  assert.equal(locator?.path, "src/webview/ChatPanel.tsx");
});

test("languageFromFilePath maps py to python", () => {
  assert.equal(languageFromFilePath("apps/api/foo.py"), "python");
  assert.equal(languageFromFilePath("src/a.tsx"), "typescript");
});

test("javascript tag matches typescript path (family)", () => {
  assert.equal(
    languageTagMatchesPath("javascript", "packages/lib/jobs/send-signing-email.ts"),
    true
  );
});

test("resolveCitePath upgrades javascript fence for open .ts file", () => {
  const path = resolveCitePathForLanguageFence({
    language: "javascript",
    code: "export const X = 1;",
    lines: ["Here's a relevant code snippet:", "```javascript"],
    fenceStartIndex: 1,
    activeFilePath: "packages/lib/jobs/send-signing-email.ts"
  });
  assert.equal(path, "packages/lib/jobs/send-signing-email.ts");
});

test("lightHighlight colors javascript keywords", () => {
  const tokens = lightHighlight("export const x = 'hi';", "javascript");
  assert.ok(tokens.some((t) => t.text === "export" && t.kind === "keyword"));
  assert.ok(tokens.some((t) => t.text === "'hi'" && t.kind === "string"));
});

test("lightHighlight colors go-like unknown langs instead of monochrome", () => {
  const tokens = lightHighlight("func main() {\n  return\n}", "go");
  assert.ok(tokens.some((t) => t.kind === "keyword"));
});

test("comment-prefixed path:range locators still parse", () => {
  const slash = locatorFromProseLine("// src/server/authMiddleware.ts:70-80");
  assert.ok(slash);
  assert.equal(slash?.startLine, 70);
  assert.equal(slash?.endLine, 80);
  assert.equal(slash?.path, "src/server/authMiddleware.ts");

  const hash = tryParseCitationLocator("# 57:66:src/server/integrationApi.ts");
  assert.ok(hash);
  assert.equal(hash?.startLine, 57);
  assert.equal(hash?.path, "src/server/integrationApi.ts");
});

console.log(`\ncodeCitationLocator: ${passed}/${passed + failed} tests ${failed === 0 ? "passed" : "FAILED"}`);
if (failed > 0) {
  process.exit(1);
}
