import assert from "node:assert/strict";
import {
  CREATE_PR_DONE_LABEL,
  CREATE_PR_MODAL_CLASSES,
  CREATE_PR_SUCCESS_TITLE,
  CREATE_PULL_REQUEST_BUTTON_CLASS,
  CREATE_PULL_REQUEST_BUTTON_LABEL,
  PR_NOTES_AI_GENERATED_LABEL,
  createdPullRequestFromResult,
  createConfirmSubmitGuard,
  evaluateCreatePullRequest,
  filesWithContent,
  isPullRequestWriteSupported,
  openPullRequestOnHostLabel,
  prCreateErrorFromResult,
  pullRequestCreatedCopy,
  pullRequestHostLabel
} from "./createPullRequestConfirm";
import {
  GITHUB_APP_CANNOT_WRITE_REPO_MESSAGE,
  GITLAB_WRITE_PERMISSION_MESSAGE
} from "../api/codeHosts/pullRequestWrite";

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
await test("Notes field is labeled AI Generated", () => {
  assert.equal(PR_NOTES_AI_GENERATED_LABEL, "(AI Generated)");
});

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

await test("C-P4 GitLab and Bitbucket can confirm Create PR", () => {
  assert.equal(isPullRequestWriteSupported("gitlab"), true);
  assert.equal(isPullRequestWriteSupported("bitbucket"), true);
  assert.equal(
    evaluateCreatePullRequest(
      {
        provider: "gitlab",
        branch: "coop/patch",
        title: "Fixture",
        files: [{ path: "a.ts", content: "export {}\n" }]
      },
      "confirm"
    ).action,
    "create"
  );
});

await test("confirm keeps optional notes on the pull request body", () => {
  const draft = {
    provider: "github" as const,
    branch: "coop/patch",
    title: "Fixture",
    body: "Why this change.",
    files: [{ path: "a.ts", content: "export {}\n" }]
  };
  const result = evaluateCreatePullRequest(draft, "confirm");
  assert.equal(result.action, "create");
  if (result.action === "create") {
    assert.equal(result.payload.body, "Why this change.");
  }
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

await test("success copy and link label match the code host", () => {
  assert.equal(CREATE_PR_SUCCESS_TITLE, "Pull request created");
  assert.equal(CREATE_PR_DONE_LABEL, "Done");
  assert.equal(pullRequestHostLabel("github"), "GitHub");
  assert.equal(pullRequestHostLabel("gitlab"), "GitLab");
  assert.equal(pullRequestHostLabel("bitbucket"), "Bitbucket");
  assert.equal(pullRequestCreatedCopy("github"), "Opened on GitHub.");
  assert.equal(pullRequestCreatedCopy("gitlab"), "Opened on GitLab.");
  assert.equal(pullRequestCreatedCopy("bitbucket"), "Opened on Bitbucket.");
  assert.equal(openPullRequestOnHostLabel("github"), "Open on GitHub");
  assert.equal(openPullRequestOnHostLabel("gitlab"), "Open on GitLab");
  assert.equal(openPullRequestOnHostLabel("bitbucket"), "Open on Bitbucket");
});

await test("created result is only a host URL, never an error payload", () => {
  const created = createdPullRequestFromResult({
    htmlUrl: "https://gitlab.com/acme/plane/-/merge_requests/7",
    number: 7,
    provider: "gitlab"
  });
  assert.equal(created?.htmlUrl, "https://gitlab.com/acme/plane/-/merge_requests/7");
  assert.equal(prCreateErrorFromResult(created), undefined);
  assert.equal(
    prCreateErrorFromResult({ error: "GitHub App needs Contents and Pull requests write." }),
    "GitHub App needs Contents and Pull requests write."
  );
  assert.equal(
    prCreateErrorFromResult(
      { error: "GitHub refused to create this pull request. Nothing was created. Resource not accessible by integration" },
      "github"
    ),
    GITHUB_APP_CANNOT_WRITE_REPO_MESSAGE
  );
  assert.equal(
    prCreateErrorFromResult({ error: "GitLab refused to create this merge request. Nothing was created." }, "gitlab"),
    GITLAB_WRITE_PERMISSION_MESSAGE
  );
  assert.equal(createdPullRequestFromResult({ error: "failed" }), undefined);
});

console.log(`\ncreatePullRequestConfirm: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exitCode = 1;
}
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
