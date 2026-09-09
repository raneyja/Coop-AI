import assert from "node:assert/strict";
import type { FileNode, OwnershipEntry, DependencyEdge } from "../cache/graphCache";
import { detectRepoKnowledgeGaps } from "./knowledgeGapDetector";
import { knowledgeGapScanCoverageFromJobScan } from "../context/knowledgeGapScanCoverage";

function file(path: string, daysAgo = 10): FileNode {
  return {
    path,
    size: 100,
    lastModified: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
    lastAuthor: "dev",
    sha: "abc"
  };
}

function owner(path: string, primaryOwner: string): OwnershipEntry {
  return { file: path, primaryOwner, secondaryOwners: [], ownershipScore: 1 };
}

function edge(from: string, to: string): DependencyEdge {
  return { from, to, type: "import" };
}

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

test("empty graph is scan_incomplete not zero-gap", () => {
  const empty = detectRepoKnowledgeGaps({ fileTree: [], dependencies: [], owners: [] });
  assert.equal(empty.scanCoverage, "scan_incomplete");
  assert.equal(empty.gaps.length, 0);
  assert.equal(detectRepoKnowledgeGaps(undefined).scanCoverage, "scan_incomplete");
});

test("unknown owners surface missing_owner gaps", () => {
  const result = detectRepoKnowledgeGaps({
    fileTree: [file("apps/api/auth.py"), file("apps/api/views.py"), file("README.md")],
    dependencies: [edge("apps/api/views.py", "apps/api/auth.py")],
    owners: [owner("apps/api/auth.py", "unknown")]
  });
  assert.ok(result.gaps.some((gap) => gap.type === "missing_owner"));
  assert.equal(result.scanCoverage, "gaps_found");
});

test("high-fan-in area without docs is missing_docs", () => {
  const hot = "apps/api/handler.py";
  const result = detectRepoKnowledgeGaps({
    fileTree: [
      file(hot),
      file("apps/api/a.py"),
      file("apps/api/b.py"),
      file("apps/api/c.py"),
      file("apps/web/app.tsx")
    ],
    dependencies: [
      edge("apps/api/a.py", hot),
      edge("apps/api/b.py", hot),
      edge("apps/api/c.py", hot)
    ],
    owners: [owner(hot, "alice")]
  });
  assert.ok(
    result.gaps.some((gap) => gap.type === "missing_docs" && String(gap.file).startsWith("apps/api")),
    JSON.stringify(result.gaps)
  );
});

test("does not flag existing markdown as a documentation gap", () => {
  const result = detectRepoKnowledgeGaps({
    fileTree: [file("docs/runbook.md"), file("README.md"), file("apps/api/ok.py")],
    dependencies: [edge("apps/web/x.tsx", "apps/api/ok.py")],
    owners: [owner("apps/api/ok.py", "alice")]
  });
  assert.ok(!result.gaps.some((gap) => gap.type === "documentation_coverage"));
});

test("empty dependency list is incomplete and can still flag missing docs by area", () => {
  const result = detectRepoKnowledgeGaps({
    fileTree: [
      file("src/chat/CoopChatSession.ts"),
      file("src/jobs/executors.ts"),
      file("README.md")
    ],
    dependencies: [],
    owners: [owner("src/chat/CoopChatSession.ts", "jon")]
  });
  assert.equal(result.scanCoverage, "gaps_found");
  assert.ok(result.gaps.some((gap) => gap.type === "missing_docs"));
  assert.ok(!result.gaps.some((gap) => gap.type === "orphaned_file"));
});

test("infra graph-missing rows are not a healthy scan", () => {
  assert.equal(
    knowledgeGapScanCoverageFromJobScan({
      foundGaps: 1,
      gaps: [{ type: "impact_unknown", message: "No indexed dependency graph for impact context" }]
    }),
    "scan_incomplete"
  );
});

test("tooling configs are not documentation or ownership gaps", () => {
  const result = detectRepoKnowledgeGaps({
    fileTree: [
      file("postcss.config.js"),
      file("tailwind.config.js"),
      file("admin/tailwind.config.ts"),
      file("website/next.config.ts"),
      file("src/chat/CoopChatSession.ts"),
      file("src/jobs/executors.ts")
    ],
    dependencies: [],
    owners: []
  });
  assert.ok(!result.gaps.some((gap) => /postcss|tailwind|next\.config/i.test(String(gap.file ?? gap.message))));
  const docs = result.gaps.filter((gap) => gap.type === "missing_docs");
  assert.ok(docs.some((gap) => String(gap.message).includes("src/chat")), JSON.stringify(docs));
  assert.ok(
    result.gaps
      .filter((gap) => gap.type === "missing_docs")
      .every((gap) => !/postcss|tailwind/i.test(String(gap.message)))
  );
});

test("product areas rank ahead of cache and root files", () => {
  const result = detectRepoKnowledgeGaps({
    fileTree: [
      file("src/cache/graphCache.ts"),
      file("src/chat/CoopChatSession.ts"),
      file("src/api/chatApi.ts")
    ],
    dependencies: [],
    owners: []
  });
  const docs = result.gaps.filter((gap) => gap.type === "missing_docs");
  const owners = result.gaps.filter((gap) => gap.type === "missing_owner");
  assert.ok(docs.length > 0);
  assert.ok(/src\/(chat|api)/.test(String(docs[0]?.message)));
  assert.ok(/src\/(chat|api)/.test(String(owners[0]?.message)));
});

test("stale cache without scanCoverage is incomplete", () => {
  assert.equal(knowledgeGapScanCoverageFromJobScan({ gaps: [], foundGaps: 0 }), "scan_incomplete");
  assert.equal(
    knowledgeGapScanCoverageFromJobScan({ gaps: [], foundGaps: 0, scanCoverage: "no_structured_gaps" }),
    "no_structured_gaps"
  );
  assert.equal(
    knowledgeGapScanCoverageFromJobScan({
      gaps: [{ type: "missing_owner" }],
      foundGaps: 1
    }),
    "gaps_found"
  );
});

const total = passed + failed;
console.log(`\nknowledgeGapDetector: ${passed}/${total} tests passed`);
if (failed > 0) {
  process.exit(1);
}
