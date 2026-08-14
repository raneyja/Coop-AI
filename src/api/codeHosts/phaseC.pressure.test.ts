import assert from "node:assert/strict";
import { GitHubClient } from "./githubClient";
import {
  GITHUB_PR_REJECTED_MESSAGE,
  GITHUB_WRITE_PERMISSION_MESSAGE,
  PHASE_C_FIXTURE_FILES,
  PHASE_C_FIXTURE_REPO,
  createConfirmSubmitGuard,
  evaluateCreatePullRequest,
  resetPullCreateLocks,
  validateCreatePullRequestInput,
  withPullCreateLock
} from "./pullRequestWrite";
import { CodeHostError } from "./types";

const originalFetch = globalThis.fetch;
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

type RecordedCall = { method: string; url: string };

function installGithubMock(options?: {
  scopes?: string;
  push?: boolean;
  failPulls?: boolean;
  statusOnRepo?: number;
}): { calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, url });
    if (method === "GET" && /\/repos\/acme\/plane$/.test(url)) {
      if (options?.statusOnRepo) {
        return new Response(JSON.stringify({ message: "Forbidden" }), { status: options.statusOnRepo });
      }
      return new Response(
        JSON.stringify({ default_branch: "main", permissions: { push: options?.push ?? true } }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-oauth-scopes": options?.scopes ?? "repo"
          }
        }
      );
    }
    if (method === "GET" && url.includes("/git/ref/heads/")) {
      return new Response(JSON.stringify({ object: { sha: "base-commit" } }), { status: 200 });
    }
    if (method === "GET" && url.includes("/git/commits/")) {
      return new Response(JSON.stringify({ tree: { sha: "base-tree" } }), { status: 200 });
    }
    if (method === "POST" && url.endsWith("/git/blobs")) {
      return new Response(JSON.stringify({ sha: `blob-${calls.length}` }), { status: 201 });
    }
    if (method === "POST" && url.endsWith("/git/trees")) {
      return new Response(JSON.stringify({ sha: "new-tree" }), { status: 201 });
    }
    if (method === "POST" && url.endsWith("/git/commits")) {
      return new Response(JSON.stringify({ sha: "new-commit" }), { status: 201 });
    }
    if (method === "POST" && url.endsWith("/git/refs")) {
      return new Response(JSON.stringify({ ref: "refs/heads/coop/patch" }), { status: 201 });
    }
    if (method === "POST" && url.endsWith("/pulls")) {
      if (options?.failPulls) {
        return new Response(JSON.stringify({ message: "Validation Failed" }), { status: 422 });
      }
      return new Response(
        JSON.stringify({ number: 7, html_url: "https://github.com/acme/plane/pull/7" }),
        { status: 201 }
      );
    }
    return new Response(JSON.stringify({ message: "unexpected" }), { status: 500 });
  }) as typeof fetch;
  return { calls };
}

void (async () => {
await test("C-P1 missing contents/pull_requests → permission error, nothing created", async () => {
  const { calls } = installGithubMock({ scopes: "read:user" });
  try {
    await assert.rejects(
      () =>
        new GitHubClient({ token: "gho_limited" }).createPullFromFiles(PHASE_C_FIXTURE_REPO, {
          branch: "coop/patch",
          title: "Fixture",
          files: PHASE_C_FIXTURE_FILES
        }),
      (error: unknown) =>
        error instanceof CodeHostError &&
        error.code === "auth" &&
        error.message === GITHUB_WRITE_PERMISSION_MESSAGE
    );
    assert.equal(
      calls.filter((call) => call.method === "POST").length,
      0,
      "no write calls after a permission failure"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await test("C-P2 double-click confirm → one PR", async () => {
  resetPullCreateLocks();
  let runs = 0;
  const first = withPullCreateLock("org:github:acme/plane:coop/patch", async () => {
    runs += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return {
      number: 1,
      htmlUrl: "https://github.com/acme/plane/pull/1",
      branch: "coop/patch",
      commitSha: "abc",
      title: "Fixture"
    };
  });
  const second = withPullCreateLock("org:github:acme/plane:coop/patch", async () => {
    runs += 1;
    return {
      number: 2,
      htmlUrl: "https://github.com/acme/plane/pull/2",
      branch: "coop/patch",
      commitSha: "def",
      title: "Fixture"
    };
  });
  const [a, b] = await Promise.all([first, second]);
  assert.equal(runs, 1);
  assert.equal(a.number, 1);
  assert.equal(b.number, 1);
  resetPullCreateLocks();

  const guard = createConfirmSubmitGuard();
  let confirms = 0;
  const slow = guard(async () => {
    confirms += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  const skipped = await guard(async () => {
    confirms += 1;
  });
  await slow;
  assert.equal(confirms, 1);
  assert.equal(skipped, "skipped");
});

await test("C-P3 API 422 → error, no half-branch claimed as success", async () => {
  const { calls } = installGithubMock({ failPulls: true });
  try {
    await assert.rejects(
      () =>
        new GitHubClient({ token: "ghs_test" }).createPullFromFiles(PHASE_C_FIXTURE_REPO, {
          branch: "coop/patch",
          title: "Fixture",
          files: PHASE_C_FIXTURE_FILES
        }),
      (error: unknown) =>
        error instanceof CodeHostError &&
        error.status === 422 &&
        error.message === GITHUB_PR_REJECTED_MESSAGE
    );
    assert.ok(calls.some((call) => call.method === "POST" && call.url.endsWith("/git/refs")));
    assert.ok(calls.some((call) => call.method === "POST" && call.url.endsWith("/pulls")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await test("C-P4 GitLab Use-repo → Not yet", () => {
  const result = evaluateCreatePullRequest(
    {
      provider: "gitlab",
      branch: "coop/patch",
      title: "Fixture",
      files: PHASE_C_FIXTURE_FILES
    },
    "confirm"
  );
  assert.deepEqual(result, { action: "nothing", reason: "not_yet" });
});

await test("C-P5 empty file list blocked", () => {
  assert.equal(
    validateCreatePullRequestInput({
      branch: "coop/patch",
      title: "Fixture",
      files: []
    }),
    "Select at least one file to include in the pull request."
  );
  assert.deepEqual(
    evaluateCreatePullRequest(
      { provider: "github", branch: "coop/patch", title: "Fixture", files: [] },
      "confirm"
    ),
    { action: "nothing", reason: "empty_files" }
  );
});

console.log(`\nphaseC.pressure: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exitCode = 1;
}
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
