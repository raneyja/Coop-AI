import assert from "node:assert/strict";
import test from "node:test";
import { buildGoScipArgs, requireNonEmptyScipAnalysis } from "./scipIndexerContract";

test("Go indexing uses the required index command from the repository root", () => {
  assert.deepEqual(buildGoScipArgs("/tmp/repository", "/tmp/repository/index.scip"), [
    "index",
    "--output",
    "/tmp/repository/index.scip",
    "./..."
  ]);
});

test("an empty SCIP analysis cannot be reported as successful", () => {
  assert.doesNotThrow(() => requireNonEmptyScipAnalysis(1));
  assert.throws(
    () => requireNonEmptyScipAnalysis(0),
    /without producing any symbols/
  );
});
