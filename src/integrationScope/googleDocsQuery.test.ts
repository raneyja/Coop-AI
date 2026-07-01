import test from "node:test";
import assert from "node:assert/strict";
import {
  applyGoogleDocsFolderScope,
  buildDriveParentsClause,
  filterGoogleDocsHitsByFolder,
  isGoogleDocsScopeBlocked
} from "./googleDocsQuery";
import type { ResolvedIntegrationScope } from "./types";

test("isGoogleDocsScopeBlocked is false when scope is not enforced", () => {
  const scope: ResolvedIntegrationScope = {
    provider: "google_docs",
    enforced: false,
    allowed: true,
    scopeStatus: "none"
  };
  assert.equal(isGoogleDocsScopeBlocked(scope), false);
});

test("buildDriveParentsClause handles single and multiple folders", () => {
  assert.equal(buildDriveParentsClause(["folder-a"]), "'folder-a' in parents");
  assert.equal(
    buildDriveParentsClause(["folder-a", "folder-b"]),
    "('folder-a' in parents or 'folder-b' in parents)"
  );
});

test("applyGoogleDocsFolderScope appends parent filters", () => {
  const queries = applyGoogleDocsFolderScope(["name contains spec"], ["folder-a"]);
  assert.equal(queries[0], "(name contains spec) and ('folder-a' in parents)");
});

test("filterGoogleDocsHitsByFolder keeps hits under allowlisted parents", () => {
  const hits = [
    { id: "doc-1", parents: ["folder-a"] },
    { id: "doc-2", parents: ["folder-b"] }
  ];
  const filtered = filterGoogleDocsHitsByFolder(hits, new Set(["folder-a"]));
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]?.id, "doc-1");
});
