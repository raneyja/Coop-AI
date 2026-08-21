import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { CodeHostError } from "../api/codeHosts/types";
import { GITHUB_WRITE_PERMISSION_MESSAGE } from "../api/codeHosts/pullRequestWrite";
import { GitHubAppService } from "./githubAppService";

function appService(): GitHubAppService {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return new GitHubAppService({
    appId: "1",
    privateKeyPem: privateKey.export({ type: "pkcs1", format: "pem" }).toString(),
    stateSecret: "test-secret"
  });
}

test("createPullWriteAccessToken asks GitHub for Contents and Pull requests write", async () => {
  const originalFetch = globalThis.fetch;
  let posted = "";
  globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => {
    posted = String(init?.body ?? "");
    return new Response(
      JSON.stringify({
        token: "ghs_write",
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        permissions: { contents: "write", pull_requests: "write" }
      }),
      { status: 201 }
    );
  }) as typeof fetch;
  try {
    const minted = await appService().createPullWriteAccessToken(99);
    assert.equal(minted.token, "ghs_write");
    const body = JSON.parse(posted) as { permissions?: Record<string, string> };
    assert.equal(body.permissions?.contents, "write");
    assert.equal(body.permissions?.pull_requests, "write");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("createPullWriteAccessToken 422 is the Accept-the-update error", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({ message: "The permissions requested are not granted to this installation." }),
      { status: 422 }
    )) as typeof fetch;
  try {
    await assert.rejects(
      () => appService().createPullWriteAccessToken(99),
      (error: unknown) =>
        error instanceof CodeHostError && error.message === GITHUB_WRITE_PERMISSION_MESSAGE
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
