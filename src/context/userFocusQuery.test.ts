import assert from "node:assert/strict";
import {
  combineSlashFocus,
  focusGatherSatisfied,
  focusQueryForRetrieval,
  looksLikeCannedQuickActionPrompt,
  mergeFocusEntryPaths,
  mergeFocusFilesIntoEntryFiles,
  tokenizeFocusTerms
} from "./userFocusQuery";

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

test("combineSlashFocus joins prefix and args", () => {
  assert.equal(
    combineSlashFocus("main services", "work item flow"),
    "main services work item flow"
  );
});

test("combineSlashFocus keeps after-only and before-only focus", () => {
  assert.equal(combineSlashFocus("", "board flow"), "board flow");
  assert.equal(combineSlashFocus("auth flow", ""), "auth flow");
  assert.equal(combineSlashFocus("", ""), "");
});

test("combineSlashFocus strips polite filler from prefix only", () => {
  assert.equal(
    combineSlashFocus("please explain", "work item board flow"),
    "explain work item board flow"
  );
  assert.equal(combineSlashFocus("hey, can you", "owners for payments"), "owners for payments");
});

test("focusQueryForRetrieval rejects short and canned prompts", () => {
  assert.equal(focusQueryForRetrieval("short"), undefined);
  assert.equal(focusQueryForRetrieval("  "), undefined);
  assert.equal(
    focusQueryForRetrieval(
      "Explain this repository for a new engineer joining the team.\nRespond in complete sentences.\nUse attached repo entry files"
    ),
    undefined
  );
  assert.equal(
    focusQueryForRetrieval("what are the main services and work item flow?"),
    "what are the main services and work item flow?"
  );
});

test("looksLikeCannedQuickActionPrompt detects directive blobs but not real ownership asks", () => {
  assert.equal(looksLikeCannedQuickActionPrompt("what is the board flow here"), false);
  assert.equal(looksLikeCannedQuickActionPrompt("Who owns the payments service?"), false);
  assert.equal(
    looksLikeCannedQuickActionPrompt(
      "Explain why this code exists and what trade-offs were accepted.\nRespond in complete sentences."
    ),
    true
  );
  assert.equal(
    looksLikeCannedQuickActionPrompt(
      "Who owns acme/plane and who should I contact for questions or changes?"
    ),
    true
  );
});

test("mergeFocusEntryPaths keeps anchors then injects focus paths", () => {
  const merged = mergeFocusEntryPaths({
    anchorPaths: ["package.json", "README.md", "docker-compose.yml", "AGENTS.md"],
    focusPaths: ["apps/api/issue/views.py", "apps/web/components/Board.tsx", "apps/api/serializers.py"]
  });
  assert.ok(merged.includes("package.json"));
  assert.ok(merged.includes("README.md"));
  assert.ok(merged.includes("apps/api/issue/views.py"));
  assert.ok(merged.includes("apps/web/components/Board.tsx"));
  assert.ok(merged.length <= 6);
});

test("focusGatherSatisfied passes when a focus hit is attached", () => {
  assert.equal(
    focusGatherSatisfied({
      focusQuery: "work item board",
      focusHitPaths: ["apps/api/issue/views.py"],
      attachedEntryPaths: ["package.json", "apps/api/issue/views.py"]
    }),
    true
  );
});

test("focusGatherSatisfied fails when hits exist but none attached and paths lack tokens", () => {
  assert.equal(
    focusGatherSatisfied({
      focusQuery: "work item board",
      focusHitPaths: ["apps/api/issue/views.py"],
      attachedEntryPaths: ["package.json", "README.md"]
    }),
    false
  );
});

test("focusGatherSatisfied fail-opens when index returned no hits", () => {
  assert.equal(
    focusGatherSatisfied({
      focusQuery: "work item board",
      focusHitPaths: [],
      attachedEntryPaths: ["package.json"]
    }),
    true
  );
});

test("mergeFocusFilesIntoEntryFiles appends new focus bodies", () => {
  const merged = mergeFocusFilesIntoEntryFiles(
    [{ path: "package.json", content: "{}" }],
    [
      { path: "apps/api/issue/views.py", content: "class IssueView:" },
      { path: "package.json", content: "duplicate" }
    ]
  );
  assert.equal(merged.length, 2);
  assert.equal(merged[1]?.path, "apps/api/issue/views.py");
});

test("tokenizeFocusTerms drops stop words", () => {
  const tokens = tokenizeFocusTerms("what are the main services and how does a work item flow");
  assert.ok(tokens.includes("services"));
  assert.ok(tokens.includes("work"));
  assert.ok(tokens.includes("item"));
  assert.ok(tokens.includes("flow"));
  assert.ok(!tokens.includes("what"));
  assert.ok(!tokens.includes("the"));
});

const total = passed + failed;
console.log(`\nuserFocusQuery: ${passed}/${total} tests passed`);
if (failed > 0) {
  process.exit(1);
}
