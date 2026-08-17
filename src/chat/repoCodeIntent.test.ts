/**
 * Routing eval. Every realistic question a user might type, and where it should
 * go. Run it to see coverage as a number rather than a claim.
 */
import assert from "node:assert/strict";
import { classifyRepoCodeIntent, isConversationalChat, type RepoCodeAction } from "./repoCodeIntent";

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
  { q: "Where does the webhook handler live?", expect: "locate" },

  // Understand — the user wants an explanation grounded in repo code.
  { q: "What happens when a user signs in?", expect: "understand" },
  { q: "Why do we have two auth systems in this project?", expect: "understand" },
  { q: "How does session refresh work?", expect: "understand" },
  { q: "How does the payment pipeline handle retries?", expect: "understand" },
  { q: "Does this project validate webhook signatures?", expect: "locate" },

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
assert.equal(isConversationalChat("Explain this function"), false);
assert.equal(isConversationalChat("ok now add logging around requireAuth"), false);
