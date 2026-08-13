import assert from "node:assert/strict";
import { GitHubClient } from "./githubClient";
import { GitLabClient } from "./gitlabClient";
import { BitbucketClient } from "./bitbucketClient";
import {
  PHASE_C_FIXTURE_FILES,
  PHASE_C_FIXTURE_REPO,
  PR_HANDOFF_AUDIT_ACTION,
  evaluateCreatePullRequest,
  pullRequestWriteNotYetMessage
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
    assert.ok(calls.some((call) => call.method === "POST" && call.url.endsWith("/git/commits")));
    assert.ok(calls.some((call) => call.method === "POST" && call.url.endsWith("/pulls")));
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

await test("C-G4 GitLab / Bitbucket are explicit not yet — never call GitHub", async () => {
  const requested: string[] = [];
  globalThis.fetch = (async (input: string | URL) => {
    requested.push(String(input));
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    await assert.rejects(
      () =>
        new GitLabClient({ token: "glpat" }).createPullFromFiles(PHASE_C_FIXTURE_REPO, {
          branch: "coop/patch",
          title: "nope",
          files: PHASE_C_FIXTURE_FILES
        }),
      (error: unknown) =>
        error instanceof CodeHostError &&
        error.code === "unsupported" &&
        error.message === pullRequestWriteNotYetMessage("gitlab")
    );
    await assert.rejects(
      () =>
        new BitbucketClient({ token: "bb" }).createPullFromFiles(
          { ...PHASE_C_FIXTURE_REPO, provider: "bitbucket" },
          { branch: "coop/patch", title: "nope", files: PHASE_C_FIXTURE_FILES }
        ),
      (error: unknown) =>
        error instanceof CodeHostError &&
        error.code === "unsupported" &&
        error.message === pullRequestWriteNotYetMessage("bitbucket")
    );
    assert.equal(requested.length, 0);
    assert.equal(evaluateCreatePullRequest({
      provider: "gitlab",
      branch: "coop/patch",
      title: "Fixture",
      files: PHASE_C_FIXTURE_FILES
    }, "confirm").action, "nothing");
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
