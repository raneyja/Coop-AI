import assert from "node:assert/strict";
import {
  CREATE_PR_MODAL_CLASSES,
  CREATE_PR_NOT_YET_LABEL,
  CREATE_PULL_REQUEST_BUTTON_CLASS,
  CREATE_PULL_REQUEST_BUTTON_LABEL,
  createConfirmSubmitGuard,
  evaluateCreatePullRequest,
  filesWithContent,
  isPullRequestWriteSupported
} from "./createPullRequestConfirm";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`  ✓ ${name}`);
      passed += 1;
    })
    .catch((err) => {
      console.error(`  ✗ ${name}`);
      console.error(`    ${err instanceof Error ? err.message : String(err)}`);
      failed += 1;
    });
}

void (async () => {
await test("UX-G3 / C-G6 confirm uses Prompt Library modal family", () => {
  assert.equal(CREATE_PR_MODAL_CLASSES.backdrop, "coop-prompt-modal-backdrop");
  assert.equal(CREATE_PR_MODAL_CLASSES.dialog, "coop-prompt-modal");
  assert.equal(CREATE_PR_MODAL_CLASSES.titleId, "coop-create-pr-modal-title");
});

await test("UX-G4 trigger is a quiet coop-text-btn", () => {
  assert.equal(CREATE_PULL_REQUEST_BUTTON_CLASS, "coop-text-btn");
  assert.equal(CREATE_PULL_REQUEST_BUTTON_LABEL, "Create pull request");
});

await test("C-G2 Escape/backdrop dismiss and Cancel create nothing", () => {
  const draft = {
    provider: "github" as const,
    branch: "coop/patch",
    title: "Fixture",
    files: [{ path: "a.ts", content: "export {}\n" }]
  };
  assert.equal(evaluateCreatePullRequest(draft, "cancel").action, "nothing");
  assert.equal(evaluateCreatePullRequest(draft, "dismiss").action, "nothing");
});

await test("C-P4 GitLab / Bitbucket stay Not yet", () => {
  assert.equal(isPullRequestWriteSupported("gitlab"), false);
  assert.equal(isPullRequestWriteSupported("bitbucket"), false);
  assert.equal(CREATE_PR_NOT_YET_LABEL, "Not yet");
});

await test("C-P5 files without content are dropped", () => {
  assert.deepEqual(filesWithContent([{ path: "a.ts", content: "" }, { path: "b.ts" }]), []);
});

await test("C-P2 confirm guard skips a second in-flight submit", async () => {
  const guard = createConfirmSubmitGuard();
  let runs = 0;
  const first = guard(async () => {
    runs += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
  const second = await guard(async () => {
    runs += 1;
  });
  await first;
  assert.equal(runs, 1);
  assert.equal(second, "skipped");
});

console.log(`\ncreatePullRequestConfirm: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exitCode = 1;
}
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
