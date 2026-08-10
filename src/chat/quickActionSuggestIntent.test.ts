import assert from "node:assert/strict";
import {
  filterSuggestableActions,
  shouldOfferQuickActionSuggest,
  suggestQuickActions,
  suggestRunChipLabel
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
  assert.match(result.clarifyingPrompt, /Find Owner/);
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

test("warnings: business impact and test coverage stay quiet", () => {
  assert.deepEqual(ids("What's the business impact of this feature?"), []);
  assert.deepEqual(ids("Any test coverage gaps in auth?"), []);
  assert.deepEqual(ids("What's the customer impact of shipping late?"), []);
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

test("filter: understand offered even with sticky file (repo-wide chip)", () => {
  const raw = suggestQuickActions("How is this repository structured?").suggestions;
  assert.equal(raw[0]?.actionId, "understand-repo");
  const filtered = filterSuggestableActions(raw, repoWithFile);
  assert.equal(filtered[0]?.actionId, "understand-repo");
  const offer = shouldOfferQuickActionSuggest(
    "How is this repository structured?",
    repoWithFile
  );
  assert.ok(offer);
  assert.equal(offer!.suggestions[0]?.actionId, "understand-repo");
});

test("filter: understand still blocked with empty context", () => {
  const raw = suggestQuickActions("How is this repository structured?").suggestions;
  assert.equal(filterSuggestableActions(raw, emptyContext).length, 0);
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

test("suggestRunChipLabel uses slash tokens", () => {
  assert.equal(suggestRunChipLabel("blast-radius"), "Run /blast");
  assert.equal(suggestRunChipLabel("find-owner"), "Run /owner");
  assert.equal(suggestRunChipLabel("trace-decision"), "Run /trace");
});

/** Primary + secondary paraphrases from agent expansion. */
const GOLDEN: Array<{ ask: string; action: string }> = [
  // Owner — primary + secondary
  { ask: "Point me at the expert for signing emails", action: "find-owner" },
  { ask: "Who's responsible for the webhook delivery path?", action: "find-owner" },
  { ask: "Who is the right person for auth permissions?", action: "find-owner" },
  { ask: "Who knows about send-signing-email?", action: "find-owner" },
  { ask: "Ownership of this billing module?", action: "find-owner" },
  { ask: "Who last touched this file?", action: "find-owner" },
  { ask: "What's the escalation path for this area?", action: "find-owner" },
  { ask: "Find the SME for envelope sealing", action: "find-owner" },
  { ask: "Who's the DRI for payments?", action: "find-owner" },
  { ask: "Who is on point for auth?", action: "find-owner" },
  { ask: "How do I find the owner of this module?", action: "find-owner" },
  { ask: "Who is the technical lead for signing?", action: "find-owner" },
  { ask: "Point of contact for the seal job?", action: "find-owner" },
  // Trace — primary + secondary
  { ask: "Why was this designed this way?", action: "trace-decision" },
  { ask: "What's the backstory behind StateGroup?", action: "trace-decision" },
  { ask: "Why did we choose this abstraction?", action: "trace-decision" },
  { ask: "What's the design rationale for this model?", action: "trace-decision" },
  { ask: "How did this end up in the codebase?", action: "trace-decision" },
  { ask: "Historical context for this middleware?", action: "trace-decision" },
  { ask: "What's the thinking behind this approach?", action: "trace-decision" },
  { ask: "Do some code archaeology on this auth path", action: "trace-decision" },
  { ask: "What alternatives were considered for StateGroup?", action: "trace-decision" },
  { ask: "How do I find why this was added?", action: "trace-decision" },
  { ask: "Is there an ADR for this decision?", action: "trace-decision" },
  // Blast — primary + secondary
  { ask: "What would break if we rename StateGroup?", action: "blast-radius" },
  { ask: "Is it safe to change these enum values?", action: "blast-radius" },
  { ask: "What depends on this function?", action: "blast-radius" },
  { ask: "Downstream impact of deleting this helper?", action: "blast-radius" },
  { ask: "If we refactor this, what else is affected?", action: "blast-radius" },
  { ask: "Callers for validate_identifier?", action: "blast-radius" },
  { ask: "Side effects of changing this handler?", action: "blast-radius" },
  { ask: "Ripple effects of renaming this symbol?", action: "blast-radius" },
  { ask: "Find all usages of this helper before I edit", action: "blast-radius" },
  { ask: "Can I delete this safely?", action: "blast-radius" },
  { ask: "How do I find what depends on this module?", action: "blast-radius" },
  // Understand — primary + secondary
  { ask: "Orient me on this codebase", action: "understand-repo" },
  { ask: "What's the high-level architecture of this repo?", action: "understand-repo" },
  { ask: "How is this monorepo organized?", action: "understand-repo" },
  { ask: "Where are the package boundaries in this monorepo?", action: "understand-repo" },
  { ask: "What's in the top-level package structure?", action: "understand-repo" },
  { ask: "Map of the key systems here?", action: "understand-repo" },
  { ask: "Bird's-eye view of this codebase", action: "understand-repo" },
  { ask: "Where should I start in this repo?", action: "understand-repo" },
  { ask: "Lay of the land in this project", action: "understand-repo" },
  { ask: "10,000-foot view of this project", action: "understand-repo" },
  // Gaps — primary + secondary
  { ask: "What don't we know about auth?", action: "knowledge-gaps" },
  { ask: "Where is documentation missing for integrations?", action: "knowledge-gaps" },
  { ask: "Any tribal knowledge risks in billing?", action: "knowledge-gaps" },
  { ask: "What should we document in this area?", action: "knowledge-gaps" },
  { ask: "Blind spots in the signing flow docs?", action: "knowledge-gaps" },
  { ask: "Open questions about envelope status?", action: "knowledge-gaps" },
  { ask: "Documentation debt in the webhook path?", action: "knowledge-gaps" },
  { ask: "What only exists in people's heads here?", action: "knowledge-gaps" },
  { ask: "README gaps for onboarding?", action: "knowledge-gaps" },
  { ask: "Knowledge silos around sealing?", action: "knowledge-gaps" }
];

test("golden corpus: primary + secondary paraphrases", () => {
  for (const row of GOLDEN) {
    const got = top(row.ask);
    assert.equal(got, row.action, `ask=${JSON.stringify(row.ask)} got=${got}`);
  }
});

test("regression: responseDeadline blast ask offers chip when file in scope", () => {
  const ask =
    "What breaks if we change or rename `MAX_USER_FACING_RESPONSE_MS` or `remainingContextGatherBudgetMs`?";
  const offer = shouldOfferQuickActionSuggest(ask, repoWithFile);
  assert.ok(offer);
  assert.equal(offer!.suggestions[0]?.actionId, "blast-radius");
});

test("regression: estimate impact of changing offers blast chip", () => {
  const offer = shouldOfferQuickActionSuggest(
    "Estimate the impact of changing this code.",
    repoWithFile
  );
  assert.ok(offer);
  assert.equal(offer!.suggestions[0]?.actionId, "blast-radius");
});

test("negatives: more normal chat stays quiet", () => {
  assert.deepEqual(ids("What does the SEND_SIGNING_EMAIL job definition do in this file?"), []);
  assert.deepEqual(ids("How do I install dependencies?"), []);
  assert.deepEqual(ids("Show me the type signature of StateGroup"), []);
  assert.deepEqual(ids("Translate this error message to plain English"), []);
  assert.deepEqual(ids("Why is CI red on this PR?"), []);
  assert.deepEqual(ids("How do I set up the .env file?"), []);
  assert.deepEqual(ids("Write a unit test for this"), []);
});

console.log(`\nquickActionSuggestIntent: ${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  process.exit(1);
}
