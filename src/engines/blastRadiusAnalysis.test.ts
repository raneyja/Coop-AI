import assert from "node:assert/strict";
import {
  buildImportSearchPatterns,
  buildTestSearchPatterns,
  filterJobDependentsForFile,
  normalizeGraphRepoId
} from "./blastRadiusDependentsFallback";
import { assessCompletenessFromSignals } from "./blastRadiusAnalysis.testHelpers";

assert.equal(normalizeGraphRepoId("coop-demo-lab/fastify"), "github:coop-demo-lab/fastify");
assert.equal(normalizeGraphRepoId("github:coop-demo-lab/fastify"), "github:coop-demo-lab/fastify");

const patterns = buildImportSearchPatterns("fastify.js");
assert.ok(patterns.some((pattern) => pattern.includes("fastify.js")));
assert.ok(patterns.some((pattern) => pattern.includes("require(")));

const testPatterns = buildTestSearchPatterns("lib/server.js");
assert.deepEqual(testPatterns, ["server.js", "server", "lib/server.js"]);

const filtered = filterJobDependentsForFile(
  [
    { from: "test/routes.test.js", to: "fastify.js" },
    { from: "lib/plugin.js", to: "lib/core.js" }
  ],
  "fastify.js"
);
assert.deepEqual(filtered, ["test/routes.test.js"]);

const unfilteredTarget = filterJobDependentsForFile(
  [{ from: "lib/plugin.js", to: "lib/core.js" }],
  "fastify.js"
);
assert.deepEqual(unfilteredTarget, []);

assert.equal(assessCompletenessFromSignals(["a.ts"], [], undefined), "partial");
assert.equal(assessCompletenessFromSignals(["a.ts"], [{ number: 1 } as never], { messages: [{}] }), "full");
assert.equal(assessCompletenessFromSignals([], [], undefined), "minimal");

console.log("blastRadiusAnalysis: ok");
