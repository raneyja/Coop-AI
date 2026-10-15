import assert from "node:assert/strict";
import test from "node:test";
import * as extension from "../src/webview/lib/codeCitationLocator";
import * as admin from "../admin/src/lib/codeCitationLocator";
import * as website from "../website/src/lib/codeCitationLocator";

const surfaces = [extension, admin, website];
test("maintained surfaces parse real locators and retain complete fence source", () => {
  for (const surface of surfaces) {
    assert.deepEqual(surface.tryParseCitationLocator("17:34:src/auth/handler.ts"), {
      path: "src/auth/handler.ts", startLine: 17, endLine: 34
    });
    assert.deepEqual(surface.tryParseFenceInfoLocator("typescript 17:34:src/auth/handler.ts"), {
      path: "src/auth/handler.ts", startLine: 17, endLine: 34
    });
    const body = ["// citation follows", "17:34:src/auth/handler.ts", "const retries = 3;", "const port = 3000;"];
    assert.deepEqual(surface.citationLocatorInFenceBody(body), {
      locator: { path: "src/auth/handler.ts", startLine: 17, endLine: 34 }, codeStart: 2
    });
    assert.equal(body.slice(surface.citationLocatorInFenceBody(body)!.codeStart).join("\n"), "const retries = 3;\nconst port = 3000;");
  }
});

test("maintained surfaces reject glob, malformed range and source-shaped locator guesses", () => {
  for (const surface of surfaces) {
    for (const path of ["src/*.ts", "src/file?.ts", "src/[ab].ts"]) {
      assert.equal(surface.looksLikeRepoFilePath(path), false, path);
      assert.equal(surface.tryParseCitationLocator(path), null, path);
    }
    assert.equal(surface.tryParseCitationLocator("9:2:src/auth.ts"), null);
    assert.equal(surface.isMalformedCitationLocator("9:2:src/auth.ts"), true);
    assert.equal(surface.citationLocatorInFenceBody(["const port = 3000;", "17:34:src/auth.ts"]), null);
    assert.equal(surface.citationLocatorInFenceBody(["{", "17:34:src/auth.ts"]), null);
  }
});

test("surface-specific language policies remain intact after sharing locator syntax", () => {
  assert.equal(extension.shouldNeverUpgradeLanguageFence("html"), false);
  assert.equal(admin.shouldNeverUpgradeLanguageFence("html"), false);
  assert.equal(website.shouldNeverUpgradeLanguageFence("html"), true);
  assert.equal(extension.languageFromFilePath("src/main.rs"), "rust");
  assert.equal(admin.languageFromFilePath("src/main.rs"), "rs");
  assert.equal(website.languageFromFilePath("src/main.rs"), "rs");
});
