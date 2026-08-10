import assert from "node:assert/strict";
import { buildRationaleRanking } from "./decisionRationaleRanking";
import type { DecisionTimeline } from "../types/decisionTimeline";

function baseTimeline(partial: Partial<DecisionTimeline> = {}): DecisionTimeline {
  return {
    file: "apps/api/plane/db/models/state.py",
    completeness: "partial",
    alternatives: [],
    chronology: [],
    warnings: [],
    originalCommit: {
      sha: "intro001abcdef",
      author: "@dev",
      date: "2020-01-01T00:00:00Z",
      message: "Initial state model scaffold."
    },
    focusCommit: {
      sha: "5933561abcdef",
      author: "@dev",
      date: "2024-06-01T00:00:00Z",
      message: "feat: session auth implementation (#4411)"
    },
    ...partial
  };
}

async function run(): Promise<void> {
  let passed = 0;
  let failed = 0;

  const test = async (name: string, fn: () => void | Promise<void>) => {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}`);
      console.error(`    ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
  };

  await test("Z3 Gate A: high-signal auth mega is not sole rationale under StateGroup ask", () => {
    const timeline = baseTimeline({
      focusDecisionQuality: "weak",
      focusIsMegaDriveBy: true
    });
    const ranking = buildRationaleRanking(timeline, true, {
      prRelevantToTarget: false,
      focusTerms: ["stategroup", "state"],
      focusCommitScore: 12, // even if body falsely scored high
      focusIsMegaDriveBy: true,
      focusDecisionQuality: "weak"
    });
    const focusRole = ranking.find((entry) => entry.source === "commit:5933561abcdef")?.role;
    assert.ok(focusRole === "provenance" || focusRole === "background", `got ${focusRole}`);
    assert.equal(
      ranking.some((entry) => entry.role === "rationale" && entry.source.includes("5933561")),
      false
    );
  });

  await test("Z3 Gate B: mega drive-by never promoted via fail-open", () => {
    const timeline = baseTimeline({
      linkedPR: undefined,
      focusIsMegaDriveBy: true,
      focusDecisionQuality: "weak"
    });
    const ranking = buildRationaleRanking(timeline, true, {
      prRelevantToTarget: true,
      focusTerms: ["stategroup"],
      focusCommitScore: 0,
      focusIsMegaDriveBy: true,
      focusDecisionQuality: "weak"
    });
    assert.equal(ranking.some((entry) => entry.role === "rationale"), false);
  });

  await test("ask-aligned focus commit keeps rationale role", () => {
    const timeline = baseTimeline({
      focusCommit: {
        sha: "state9a1abcdef",
        author: "@dev",
        date: "2024-07-01T00:00:00Z",
        message: "fix: refine StateGroup choices for backlog triage."
      },
      focusDecisionQuality: "aligned"
    });
    const ranking = buildRationaleRanking(timeline, true, {
      prRelevantToTarget: true,
      focusTerms: ["stategroup", "state"],
      focusCommitScore: 8,
      focusIsMegaDriveBy: false,
      focusDecisionQuality: "aligned"
    });
    const focus = ranking.find((entry) => entry.source === "commit:state9a1abcdef");
    assert.equal(focus?.role, "rationale");
  });

  const total = passed + failed;
  console.log(`\ndecisionRationaleRanking: ${passed}/${total} tests passed`);
  if (failed > 0) {
    process.exit(1);
  }
}

void run();
