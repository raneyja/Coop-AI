import assert from "node:assert/strict";
import {
  blastRadiusSourceLabelDependencies,
  listBlastRadiusSourceLabels,
  listBlastRadiusSourcesChecklist
} from "./blastRadiusSourceLabels";

const emptyEvidence = { file: "src/handler.ts" };

assert.deepEqual(listBlastRadiusSourceLabels(emptyEvidence), [blastRadiusSourceLabelDependencies()]);

const checklist = listBlastRadiusSourcesChecklist(emptyEvidence);
assert.ok(
  checklist.some((line) => line.includes("Impact unverified") || line.includes("No indexed dependents")),
  "expected empty-graph checklist guidance"
);

const partialEvidence = {
  file: "src/handler.ts",
  graphMeta: { edgeCount: 0, lightningEnabled: false }
};

const partialChecklist = listBlastRadiusSourcesChecklist(partialEvidence);
assert.ok(
  partialChecklist.some((line) => line.includes("Index coverage is partial")),
  "expected partial index coverage checklist guidance"
);
assert.equal(
  partialChecklist.filter((line) => line.startsWith(blastRadiusSourceLabelDependencies())).length,
  1,
  "expected a single Dependency graph checklist line"
);

const partialAndUnverified = {
  file: "src/handler.ts",
  graphMeta: { edgeCount: 0, lightningEnabled: false },
  directDependents: [],
  transitiveDependents: []
};
const combinedChecklist = listBlastRadiusSourcesChecklist(partialAndUnverified);
assert.equal(
  combinedChecklist.filter((line) => line.startsWith(blastRadiusSourceLabelDependencies())).length,
  1,
  "expected combined partial/unverified guidance on one Dependency graph line"
);
assert.ok(combinedChecklist[0].includes("Index coverage is partial"));
assert.ok(combinedChecklist[0].includes("Impact unverified"));

console.log("blastRadiusSourceLabels: ok");
