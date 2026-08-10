import assert from "node:assert/strict";
import {
  blastRadiusSourceLabelDependencies,
  hasPartialIndexCoverage,
  hasVerifiedRemoteBlastDependents,
  listBlastRadiusSourceLabels,
  listBlastRadiusSourcesChecklist,
  verifiedRemoteBlastGraphSource
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

const verifiedImportParse = {
  file: "src/config/responseDeadline.ts",
  directDependents: [
    "src/chat/CoopChatSession.ts",
    "src/jobs/JobApiClient.ts"
  ],
  graphMeta: { source: "import-parse", lightningEnabled: false, edgeCount: 2907 },
  completeness: "partial" as const
};
assert.equal(hasPartialIndexCoverage(verifiedImportParse), false);
const verifiedChecklist = listBlastRadiusSourcesChecklist(verifiedImportParse);
assert.ok(
  verifiedChecklist.some((line) => /Verified import-parse/i.test(line)),
  "expected verified import-parse checklist note"
);
assert.ok(
  !verifiedChecklist.some((line) => /Index coverage is partial/i.test(line)),
  "must not undercut verified import-parse callers"
);

// Regression: smoke showed "Graph source: import-parse" with zero Documenso callers.
const emptyButImportParseLabel = {
  file: "packages/lib/types/is-document-status.ts",
  directDependents: [] as string[],
  transitiveDependents: [] as string[],
  dependentDetails: [] as Array<{ path: string; depth: number; source: "import-parse" }>,
  graphMeta: { source: "import-parse" as const, lightningEnabled: true, edgeCount: 3275 },
  completeness: "partial" as const
};
assert.equal(
  hasVerifiedRemoteBlastDependents(emptyButImportParseLabel),
  false,
  "must not claim verified remote callers when Direct dependents is empty"
);
assert.equal(
  verifiedRemoteBlastGraphSource(emptyButImportParseLabel),
  undefined,
  "must not expose import-parse as verified source when callers are empty"
);
const emptyImportParseChecklist = listBlastRadiusSourcesChecklist(emptyButImportParseLabel);
assert.ok(
  !emptyImportParseChecklist.some((line) => /Verified import-parse/i.test(line)),
  "checklist must not say Verified import-parse with 0 dependents"
);
assert.ok(
  emptyImportParseChecklist.some((line) => /Impact unverified/i.test(line)),
  "empty dependents must stay Impact unverified"
);

const verifiedViaDetailsOnly = {
  file: "src/config/responseDeadline.ts",
  directDependents: ["src/chat/CoopChatSession.ts"],
  dependentDetails: [
    { path: "src/chat/CoopChatSession.ts", depth: 1, source: "import-parse" as const }
  ],
  graphMeta: { edgeCount: 10, lightningEnabled: false },
  completeness: "partial" as const
};
assert.equal(hasPartialIndexCoverage(verifiedViaDetailsOnly), false);
assert.ok(
  listBlastRadiusSourcesChecklist(verifiedViaDetailsOnly).some((line) =>
    /Verified import-parse/i.test(line)
  ),
  "per-entry import-parse provenance counts as verified"
);

console.log("blastRadiusSourceLabels: ok");
