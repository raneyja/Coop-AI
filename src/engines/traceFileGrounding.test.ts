import assert from "node:assert/strict";
import {
  extractTraceFocusTerms,
  linkedPrRelevantToTraceTarget,
  partitionReviewsForTraceTarget,
  scoreTextForTraceFocus,
  tracePathsReferToSameFile
} from "./traceFileGrounding";
import { selectFocusCommit } from "./decisionFocusCommit";
import type { DecisionCommit } from "../types/decisionTimeline";

function commit(partial: Partial<DecisionCommit> & Pick<DecisionCommit, "sha" | "message">): DecisionCommit {
  return {
    author: partial.author ?? "@dev",
    date: partial.date ?? "2026-07-01T00:00:00Z",
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

  await test("extractTraceFocusTerms includes file stem and StateGroup from ask", () => {
    const terms = extractTraceFocusTerms({
      file: "apps/api/plane/db/models/state.py",
      userFocus: "Why do we model StateGroup this way?"
    });
    assert.ok(terms.includes("state"));
    assert.ok(terms.includes("stategroup"));
  });

  await test("scoreTextForTraceFocus prefers StateGroup commit over unrelated migration", () => {
    const terms = extractTraceFocusTerms({
      file: "apps/api/plane/db/models/state.py",
      userFocus: "Why do we model StateGroup this way?"
    });
    const stateScore = scoreTextForTraceFocus("fix: state group choices (#8198)", terms);
    const migrationScore = scoreTextForTraceFocus(
      "chore: project issue type migration for ProjectIssueType",
      terms
    );
    assert.ok(stateScore > migrationScore, `expected ${stateScore} > ${migrationScore}`);
    assert.ok(stateScore > 0);
  });

  await test("selectFocusCommit ranks open-file ask over unrelated high-signal commit", () => {
    const introduction = commit({
      sha: "rename01",
      message: "chore: rename server to api across the monorepo layout."
    });
    const unrelated = commit({
      sha: "migrate1",
      message: "chore: project issue type migration for ProjectIssueType deploy boards."
    });
    const aligned = commit({
      sha: "stategp1",
      message: "fix: state group choices for backlog and triage modeling."
    });
    const focus = selectFocusCommit({
      introduction,
      recentCommits: [unrelated, aligned],
      focusTerms: extractTraceFocusTerms({
        file: "apps/api/plane/db/models/state.py",
        userFocus: "Why do we model StateGroup this way?"
      })
    });
    assert.equal(focus.sha, aligned.sha);
  });

  await test("selectFocusCommit does not prefer unrelated path B when ask targets path A", () => {
    const introduction = commit({
      sha: "intro_a",
      message: "feat: introduce State enum helpers in state.py models."
    });
    const pathB = commit({
      sha: "path_b",
      message: "feat: add ProjectIssueType and deploy board migration 0074."
    });
    const focus = selectFocusCommit({
      introduction,
      recentCommits: [pathB],
      focusTerms: extractTraceFocusTerms({
        file: "apps/api/plane/db/models/state.py",
        userFocus: "Why do we model StateGroup this way?",
        codeSnippet: "class StateGroup(models.TextChoices):"
      })
    });
    assert.equal(focus.sha, introduction.sha);
  });

  await test("linkedPrRelevantToTraceTarget rejects weakly related rename PR", () => {
    const relevant = linkedPrRelevantToTraceTarget({
      title: "fix: state group choices",
      description: "Align StateGroup enum with triage.",
      file: "apps/api/plane/db/models/state.py",
      focusTerms: ["stategroup", "state"]
    });
    const weak = linkedPrRelevantToTraceTarget({
      title: "chore: rename server to api",
      description: "Move apps/server to apps/api.",
      file: "apps/api/plane/db/models/state.py",
      focusTerms: ["stategroup", "state"]
    });
    assert.equal(relevant, true);
    assert.equal(weak, false);
  });

  await test("partitionReviewsForTraceTarget keeps target-file reviews primary", () => {
    const { primary, secondary } = partitionReviewsForTraceTarget(
      [
        { path: "apps/api/plane/db/models/state.py", body: "on target" },
        {
          path: "apps/api/plane/db/migrations/0074_deploy_board_and_project_issues.py",
          body: "on migration"
        },
        { body: "general conversation" }
      ],
      "apps/api/plane/db/models/state.py"
    );
    assert.equal(primary.length, 2);
    assert.equal(secondary.length, 1);
    assert.ok(
      secondary[0].path?.includes("0074_deploy_board_and_project_issues.py")
    );
  });

  await test("tracePathsReferToSameFile matches suffix paths", () => {
    assert.equal(
      tracePathsReferToSameFile(
        "apps/api/plane/db/models/state.py",
        "apps/api/plane/db/models/state.py"
      ),
      true
    );
    assert.equal(
      tracePathsReferToSameFile("state.py", "apps/api/plane/db/models/state.py"),
      true
    );
    assert.equal(
      tracePathsReferToSameFile(
        "apps/api/plane/db/models/state.py",
        "apps/api/plane/db/migrations/0074_deploy_board_and_project_issues.py"
      ),
      false
    );
  });

  const total = passed + failed;
  console.log(`\ntraceFileGrounding: ${passed}/${total} tests passed`);
  if (failed > 0) {
    process.exit(1);
  }
}

void run();
