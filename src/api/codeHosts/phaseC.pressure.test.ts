import assert from "node:assert/strict";
import { GitHubClient } from "./githubClient";
import { GitLabClient } from "./gitlabClient";
import {
  GITHUB_PR_REJECTED_MESSAGE,
  GITHUB_PR_WRITE_FAILED_MESSAGE,
  GITHUB_WRITE_PERMISSION_MESSAGE,
  GITLAB_WRITE_PERMISSION_MESSAGE,
  PHASE_C_FIXTURE_FILES,
  PHASE_C_FIXTURE_REPO,
  bitbucketScopesAllowPullWrite,
  createConfirmSubmitGuard,
  evaluateCreatePullRequest,
  githubAppInstallationHasPullWrite,
  githubWriteBlockedByCollaboratorPush,
  gitlabScopesAllowPullWrite,
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
  scopes?: string | null;
  push?: boolean;
  failPulls?: boolean;
  failContents?: boolean;
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
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (options?.scopes !== null) {
        headers["x-oauth-scopes"] = options?.scopes ?? "repo";
      }
      return new Response(
        JSON.stringify({ default_branch: "main", permissions: { push: options?.push ?? true } }),
        {
          status: 200,
          headers
        }
      );
    }
    if (method === "GET" && url.includes("/contents/")) {
      return new Response(JSON.stringify({ sha: "file-sha", type: "file" }), { status: 200 });
    }
    if (method === "PUT" && url.includes("/contents/")) {
      if (options?.failContents) {
        return new Response(JSON.stringify({ message: "Resource not accessible by integration" }), {
          status: 403
        });
      }
      return new Response(
        JSON.stringify({ commit: { sha: "new-commit" }, content: { sha: "new-file-sha" } }),
        { status: 201 }
      );
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
      calls.filter((call) => call.method === "POST" || call.method === "PUT").length,
      0,
      "no write calls after a permission failure"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await test("GitHub App tokens are not blocked by collaborator push=false", async () => {
  assert.equal(githubWriteBlockedByCollaboratorPush(undefined, false), false);
  assert.equal(githubWriteBlockedByCollaboratorPush("repo", false), true);
  const { calls } = installGithubMock({ scopes: null, push: false });
  try {
    const result = await new GitHubClient({ token: "ghs_installation" }).createPullFromFiles(PHASE_C_FIXTURE_REPO, {
      branch: "coop/patch",
      title: "Fixture",
      files: PHASE_C_FIXTURE_FILES
    });
    assert.equal(result.htmlUrl, "https://github.com/acme/plane/pull/7");
    assert.ok(calls.some((call) => call.method === "PUT" && call.url.includes("/contents/")));
    assert.ok(calls.some((call) => call.method === "POST" && call.url.endsWith("/pulls")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await test("GitHub Contents 403 surfaces GitHub's refusal, not Accept copy", async () => {
  const { calls } = installGithubMock({ scopes: null, failContents: true });
  try {
    await assert.rejects(
      () =>
        new GitHubClient({ token: "ghs_installation" }).createPullFromFiles(PHASE_C_FIXTURE_REPO, {
          branch: "coop/patch",
          title: "Fixture",
          files: PHASE_C_FIXTURE_FILES
        }),
      (error: unknown) =>
        error instanceof CodeHostError &&
        error.message.startsWith(GITHUB_PR_WRITE_FAILED_MESSAGE) &&
        error.message.includes("Resource not accessible by integration")
    );
    assert.equal(calls.filter((call) => call.method === "POST" && call.url.endsWith("/pulls")).length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await test("GitLab and Bitbucket grant checks match write scopes", () => {
  assert.equal(githubAppInstallationHasPullWrite({ contents: "read", pull_requests: "read" }), false);
  assert.equal(githubAppInstallationHasPullWrite({ contents: "write", pull_requests: "write" }), true);
  assert.equal(gitlabScopesAllowPullWrite(new Set(["api"])), false);
  assert.equal(gitlabScopesAllowPullWrite(new Set(["api", "write_repository"])), true);
  assert.equal(bitbucketScopesAllowPullWrite(new Set(["repository:write"])), false);
  assert.equal(bitbucketScopesAllowPullWrite(new Set(["repository:write", "pullrequest:write"])), true);
});

await test("GitLab token/info without write_repository blocks before commits", async () => {
  const requested: string[] = [];
  globalThis.fetch = (async (input: string | URL) => {
    const url = String(input);
    requested.push(url);
    if (url.includes("/oauth/token/info")) {
      return new Response(JSON.stringify({ scope: ["read_api"] }), { status: 200 });
    }
    return new Response(JSON.stringify({ message: "unexpected" }), { status: 500 });
  }) as typeof fetch;
  try {
    await assert.rejects(
      () =>
        new GitLabClient({ token: "glpat" }).createPullFromFiles(
          { ...PHASE_C_FIXTURE_REPO, provider: "gitlab" },
          { branch: "coop/patch", title: "Fixture", files: PHASE_C_FIXTURE_FILES }
        ),
      (error: unknown) =>
        error instanceof CodeHostError && error.message === GITLAB_WRITE_PERMISSION_MESSAGE
    );
    assert.equal(requested.some((url) => url.includes("/repository/commits")), false);
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
    assert.ok(calls.some((call) => call.method === "PUT" && call.url.includes("/contents/")));
    assert.ok(calls.some((call) => call.method === "POST" && call.url.endsWith("/pulls")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await test("C-P4 GitLab confirm is allowed", () => {
  const result = evaluateCreatePullRequest(
    {
      provider: "gitlab",
      branch: "coop/patch",
      title: "Fixture",
      files: PHASE_C_FIXTURE_FILES
    },
    "confirm"
  );
  assert.equal(result.action, "create");
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
