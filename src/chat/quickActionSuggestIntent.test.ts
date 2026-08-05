import assert from "node:assert/strict";
import {
  filterSuggestableActions,
  shouldOfferQuickActionSuggest,
  suggestQuickActions
} from "./quickActionSuggestIntent";
import type { RepoContext } from "./types";

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

function ids(message: string): string[] {
  return suggestQuickActions(message).suggestions.map((s) => s.actionId);
}

function top(message: string): string | undefined {
  return ids(message)[0];
}

const repoWithFile: RepoContext = {
  owner: "acme",
  repo: "app",
  branch: "main",
  scope: "file",
  file: "packages/lib/jobs/definitions/emails/send-signing-email.ts"
};

const repoWide: RepoContext = {
  owner: "acme",
  repo: "app",
  branch: "main",
  scope: "repo"
};

const emptyContext: RepoContext = {};

// --- Find Owner positives ---
test("owner: signing-request email delivery example → find-owner high", () => {
  const result = suggestQuickActions(
    "Who owns signing-request email delivery for this code?"
  );
  assert.equal(result.confidence, "high");
  assert.equal(result.suggestions[0]?.actionId, "find-owner");
  assert.match(result.clarifyingPrompt, /ownership/i);
});

test("owner: who maintains / CODEOWNERS / who to ask", () => {
  assert.equal(top("Who maintains the billing webhook?"), "find-owner");
  assert.equal(top("Is there a CODEOWNERS entry for auth?"), "find-owner");
  assert.equal(top("Who should I ask about payments?"), "find-owner");
  assert.equal(top("Find the owner of send-signing-email"), "find-owner");
});

// --- Trace positives ---
test("trace: why was this written / decision history", () => {
  assert.equal(top("Why was this auth middleware written this way?"), "trace-decision");
  assert.equal(top("What's the decision history for this file?"), "trace-decision");
  assert.equal(top("Trace the decision behind StateGroup"), "trace-decision");
});

// --- Blast positives ---
test("blast: what breaks / callers / if I change", () => {
  assert.equal(top("What breaks if I change this handler?"), "blast-radius");
  assert.equal(top("What's the blast radius of renaming validate_identifier?"), "blast-radius");
  assert.equal(top("Who calls sendSigningEmail?"), "blast-radius");
  assert.equal(top("If I modify this function, what else is affected?"), "blast-radius");
});

// --- Understand positives ---
test("understand: repo architecture / overview", () => {
  assert.equal(top("How is this repository structured?"), "understand-repo");
  assert.equal(top("Give me an overview of this repo"), "understand-repo");
  assert.equal(top("Explain this codebase architecture"), "understand-repo");
});

// --- Gaps positives ---
test("gaps: missing docs / knowledge gaps", () => {
  assert.equal(top("What are the knowledge gaps in auth?"), "knowledge-gaps");
  assert.equal(top("What's undocumented in the billing area?"), "knowledge-gaps");
  assert.equal(top("Where are the docs thin for integrations?"), "knowledge-gaps");
});

// --- Negatives / no suggest ---
test("negatives: normal chat does not suggest", () => {
  assert.deepEqual(ids("What does this function return?"), []);
  assert.deepEqual(ids("How do I run the tests locally?"), []);
  assert.deepEqual(ids("Summarize the last commit message"), []);
  assert.equal(suggestQuickActions("What does this function return?").confidence, "low");
});

test("negatives: explicit slash / tag never suggest", () => {
  assert.deepEqual(ids("/owner Who owns signing email?"), []);
  assert.deepEqual(ids("[find-owner] Who owns this?"), []);
});

test("negatives: explain this file is not Understand Repo", () => {
  assert.ok(!ids("Explain this file").includes("understand-repo"));
  assert.ok(!ids("What does this function do?").includes("understand-repo"));
});

test("disabled option returns empty", () => {
  const result = suggestQuickActions("Who owns auth?", { disabled: true });
  assert.equal(result.confidence, "low");
  assert.equal(result.suggestions.length, 0);
});

// --- Collisions ---
test("collision: who owns this decision prefers Trace (or Trace+Owner)", () => {
  const result = suggestQuickActions("Who owns this decision in the auth flow?");
  assert.ok(result.suggestions.length >= 1);
  assert.equal(result.suggestions[0]?.actionId, "trace-decision");
  assert.ok(result.suggestions.length <= 2);
});

test("collision: max two suggestions", () => {
  const result = suggestQuickActions(
    "Who owns this and what breaks if I change it and why was it written?"
  );
  assert.ok(result.suggestions.length <= 2);
});

// --- File / repo gates ---
test("filter: blast/trace blocked without file", () => {
  const raw = suggestQuickActions("What breaks if I change this?").suggestions;
  assert.equal(raw[0]?.actionId, "blast-radius");
  const filtered = filterSuggestableActions(raw, repoWide);
  assert.equal(filtered.length, 0);
});

test("filter: blast available with file", () => {
  const raw = suggestQuickActions("What breaks if I change this?").suggestions;
  const filtered = filterSuggestableActions(raw, repoWithFile);
  assert.equal(filtered[0]?.actionId, "blast-radius");
});

test("filter: owner available repo-wide with explicit scope", () => {
  const raw = suggestQuickActions(
    "Who owns signing-request email delivery for this code?"
  ).suggestions;
  const filtered = filterSuggestableActions(raw, repoWide);
  assert.equal(filtered[0]?.actionId, "find-owner");
});

test("filter: owner blocked with empty context", () => {
  const raw = suggestQuickActions("Who owns auth?").suggestions;
  const filtered = filterSuggestableActions(raw, emptyContext);
  assert.equal(filtered.length, 0);
});

test("shouldOffer: owner example with file context", () => {
  const offer = shouldOfferQuickActionSuggest(
    "Who owns signing-request email delivery for this code?",
    repoWithFile
  );
  assert.ok(offer);
  assert.equal(offer!.suggestions[0]?.actionId, "find-owner");
  assert.equal(offer!.confidence, "high");
});

test("shouldOffer: undefined when all actions blocked", () => {
  const offer = shouldOfferQuickActionSuggest("What breaks if I change this?", repoWide);
  assert.equal(offer, undefined);
});

test("shouldOffer: undefined for normal chat", () => {
  assert.equal(
    shouldOfferQuickActionSuggest("How do I run unit tests?", repoWithFile),
    undefined
  );
});

console.log(`\nquickActionSuggestIntent: ${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  process.exit(1);
}
