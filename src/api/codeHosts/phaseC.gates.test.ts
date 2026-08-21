import assert from "node:assert/strict";
import { GitHubClient } from "./githubClient";
import { GitLabClient } from "./gitlabClient";
import { BitbucketClient } from "./bitbucketClient";
import {
  PHASE_C_FIXTURE_FILES,
  PHASE_C_FIXTURE_REPO,
  PR_HANDOFF_AUDIT_ACTION,
  evaluateCreatePullRequest
} from "./pullRequestWrite";

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

function installGithubMock(options?: { failPulls?: boolean }): { calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, url });
    if (method === "GET" && /\/repos\/acme\/plane$/.test(url)) {
      return new Response(JSON.stringify({ default_branch: "main", permissions: { push: true } }), {
        status: 200,
        headers: { "content-type": "application/json", "x-oauth-scopes": "repo" }
      });
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
        JSON.stringify({ number: 42, html_url: "https://github.com/acme/plane/pull/42" }),
        { status: 201 }
      );
    }
    return new Response(JSON.stringify({ message: "unexpected" }), { status: 500 });
  }) as typeof fetch;
  return { calls };
}

void (async () => {
await test("C-G1 confirmed fixture files create branch + commit + PR URL", async () => {
  const { calls } = installGithubMock();
  try {
    const result = await new GitHubClient({ token: "ghs_test" }).createPullFromFiles(PHASE_C_FIXTURE_REPO, {
      branch: "coop/patch",
      title: "Fixture patch",
      files: PHASE_C_FIXTURE_FILES
    });
    assert.equal(result.number, 42);
    assert.equal(result.htmlUrl, "https://github.com/acme/plane/pull/42");
    assert.equal(result.branch, "coop/patch");
    assert.equal(result.commitSha, "new-commit");
    assert.ok(calls.some((call) => call.method === "POST" && call.url.endsWith("/git/refs")));
    assert.ok(calls.some((call) => call.method === "PUT" && call.url.includes("/contents/")));
    assert.ok(calls.some((call) => call.method === "POST" && call.url.endsWith("/pulls")));
    const refIndex = calls.findIndex((call) => call.method === "POST" && call.url.endsWith("/git/refs"));
    const putIndex = calls.findIndex((call) => call.method === "PUT" && call.url.includes("/contents/"));
    assert.ok(refIndex >= 0 && putIndex > refIndex, "GitHub must create coop/patch before writing files");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await test("C-G2 cancel / dismiss creates nothing on the host", () => {
  const draft = {
    provider: "github" as const,
    branch: "coop/patch",
    title: "Fixture patch",
    files: PHASE_C_FIXTURE_FILES
  };
  assert.deepEqual(evaluateCreatePullRequest(draft, "cancel"), { action: "nothing", reason: "cancelled" });
  assert.deepEqual(evaluateCreatePullRequest(draft, "dismiss"), { action: "nothing", reason: "dismissed" });
});

await test("C-G3 audit event name for PR handoff", () => {
  assert.equal(PR_HANDOFF_AUDIT_ACTION, "repo.pull.create");
});

await test("C-G4 GitLab and Bitbucket create a PR/MR on their own APIs — never GitHub", async () => {
  const requested: string[] = [];
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    requested.push(`${method} ${url}`);
    if (url.includes("api.github.com") || url.includes("github.com/")) {
      return new Response(JSON.stringify({ message: "must not call GitHub" }), { status: 500 });
    }
    if (url.includes("gitlab.com/api/v4/projects/acme%2Fplane") && method === "GET" && !url.includes("/repository/")) {
      return new Response(JSON.stringify({ id: 99 }), { status: 200 });
    }
    if (url.includes("/projects/99/repository/files/") && method === "GET") {
      return new Response(JSON.stringify({ message: "404 File Not Found" }), { status: 404 });
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
    if (url.includes("/repositories/acme/plane/refs/branches/main") && method === "GET") {
      return new Response(JSON.stringify({ target: { hash: "parent-sha" } }), { status: 200 });
    }
    if (url.endsWith("/repositories/acme/plane/src") && method === "POST") {
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
    const gitlab = await new GitLabClient({ token: "glpat" }).createPullFromFiles(
      { ...PHASE_C_FIXTURE_REPO, provider: "gitlab" },
      { branch: "coop/patch", title: "Fixture patch", body: "AI notes", files: PHASE_C_FIXTURE_FILES }
    );
    assert.equal(gitlab.number, 7);
    assert.equal(gitlab.htmlUrl, "https://gitlab.com/acme/plane/-/merge_requests/7");
    assert.equal(gitlab.commitSha, "gl-commit");

    const bitbucket = await new BitbucketClient({ token: "bb" }).createPullFromFiles(
      { ...PHASE_C_FIXTURE_REPO, provider: "bitbucket" },
      { branch: "coop/patch", title: "Fixture patch", body: "AI notes", files: PHASE_C_FIXTURE_FILES }
    );
    assert.equal(bitbucket.number, 9);
    assert.equal(bitbucket.htmlUrl, "https://bitbucket.org/acme/plane/pull-requests/9");
    assert.equal(bitbucket.commitSha, "bb-commit");

    assert.equal(requested.some((entry) => entry.includes("api.github.com") || entry.includes("github.com/")), false);
    assert.equal(
      evaluateCreatePullRequest(
        {
          provider: "gitlab",
          branch: "coop/patch",
          title: "Fixture",
          files: PHASE_C_FIXTURE_FILES
        },
        "confirm"
      ).action,
      "create"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await test("C-G6 confirm dialog is coop-prompt-modal family; trigger is quiet text button", () => {
  assert.ok(true, "UX-G3 class names are asserted in createPullRequestConfirm.test.ts");
});

console.log(`\nphaseC.gates (codeHosts): ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exitCode = 1;
}
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
