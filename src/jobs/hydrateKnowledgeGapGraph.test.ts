import assert from "node:assert/strict";
import { detectRepoKnowledgeGaps } from "./knowledgeGapDetector";
import {
  fileNodesFromPaths,
  hydrateKnowledgeGapGraphSlice,
  knowledgeGapRepoIdCandidates
} from "./hydrateKnowledgeGapGraph";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    failed += 1;
    console.error(`  ✗ ${name}`);
    console.error(error);
  }
}

test("empty memory graph without manifest is not a slice", () => {
  assert.equal(hydrateKnowledgeGapGraphSlice({ fileTree: [], memoryEdges: [] }), undefined);
});

test("manifest paths hydrate a scanable tree", () => {
  const slice = hydrateKnowledgeGapGraphSlice({
    fileTree: [],
    manifestPaths: ["src/chat/CoopChatSession.ts", "src/chat/README.md", "admin/src/app/page.tsx"]
  });
  assert.ok(slice);
  assert.equal(slice.fileTree.length, 3);
  const detected = detectRepoKnowledgeGaps(slice);
  assert.equal(detected.scanCoverage, "gaps_found");
  assert.ok(detected.gaps.some((gap) => gap.type === "missing_docs"));
  assert.ok(detected.gaps.some((gap) => gap.type === "missing_owner"));
});

test("durable edges recover paths when the memory tree is empty", () => {
  const slice = hydrateKnowledgeGapGraphSlice({
    fileTree: [],
    durableEdges: [{ from: "src/a.ts", to: "src/b.ts", type: "import" }]
  });
  assert.ok(slice);
  assert.deepEqual(
    slice.fileTree.map((file) => file.path).sort(),
    ["src/a.ts", "src/b.ts"]
  );
  assert.equal(slice.dependencies.length, 1);
});

test("memory tree wins over manifest", () => {
  const slice = hydrateKnowledgeGapGraphSlice({
    fileTree: fileNodesFromPaths(["src/only.ts"]),
    manifestPaths: ["src/other.ts"]
  });
  assert.ok(slice);
  assert.deepEqual(
    slice.fileTree.map((file) => file.path),
    ["src/only.ts"]
  );
});

test("repo id candidates include every code-host prefix", () => {
  assert.deepEqual(knowledgeGapRepoIdCandidates("raneyja/Coop-AI", { owner: "raneyja", repo: "Coop-AI" }), [
    "raneyja/Coop-AI",
    "github:raneyja/Coop-AI",
    "gitlab:raneyja/Coop-AI",
    "bitbucket:raneyja/Coop-AI"
  ]);
});

console.log(`\nhydrateKnowledgeGapGraph: ${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  process.exit(1);
}
