import assert from "node:assert/strict";
import type { PatchCardState } from "./types";
import {
  CREATE_PR_CHAT_NEED_APPLY,
  CREATE_PR_CHAT_NEED_APPLY_PENDING,
  CREATE_PR_CHAT_NEED_USE_REPO,
  CREATE_PR_CHAT_OPENED,
  CREATE_PR_CHAT_OPENED_MULTI,
  createPrChatReply,
  isCreatePullRequestAsk,
  isEligibleCreatePrCard,
  latestEligibleCreatePrCard,
  mergeAppliedPrFiles,
  mergeAppliedPrPreviewFiles,
  resolveCreatePrChatRouting
} from "./createPrChatRouting";

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

function card(overrides: Partial<PatchCardState> & Pick<PatchCardState, "status">): PatchCardState {
  return {
    fileCount: 1,
    hunkCount: 1,
    files: [],
    messageTimestamp: 10,
    canCreatePr: false,
    ...overrides
  };
}

test("isCreatePullRequestAsk matches ship commands", () => {
  for (const message of [
    "Create a PR",
    "create a pr",
    "create pr",
    "Create a pull request",
    "open a PR",
    "open a pull request",
    "make a PR",
    "please create a PR",
    "can you create a PR?",
    "let's create a PR",
    "create a PR for this",
    "create a PR for that change",
    "create a pr for the change i just made on line 12",
    "create a PR for the change I just made",
    "create a pr of all the work i just applied",
    "create a pr for all the work i just did",
    "create a pull request of everything I applied",
    "please create a pull request for all the work I just applied",
    "can you create a PR of all the work I just applied?",
    "submit a merge request"
  ]) {
    assert.equal(isCreatePullRequestAsk(message), true, message);
  }
});

test("isCreatePullRequestAsk rejects questions and new-work asks", () => {
  for (const message of [
    "how do I create a PR",
    "how do we create pull requests here",
    "what's the PR process",
    "should I create a PR",
    "when should we create a PR",
    "create a PR template",
    "add a create PR button",
    "create a PR that adds logging",
    "explain how to create a PR",
    "open the PR template"
  ]) {
    assert.equal(isCreatePullRequestAsk(message), false, message);
  }
});

test("latestEligibleCreatePrCard is the newest applied card with files", () => {
  const older = card({
    status: "applied",
    messageTimestamp: 10,
    canCreatePr: true
  });
  const newer = card({
    status: "applied",
    messageTimestamp: 30,
    prFiles: [{ path: "src/a.ts", content: "ok\n" }]
  });
  const pending = card({ status: "pending", messageTimestamp: 40, canCreatePr: true });
  assert.equal(isEligibleCreatePrCard(pending), false);
  assert.equal(latestEligibleCreatePrCard([older, pending, newer])?.messageTimestamp, 30);
});

test("mergeAppliedPrFiles keeps later Apply for the same path", () => {
  const files = mergeAppliedPrFiles([
    card({
      status: "applied",
      messageTimestamp: 10,
      canCreatePr: true,
      prFiles: [{ path: "src/a.ts", content: "first\n" }]
    }),
    card({
      status: "applied",
      messageTimestamp: 20,
      canCreatePr: true,
      prFiles: [{ path: "src/a.ts", content: "first\nsecond\n" }]
    })
  ]);
  assert.deepEqual(files, [{ path: "src/a.ts", content: "first\nsecond\n" }]);
});

test("mergeAppliedPrFiles unions different files from every Apply", () => {
  const files = mergeAppliedPrFiles([
    card({
      status: "applied",
      messageTimestamp: 10,
      prFiles: [{ path: "src/a.ts", content: "a\n" }]
    }),
    card({
      status: "applied",
      messageTimestamp: 20,
      prFiles: [{ path: "src/b.ts", content: "b\n" }]
    }),
    card({ status: "pending", messageTimestamp: 30, prFiles: [{ path: "src/c.ts", content: "c\n" }] })
  ]);
  assert.deepEqual(files, [
    { path: "src/a.ts", content: "a\n" },
    { path: "src/b.ts", content: "b\n" }
  ]);
});

test("mergeAppliedPrPreviewFiles stacks hunks from every Apply", () => {
  const merged = mergeAppliedPrPreviewFiles([
    card({
      status: "applied",
      messageTimestamp: 10,
      files: [
        {
          relativePath: "src/a.ts",
          hunks: [
            {
              id: "h1",
              matchStatus: "matched",
              status: "applied",
              lines: [{ kind: "add", text: "one" }]
            }
          ]
        }
      ]
    }),
    card({
      status: "applied",
      messageTimestamp: 20,
      files: [
        {
          relativePath: "src/a.ts",
          hunks: [
            {
              id: "h2",
              matchStatus: "matched",
              status: "applied",
              lines: [{ kind: "add", text: "two" }]
            }
          ]
        }
      ]
    })
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.hunks.length, 2);
});

test("resolveCreatePrChatRouting opens confirm for last applied work", () => {
  const routing = resolveCreatePrChatRouting({
    asked: true,
    hasUseRepo: true,
    cards: [
      card({
        status: "applied",
        messageTimestamp: 22,
        canCreatePr: true,
        prFiles: [{ path: "src/a.ts", content: "ok\n" }]
      })
    ]
  });
  assert.equal(routing.kind, "open-confirm");
  if (routing.kind === "open-confirm") {
    assert.equal(routing.messageTimestamp, 22);
    assert.equal(routing.appliedEditCount, 1);
    assert.deepEqual(routing.files, [{ path: "src/a.ts", content: "ok\n" }]);
  }
  assert.equal(createPrChatReply(routing), CREATE_PR_CHAT_OPENED);
});

test("resolveCreatePrChatRouting bundles every Apply in the thread", () => {
  const routing = resolveCreatePrChatRouting({
    asked: true,
    hasUseRepo: true,
    cards: [
      card({
        status: "applied",
        messageTimestamp: 10,
        prFiles: [{ path: "src/a.ts", content: "a\n" }]
      }),
      card({
        status: "applied",
        messageTimestamp: 20,
        prFiles: [{ path: "src/b.ts", content: "b\n" }]
      })
    ]
  });
  assert.equal(routing.kind, "open-confirm");
  if (routing.kind === "open-confirm") {
    assert.equal(routing.messageTimestamp, 20);
    assert.equal(routing.appliedEditCount, 2);
    assert.equal(routing.files.length, 2);
  }
  assert.equal(createPrChatReply(routing), CREATE_PR_CHAT_OPENED_MULTI);
});

test("resolveCreatePrChatRouting asks to Apply when a patch is still pending", () => {
  const asked = isCreatePullRequestAsk("create a pr for the change i just made on line 12");
  const routing = resolveCreatePrChatRouting({
    asked,
    hasUseRepo: true,
    cards: [card({ status: "pending", messageTimestamp: 8 })]
  });
  assert.equal(asked, true);
  assert.equal(routing.kind, "need-apply-pending");
  assert.equal(createPrChatReply(routing), CREATE_PR_CHAT_NEED_APPLY_PENDING);
});

test("resolveCreatePrChatRouting asks for /edit when this thread has no applied work", () => {
  const routing = resolveCreatePrChatRouting({
    asked: true,
    hasUseRepo: true,
    cards: []
  });
  assert.equal(routing.kind, "need-apply");
  assert.equal(createPrChatReply(routing), CREATE_PR_CHAT_NEED_APPLY);
});

test("resolveCreatePrChatRouting requires Use-repo before opening confirm", () => {
  const routing = resolveCreatePrChatRouting({
    asked: true,
    hasUseRepo: false,
    cards: [
      card({
        status: "applied",
        messageTimestamp: 11,
        canCreatePr: true,
        prFiles: [{ path: "src/a.ts", content: "ok\n" }]
      })
    ]
  });
  assert.equal(routing.kind, "need-use-repo");
  assert.equal(createPrChatReply(routing), CREATE_PR_CHAT_NEED_USE_REPO);
});

test("resolveCreatePrChatRouting is none when the phrase did not match", () => {
  assert.equal(
    resolveCreatePrChatRouting({
      asked: false,
      hasUseRepo: true,
      cards: [card({ status: "applied", canCreatePr: true })]
    }).kind,
    "none"
  );
});

console.log(`\ncreatePrChatRouting: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
