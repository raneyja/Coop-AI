/**
 * Routing eval. Every realistic question a user might type, and where it should
 * go. Run it to see coverage as a number rather than a claim.
 */
import assert from "node:assert/strict";
import {
  classifyRepoCodeIntent,
  isConversationalChat,
  isExplicitNoRepoSearchAsk,
  isGeneralLanguageQuestion,
  type RepoCodeAction
} from "./repoCodeIntent";

type Case = { q: string; expect: RepoCodeAction };

const CASES: Case[] = [
  // Locate — the user wants to be taken to code.
  { q: "Where is requireAuth or authentication middleware defined in this repo?", expect: "locate" },
  { q: "Where is the login form defined?", expect: "locate" },
  { q: "Which file handles password reset?", expect: "locate" },
  { q: "What calls the billing service?", expect: "locate" },
  { q: "Show me the authentication middleware", expect: "locate" },
  { q: "Is rate limiting implemented anywhere?", expect: "locate" },
  { q: "Do we have a retry helper in this codebase?", expect: "locate" },
  { q: "Find all usages of verifyToken", expect: "locate" },
  { q: "Find authMiddleware.ts and show me the export.", expect: "locate" },
  { q: "Read src/server/authMiddleware.ts and show me the export.", expect: "locate" },
  { q: "Where does the webhook handler live?", expect: "locate" },
  {
    q: "I'm picking up COOP-101 — peel auth into coop-backend. What in this repo still owns requireAuth / request auth, and what's the safest first extraction boundary so we don't break every VS Code session?",
    expect: "locate"
  },
  { q: "What in this repo still owns requireAuth?", expect: "locate" },

  // Understand — the user wants an explanation grounded in repo code.
  { q: "What happens when a user signs in?", expect: "understand" },
  { q: "Why do we have two auth systems in this project?", expect: "understand" },
  { q: "How does session refresh work?", expect: "understand" },
  { q: "How does the payment pipeline handle retries?", expect: "understand" },
  { q: "How is auth middleware wired?", expect: "understand" },
  { q: "How do we handle retries in the payment pipeline?", expect: "understand" },
  { q: "Why is requireAuth called twice?", expect: "understand" },
  { q: "Does this project validate webhook signatures?", expect: "locate" },
  { q: "How many files import lodash?", expect: "locate" },

  // Change — the user wants code modified.
  { q: "Add a null check to requireAuth in the auth middleware", expect: "change" },
  { q: "Refactor the invoice service to use decimals", expect: "change" },
  { q: "Fix the bug where tokens expire early in the session service", expect: "change" },
  { q: "Rename verifyToken to validateToken across the repo", expect: "change" },
  { q: "Can you add a rate limiter to the login endpoint?", expect: "change" },
  { q: "We should remove the legacy PaymentProcessor class", expect: "change" },

  // "Explain X" where X is not the open buffer — the code has to be found first.
  { q: "Explain the auth middleware", expect: "understand" },
  { q: "Describe how the billing service is structured", expect: "understand" },
  { q: "Explain this function and how it uses requireAuth", expect: "understand" },
  { q: "Explain this function and how it fits into the codebase", expect: "understand" },

  // Inventory — measured index facts, not a hunt (agent listing dirs cannot count files).
  { q: "How many files are in this repo?", expect: "none" },
  { q: "What's the file count?", expect: "none" },
  { q: "How many lines of code are in this repository?", expect: "none" },
  { q: "How big is this repo?", expect: "none" },
  { q: "What's the structure of this repo?", expect: "none" },
  { q: "How is this repo organized?", expect: "none" },

  // How/Why that is not a code hunt (how-to, age, status, product).
  { q: "How old is this repo?", expect: "none" },
  { q: "How do I run the tests?", expect: "none" },
  { q: "How long does indexing take?", expect: "none" },
  { q: "How should we price this?", expect: "none" },
  { q: "How is the project going?", expect: "none" },
  { q: "Why am I not getting an answer?", expect: "none" },
  { q: "Why is chat so slow?", expect: "none" },
  { q: "Why is this taking so long?", expect: "none" },

  // Language recall (J2) — the answer is identical in every repo, so hunting can only miss.
  {
    q: "In TypeScript, how do I make every property of a type optional except one required key? Show a short example. Don't search the repo and don't invent a Coop file.",
    expect: "none"
  },
  {
    q: "In TypeScript, how do I make every property of a type optional except one required key?",
    expect: "none"
  },
  { q: "In Python, what's the best way to merge two dictionaries?", expect: "none" },
  { q: "How do I write a regex for an ISO date in JavaScript?", expect: "none" },
  { q: "In Go, how do I return an error from a goroutine?", expect: "none" },
  // Still repo asks — a language name does not make it general knowledge.
  { q: "Add a TypeScript type to the auth middleware in this repo", expect: "change" },
  { q: "Where is the TypeScript config for this project?", expect: "locate" },
  { q: "In TypeScript, how does our session refresh flow work in this repo?", expect: "understand" },

  // Adversarial — must NOT loop (enterprise false-positive bar).
  { q: "Explain this function", expect: "none" },
  { q: "What does this function do?", expect: "none" },
  { q: "What does this file do?", expect: "none" },
  { q: "Summarize this code", expect: "none" },
  { q: "Explain what you just did", expect: "none" },
  { q: "Summarize your last answer", expect: "none" },
  { q: "Thanks", expect: "none" },
  { q: "ok thanks that worked", expect: "none" },
  { q: "What did the team say in Slack yesterday?", expect: "none" },
  { q: "Who is on call this week?", expect: "none" },
  { q: "Draft a release note for the launch", expect: "none" },
  { q: "Are you sure?", expect: "none" },
  { q: "find auth", expect: "none" },
  { q: "Can you hear me?", expect: "none" },
  { q: "Schedule a meeting about auth", expect: "none" }
];

let passed = 0;
const failures: string[] = [];

for (const { q, expect } of CASES) {
  const actual = classifyRepoCodeIntent(q).action;
  if (actual === expect) {
    passed++;
  } else {
    failures.push(`  ✗ ${q}\n      expected ${expect}, got ${actual}`);
  }
}

for (const failure of failures) {
  console.error(failure);
}
console.log(`\nrepoCodeIntent: ${passed}/${CASES.length} routed correctly`);

assert.equal(failures.length, 0, "routing eval regressed");

assert.equal(isConversationalChat("Thanks"), true);
assert.equal(isConversationalChat("ok thanks that worked"), true);
assert.equal(isConversationalChat("hi"), true);
assert.equal(isConversationalChat("Hello"), true);
assert.equal(isConversationalChat("hey there"), true);
assert.equal(isConversationalChat("test"), false);
assert.equal(isConversationalChat("Explain this function"), false);
assert.equal(isConversationalChat("ok now add logging around requireAuth"), false);

// J2 — the two independent nets that keep language recall out of the index.
assert.equal(isExplicitNoRepoSearchAsk("Don't search the repo and don't invent a Coop file."), true);
assert.equal(isExplicitNoRepoSearchAsk("without searching the codebase, what does Omit do?"), true);
assert.equal(isExplicitNoRepoSearchAsk("no need to search the repository"), true);
// The negation must sit on the search verb, not on a qualifier.
assert.equal(isExplicitNoRepoSearchAsk("Don't just search the repo — read the file too."), false);
assert.equal(isExplicitNoRepoSearchAsk("Where is requireAuth defined in this repo?"), false);

assert.equal(
  isGeneralLanguageQuestion("In TypeScript, how do I make every property optional except one?"),
  true
);
assert.equal(isGeneralLanguageQuestion("What's the idiomatic way to sort a slice in Go?"), true);
// A repo reference takes it back to a hunt, even with a language named.
assert.equal(
  isGeneralLanguageQuestion("In TypeScript, how do I type the auth middleware in this repo?"),
  false
);
assert.equal(
  isGeneralLanguageQuestion("In TypeScript, how do I type src/server/authMiddleware.ts?"),
  false
);
assert.equal(isGeneralLanguageQuestion("In TypeScript, how do I type this function?"), false);
// No language named — "how do we handle retries" is still about our code.
assert.equal(isGeneralLanguageQuestion("How do we handle retries in the payment pipeline?"), false);
