import assert from "node:assert/strict";
import { GitHubClient } from "./githubClient";
import { GitLabClient } from "./gitlabClient";
import { BitbucketClient } from "./bitbucketClient";
import {
  GITHUB_PR_REJECTED_MESSAGE,
  GITHUB_PR_WRITE_FAILED_MESSAGE,
  GITHUB_WRITE_PERMISSION_MESSAGE,
  GITLAB_WRITE_PERMISSION_MESSAGE,
  GITLAB_PR_REJECTED_MESSAGE,
  BITBUCKET_WRITE_PERMISSION_MESSAGE,
  BITBUCKET_PR_REJECTED_MESSAGE,
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
    if (method === "GET" && url.includes("/git/matching-refs/")) {
      if (url.includes("coop")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(
        JSON.stringify([{ ref: "refs/heads/main", object: { sha: "base-sha" } }]),
        { status: 200 }
      );
    }
    if (method === "POST" && url.endsWith("/git/refs")) {
      return new Response(JSON.stringify({ ref: "refs/heads/coop/patch" }), { status: 201 });
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

await test("GitHub Contents 403 explains App cannot write this repo", async () => {
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
        error.message === GITHUB_PR_WRITE_FAILED_MESSAGE &&
        !error.message.includes("Resource not accessible by integration")
    );
    assert.equal(calls.filter((call) => call.method === "POST" && call.url.endsWith("/pulls")).length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await test("GitLab and Bitbucket grant checks match write scopes", () => {
  assert.equal(githubAppInstallationHasPullWrite({ contents: "read", pull_requests: "read" }), false);
  assert.equal(githubAppInstallationHasPullWrite({ contents: "write", pull_requests: "write" }), true);
  assert.equal(gitlabScopesAllowPullWrite(new Set(["api"])), true);
  assert.equal(gitlabScopesAllowPullWrite(new Set(["api", "write_repository"])), true);
  assert.equal(gitlabScopesAllowPullWrite(new Set(["write_repository"])), false);
  assert.equal(gitlabScopesAllowPullWrite(new Set(["read_api"])), false);
  assert.equal(bitbucketScopesAllowPullWrite(new Set(["repository:write"])), false);
  assert.equal(bitbucketScopesAllowPullWrite(new Set(["repository:write", "pullrequest:write"])), true);
  assert.equal(bitbucketScopesAllowPullWrite(new Set(["pullrequest:write"])), true);
  assert.equal(
    bitbucketScopesAllowPullWrite(new Set(["write:repository:bitbucket", "write:pullrequest:bitbucket"])),
    true
  );
});

await test("Bitbucket GET accepted-scopes (read) must not block a write token", async () => {
  const requested: string[] = [];
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    requested.push(`${method} ${url}`);
    if (method === "GET" && /\/repositories\/acme\/plane$/.test(url)) {
      return new Response(JSON.stringify({ slug: "plane" }), {
        status: 200,
        headers: { "content-type": "application/json", "x-accepted-oauth-scopes": "repository" }
      });
    }
    if (url.includes("/refs/branches/") && method === "GET") {
      if (url.includes("coop")) {
        return new Response(JSON.stringify({ error: { message: "Not found" } }), { status: 404 });
      }
      return new Response(JSON.stringify({ target: { hash: "parent-sha" } }), { status: 200 });
    }
    if (url.endsWith("/repositories/acme/plane/src") && method === "POST") {
      const body = init?.body;
      if (body instanceof FormData) {
        const uploaded = body.get("/apps/api/auth.ts") ?? body.get("apps/api/auth.ts");
        if (!(uploaded instanceof Blob)) {
          return new Response(JSON.stringify({ error: { message: "files must be uploads" } }), { status: 400 });
        }
      }
      return new Response(JSON.stringify({ hash: "bb-commit" }), { status: 201 });
    }
    if (url.endsWith("/repositories/acme/plane/pullrequests") && method === "POST") {
      return new Response(
        JSON.stringify({
          id: 9,
          links: { html: { href: "https://bitbucket.org/acme/plane/pull-requests/9" } }
        }),
        { status: 201 }
      );
    }
    return new Response(JSON.stringify({ message: "unexpected", url }), { status: 500 });
  }) as typeof fetch;
  try {
    const result = await new BitbucketClient({ token: "bb" }).createPullFromFiles(
      { ...PHASE_C_FIXTURE_REPO, provider: "bitbucket" },
      { branch: "coop/patch", title: "Fixture", files: PHASE_C_FIXTURE_FILES }
    );
    assert.equal(result.number, 9);
    assert.ok(requested.some((entry) => entry.startsWith("POST ") && entry.endsWith("/src")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await test("Bitbucket src 201 with empty JSON uses the Location commit id", async () => {
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "GET" && /\/repositories\/acme\/plane$/.test(url)) {
      return new Response(JSON.stringify({ slug: "plane" }), { status: 200 });
    }
    if (url.includes("/refs/branches/") && method === "GET") {
      if (url.includes("coop")) {
        return new Response(JSON.stringify({ error: { message: "Not found" } }), { status: 404 });
      }
      return new Response(JSON.stringify({ target: { hash: "parent-sha" } }), { status: 200 });
    }
    if (url.endsWith("/repositories/acme/plane/src") && method === "POST") {
      return new Response("", {
        status: 201,
        headers: {
          location: "https://api.bitbucket.org/2.0/repositories/acme/plane/commit/aabbccddeeff0011"
        }
      });
    }
    if (url.endsWith("/repositories/acme/plane/pullrequests") && method === "POST") {
      return new Response(
        JSON.stringify({
          id: 11,
          links: { html: { href: "https://bitbucket.org/acme/plane/pull-requests/11" } }
        }),
        { status: 201 }
      );
    }
    return new Response(JSON.stringify({ message: "unexpected", url }), { status: 500 });
  }) as typeof fetch;
  try {
    const result = await new BitbucketClient({ token: "bb" }).createPullFromFiles(
      { ...PHASE_C_FIXTURE_REPO, provider: "bitbucket" },
      { branch: "coop/patch", title: "Fixture", files: PHASE_C_FIXTURE_FILES }
    );
    assert.equal(result.number, 11);
    assert.equal(result.commitSha, "aabbccddeeff0011");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await test("Bitbucket src no-changes still opens a PR on the existing branch", async () => {
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "GET" && /\/repositories\/acme\/plane$/.test(url)) {
      return new Response(JSON.stringify({ slug: "plane" }), { status: 200 });
    }
    if (url.includes("/refs/branches/") && method === "GET") {
      if (url.includes("coop")) {
        return new Response(JSON.stringify({ target: { hash: "already-committed" } }), { status: 200 });
      }
      return new Response(JSON.stringify({ target: { hash: "parent-sha" } }), { status: 200 });
    }
    if (url.endsWith("/src") && method === "POST") {
      return new Response(JSON.stringify({ error: { message: "There are no changes to be committed." } }), {
        status: 400
      });
    }
    if (url.endsWith("/pullrequests") && method === "POST") {
      return new Response(
        JSON.stringify({
          id: 12,
          links: { html: { href: "https://bitbucket.org/acme/plane/pull-requests/12" } }
        }),
        { status: 201 }
      );
    }
    return new Response(JSON.stringify({ message: "unexpected", url }), { status: 500 });
  }) as typeof fetch;
  try {
    const result = await new BitbucketClient({ token: "bb" }).createPullFromFiles(
      { ...PHASE_C_FIXTURE_REPO, provider: "bitbucket" },
      { branch: "coop/patch", title: "Fixture", files: PHASE_C_FIXTURE_FILES }
    );
    assert.equal(result.number, 12);
    assert.equal(result.commitSha, "already-committed");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await test("Bitbucket 400 surfaces the host's reason, not a bare rejection", async () => {
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "GET" && /\/repositories\/acme\/plane$/.test(url)) {
      return new Response(JSON.stringify({ slug: "plane" }), { status: 200 });
    }
    if (url.includes("/refs/branches/") && method === "GET") {
      if (url.includes("coop")) {
        return new Response(JSON.stringify({ error: { message: "Not found" } }), { status: 404 });
      }
      return new Response(JSON.stringify({ target: { hash: "parent-sha" } }), { status: 200 });
    }
    if (url.endsWith("/src") && method === "POST") {
      return new Response(JSON.stringify({ hash: "bb-commit" }), { status: 201 });
    }
    if (url.endsWith("/pullrequests") && method === "POST") {
      return new Response(
        JSON.stringify({ type: "error", error: { message: "There are no changes to be pulled." } }),
        { status: 400 }
      );
    }
    return new Response(JSON.stringify({ message: "unexpected" }), { status: 500 });
  }) as typeof fetch;
  try {
    await assert.rejects(
      () =>
        new BitbucketClient({ token: "bb" }).createPullFromFiles(
          { ...PHASE_C_FIXTURE_REPO, provider: "bitbucket" },
          { branch: "coop/patch", title: "Fixture", files: PHASE_C_FIXTURE_FILES }
        ),
      (error: unknown) =>
        error instanceof CodeHostError &&
        error.message.startsWith(BITBUCKET_PR_REJECTED_MESSAGE) &&
        error.message.includes("There are no changes to be pulled.")
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await test("Bitbucket token with only repository read still blocks before writes", async () => {
  const requested: string[] = [];
  globalThis.fetch = (async (input: string | URL) => {
    const url = String(input);
    requested.push(url);
    if (/\/repositories\/acme\/plane$/.test(url)) {
      return new Response(JSON.stringify({ slug: "plane" }), {
        status: 200,
        headers: { "content-type": "application/json", "x-oauth-scopes": "account repository" }
      });
    }
    return new Response(JSON.stringify({ message: "unexpected" }), { status: 500 });
  }) as typeof fetch;
  try {
    await assert.rejects(
      () =>
        new BitbucketClient({ token: "bb" }).createPullFromFiles(
          { ...PHASE_C_FIXTURE_REPO, provider: "bitbucket" },
          { branch: "coop/patch", title: "Fixture", files: PHASE_C_FIXTURE_FILES }
        ),
      (error: unknown) =>
        error instanceof CodeHostError && error.message === BITBUCKET_WRITE_PERMISSION_MESSAGE
    );
    assert.equal(requested.some((url) => url.endsWith("/src")), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await test("GitLab token/info without api blocks before commits", async () => {
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

await test("GitLab token/info with api only does not require write_repository", async () => {
  const requested: string[] = [];
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    requested.push(`${method} ${url}`);
    if (url.includes("/oauth/token/info")) {
      return new Response(JSON.stringify({ scope: ["api"] }), { status: 200 });
    }
    if (url.includes("gitlab.com/api/v4/projects/acme%2Fplane") && method === "GET" && !url.includes("/repository/")) {
      return new Response(JSON.stringify({ id: 99 }), { status: 200 });
    }
    if (url.includes("/projects/99/repository/files/") && method === "GET") {
      return new Response(JSON.stringify({ message: "404 File Not Found" }), { status: 404 });
    }
    if (url.includes("/repository/branches/") && method === "GET") {
      return new Response(JSON.stringify({ message: "404 Branch Not Found" }), { status: 404 });
    }
    if (url.includes("/projects/99/repository/commits") && method === "POST") {
      return new Response(JSON.stringify({ id: "gl-commit" }), { status: 201 });
    }
    if (url.includes("/projects/99/merge_requests") && method === "POST") {
      return new Response(
        JSON.stringify({ iid: 7, web_url: "https://gitlab.com/acme/plane/-/merge_requests/7" }),
        { status: 201 }
      );
    }
    return new Response(JSON.stringify({ message: "unexpected", url }), { status: 500 });
  }) as typeof fetch;
  try {
    const result = await new GitLabClient({ token: "glpat" }).createPullFromFiles(
      { ...PHASE_C_FIXTURE_REPO, provider: "gitlab" },
      { branch: "coop/patch", title: "Fixture", files: PHASE_C_FIXTURE_FILES }
    );
    assert.equal(result.number, 7);
    assert.equal(result.htmlUrl, "https://gitlab.com/acme/plane/-/merge_requests/7");
    assert.equal(requested.some((entry) => entry.includes("/repository/commits")), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await test("GitLab commits onto an existing coop/patch instead of recreating it", async () => {
  let commitBody: { start_branch?: string; branch?: string } | undefined;
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.includes("/oauth/token/info")) {
      return new Response(JSON.stringify({ scope: ["api"] }), { status: 200 });
    }
    if (url.includes("gitlab.com/api/v4/projects/acme%2Fplane") && method === "GET" && !url.includes("/repository/")) {
      return new Response(JSON.stringify({ id: 99 }), { status: 200 });
    }
    if (url.includes("/repository/branches/") && method === "GET") {
      return new Response(JSON.stringify({ name: "coop/patch", commit: { id: "already-committed" } }), {
        status: 200
      });
    }
    if (url.includes("/projects/99/repository/files/") && method === "GET") {
      return new Response(JSON.stringify({ file_path: "apps/api/auth.ts" }), { status: 200 });
    }
    if (url.includes("/projects/99/repository/commits") && method === "POST") {
      commitBody = JSON.parse(String(init?.body ?? "{}")) as { start_branch?: string; branch?: string };
      return new Response(JSON.stringify({ id: "gl-commit-2" }), { status: 201 });
    }
    if (url.includes("/projects/99/merge_requests") && method === "POST") {
      return new Response(
        JSON.stringify({ iid: 8, web_url: "https://gitlab.com/acme/plane/-/merge_requests/8" }),
        { status: 201 }
      );
    }
    return new Response(JSON.stringify({ message: "unexpected", url }), { status: 500 });
  }) as typeof fetch;
  try {
    const result = await new GitLabClient({ token: "glpat" }).createPullFromFiles(
      { ...PHASE_C_FIXTURE_REPO, provider: "gitlab" },
      { branch: "coop/patch", title: "Fixture", files: PHASE_C_FIXTURE_FILES }
    );
    assert.equal(result.number, 8);
    assert.equal(result.commitSha, "gl-commit-2");
    assert.equal(commitBody?.branch, "coop/patch");
    assert.equal(commitBody?.start_branch, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await test("GitLab no-changes on an existing branch still opens a merge request", async () => {
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.includes("/oauth/token/info")) {
      return new Response(JSON.stringify({ scope: ["api"] }), { status: 200 });
    }
    if (url.includes("gitlab.com/api/v4/projects/acme%2Fplane") && method === "GET" && !url.includes("/repository/")) {
      return new Response(JSON.stringify({ id: 99 }), { status: 200 });
    }
    if (url.includes("/repository/branches/") && method === "GET") {
      return new Response(JSON.stringify({ name: "coop/patch", commit: { id: "already-committed" } }), {
        status: 200
      });
    }
    if (url.includes("/projects/99/repository/files/") && method === "GET") {
      return new Response(JSON.stringify({ file_path: "apps/api/auth.ts" }), { status: 200 });
    }
    if (url.includes("/projects/99/repository/commits") && method === "POST") {
      return new Response(JSON.stringify({ message: "You don't have any changes to commit." }), { status: 400 });
    }
    if (url.includes("/projects/99/merge_requests") && method === "POST") {
      return new Response(
        JSON.stringify({ iid: 9, web_url: "https://gitlab.com/acme/plane/-/merge_requests/9" }),
        { status: 201 }
      );
    }
    return new Response(JSON.stringify({ message: "unexpected", url }), { status: 500 });
  }) as typeof fetch;
  try {
    const result = await new GitLabClient({ token: "glpat" }).createPullFromFiles(
      { ...PHASE_C_FIXTURE_REPO, provider: "gitlab" },
      { branch: "coop/patch", title: "Fixture", files: PHASE_C_FIXTURE_FILES }
    );
    assert.equal(result.number, 9);
    assert.equal(result.commitSha, "already-committed");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await test("GitLab existing merge request is returned instead of a generic rejection", async () => {
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.includes("/oauth/token/info")) {
      return new Response(JSON.stringify({ scope: ["api"] }), { status: 200 });
    }
    if (url.includes("gitlab.com/api/v4/projects/acme%2Fplane") && method === "GET" && !url.includes("/repository/")) {
      return new Response(JSON.stringify({ id: 99 }), { status: 200 });
    }
    if (url.includes("/repository/branches/") && method === "GET") {
      return new Response(JSON.stringify({ message: "404 Branch Not Found" }), { status: 404 });
    }
    if (url.includes("/projects/99/repository/files/") && method === "GET") {
      return new Response(JSON.stringify({ message: "404 File Not Found" }), { status: 404 });
    }
    if (url.includes("/projects/99/repository/commits") && method === "POST") {
      return new Response(JSON.stringify({ id: "gl-commit" }), { status: 201 });
    }
    if (url.includes("/projects/99/merge_requests") && method === "POST") {
      return new Response(
        JSON.stringify({ message: ["Another open merge request already exists for this source branch: !7"] }),
        { status: 409 }
      );
    }
    if (url.includes("/projects/99/merge_requests") && method === "GET") {
      return new Response(
        JSON.stringify([{ iid: 7, web_url: "https://gitlab.com/acme/plane/-/merge_requests/7" }]),
        { status: 200 }
      );
    }
    return new Response(JSON.stringify({ message: "unexpected", url }), { status: 500 });
  }) as typeof fetch;
  try {
    const result = await new GitLabClient({ token: "glpat" }).createPullFromFiles(
      { ...PHASE_C_FIXTURE_REPO, provider: "gitlab" },
      { branch: "coop/patch", title: "Fixture", files: PHASE_C_FIXTURE_FILES }
    );
    assert.equal(result.number, 7);
    assert.equal(result.htmlUrl, "https://gitlab.com/acme/plane/-/merge_requests/7");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await test("GitLab 400 surfaces the host's reason, not a bare rejection", async () => {
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.includes("/oauth/token/info")) {
      return new Response(JSON.stringify({ scope: ["api"] }), { status: 200 });
    }
    if (url.includes("gitlab.com/api/v4/projects/acme%2Fplane") && method === "GET" && !url.includes("/repository/")) {
      return new Response(JSON.stringify({ id: 99 }), { status: 200 });
    }
    if (url.includes("/repository/branches/") && method === "GET") {
      return new Response(JSON.stringify({ message: "404 Branch Not Found" }), { status: 404 });
    }
    if (url.includes("/projects/99/repository/files/") && method === "GET") {
      return new Response(JSON.stringify({ message: "404 File Not Found" }), { status: 404 });
    }
    if (url.includes("/projects/99/repository/commits") && method === "POST") {
      return new Response(JSON.stringify({ message: "A file with this name already exists" }), { status: 400 });
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
        error instanceof CodeHostError &&
        error.message.startsWith(GITLAB_PR_REJECTED_MESSAGE) &&
        error.message.includes("A file with this name already exists")
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await test("GitHub creates coop/patch from the base branch before writing files", async () => {
  const { calls } = installGithubMock();
  try {
    await new GitHubClient({ token: "ghs_installation" }).createPullFromFiles(PHASE_C_FIXTURE_REPO, {
      branch: "coop/patch",
      title: "Fixture",
      files: PHASE_C_FIXTURE_FILES
    });
    assert.ok(calls.some((call) => call.method === "POST" && call.url.endsWith("/git/refs")));
    const refIndex = calls.findIndex((call) => call.method === "POST" && call.url.endsWith("/git/refs"));
    const putIndex = calls.findIndex((call) => call.method === "PUT" && call.url.includes("/contents/"));
    assert.ok(putIndex > refIndex);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await test("GitHub missing base branch is not a generic Resource not found", async () => {
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "GET" && /\/repos\/acme\/plane$/.test(url)) {
      return new Response(JSON.stringify({ default_branch: "main" }), {
        status: 200,
        headers: { "content-type": "application/json", "x-oauth-scopes": "repo" }
      });
    }
    if (method === "GET" && url.includes("/git/matching-refs/")) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    return new Response(JSON.stringify({ message: "unexpected" }), { status: 500 });
  }) as typeof fetch;
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
        error.code === "not_found" &&
        error.message.includes("base branch main") &&
        !error.message.startsWith("Resource not found.")
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
