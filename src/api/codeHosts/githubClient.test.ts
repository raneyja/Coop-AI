import test from "node:test";
import assert from "node:assert/strict";
import { GitHubClient } from "./githubClient";

const originalFetch = globalThis.fetch;

test("GitHubClient.testConnection probes GET /user for OAuth and PAT tokens", async () => {
  const requestedUrls: string[] = [];
  globalThis.fetch = (async (input: string | URL) => {
    requestedUrls.push(String(input));
    return new Response(JSON.stringify({ login: "octocat" }), { status: 200 });
  }) as typeof fetch;

  try {
    const result = await new GitHubClient({ token: "gho_test" }).testConnection();
    assert.equal(result.ok, true);
    assert.ok(requestedUrls.some((url) => url.endsWith("/user")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GitHubClient.testInstallationConnection probes GET /installation/repositories for GitHub App tokens", async () => {
  const requestedUrls: string[] = [];
  globalThis.fetch = (async (input: string | URL) => {
    requestedUrls.push(String(input));
    return new Response(JSON.stringify({ total_count: 1, repositories: [] }), { status: 200 });
  }) as typeof fetch;

  try {
    const result = await new GitHubClient({ token: "ghs_installation" }).testInstallationConnection();
    assert.equal(result.ok, true);
    assert.ok(requestedUrls.some((url) => url.includes("/installation/repositories")));
    assert.ok(!requestedUrls.some((url) => url.endsWith("/user")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
