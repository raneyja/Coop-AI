import assert from "node:assert/strict";
import { JobType } from "./types";
import type { Job } from "./types";
import { isReusableJob, jobParamsMatch, pickNewestReusableJob } from "./jobReuse";

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

function baseJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "job-1",
    type: JobType.SCAN_KNOWLEDGE_GAPS,
    status: "completed",
    priority: "normal",
    params: { repoId: "github:raneyja/Coop-AI", file: "src/a.ts" },
    userId: "machine-1",
    progress: 100,
    result: { foundGaps: 2 },
    createdAt: new Date(),
    completedAt: new Date(),
    estimatedDurationMs: 180_000,
    retryCount: 0,
    ...overrides
  };
}

test("jobParamsMatch requires same repoId and file", () => {
  assert.equal(
    jobParamsMatch(
      { repoId: "github:raneyja/Coop-AI", file: "src/a.ts" },
      { repoId: "github:raneyja/Coop-AI", file: "src/a.ts" }
    ),
    true
  );
  assert.equal(
    jobParamsMatch(
      { repoId: "github:raneyja/Coop-AI", file: "src/a.ts" },
      { repoId: "github:raneyja/Coop-AI", file: "src/b.ts" }
    ),
    false
  );
});

test("isReusableJob rejects scans older than ttl", () => {
  const old = baseJob({
    completedAt: new Date(Date.now() - 3 * 60 * 60 * 1000)
  });
  assert.equal(
    isReusableJob(old, 2 * 60 * 60 * 1000, { repoId: "github:raneyja/Coop-AI", file: "src/a.ts" }),
    false
  );
});

test("pickNewestReusableJob returns latest matching scan", () => {
  const older = baseJob({
    id: "older",
    completedAt: new Date(Date.now() - 30 * 60 * 1000)
  });
  const newer = baseJob({
    id: "newer",
    completedAt: new Date(Date.now() - 5 * 60 * 1000)
  });
  const picked = pickNewestReusableJob([older, newer], 2 * 60 * 60 * 1000, {
    repoId: "github:raneyja/Coop-AI",
    file: "src/a.ts"
  });
  assert.equal(picked?.id, "newer");
});

const total = passed + failed;
console.log(`\njobReuse: ${passed}/${total} tests passed`);
if (failed > 0) {
  process.exit(1);
}
