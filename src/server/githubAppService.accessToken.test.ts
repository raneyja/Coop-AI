import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { GitHubAppService, parseGithubAppInstallationList } from "./githubAppService";

function appService(): GitHubAppService {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return new GitHubAppService({
    appId: "1",
    privateKeyPem: privateKey.export({ type: "pkcs1", format: "pem" }).toString(),
    stateSecret: "test-secret"
  });
}

test("tryCreatePullWriteAccessToken asks GitHub for Contents and Pull requests write", async () => {
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
    const attempt = await appService().tryCreatePullWriteAccessToken(99);
    assert.equal(attempt.ok, true);
    assert.equal(attempt.ok && attempt.token, "ghs_write");
    const body = JSON.parse(posted) as { permissions?: Record<string, string> };
    assert.equal(body.permissions?.contents, "write");
    assert.equal(body.permissions?.pull_requests, "write");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("tryCreatePullWriteAccessToken 422 returns GitHub's refusal instead of throwing", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({ message: "The permissions requested are not granted to this installation." }),
      { status: 422 }
    )) as typeof fetch;
  try {
    const attempt = await appService().tryCreatePullWriteAccessToken(99);
    assert.equal(attempt.ok, false);
    assert.match(
      (!attempt.ok && attempt.githubMessage) || "",
      /not granted to this installation/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a token minted with less than write is reported as not ok", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        token: "ghs_read",
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        permissions: { contents: "read", pull_requests: "read" }
      }),
      { status: 201 }
    )) as typeof fetch;
  try {
    const attempt = await appService().tryCreatePullWriteAccessToken(7);
    assert.equal(attempt.ok, false);
    assert.match((!attempt.ok && attempt.githubMessage) || "", /contents=read/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("unscoped installation token mint still works for indexing paths", async () => {
  const originalFetch = globalThis.fetch;
  let body: string | undefined;
  globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => {
    body = init?.body === undefined ? undefined : String(init.body);
    return new Response(
      JSON.stringify({ token: "ghs_plain", expires_at: new Date(Date.now() + 3_600_000).toISOString() }),
      { status: 201 }
    );
  }) as typeof fetch;
  try {
    const minted = await appService().createInstallationAccessToken(5);
    assert.equal(minted.token, "ghs_plain");
    assert.equal(body, undefined, "no permissions body when none requested");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GitHub lists App installations as a raw array", () => {
  const parsed = parseGithubAppInstallationList([
    { id: 144638755, account: { login: "CoopAI-Corp", type: "Organization" } },
    { id: 111, account: { login: "raneyja", type: "User" } }
  ]);
  assert.deepEqual(parsed, [
    { id: 144638755, accountLogin: "CoopAI-Corp", accountType: "Organization" },
    { id: 111, accountLogin: "raneyja", accountType: "User" }
  ]);
});

test("wrapped { installations } payloads still parse", () => {
  const parsed = parseGithubAppInstallationList({
    installations: [{ id: 1, account: { login: "acme", type: "Organization" } }]
  });
  assert.equal(parsed[0]?.accountLogin, "acme");
});

test("the old parser shape (missing installations key) is not treated as zero installs", () => {
  assert.equal(parseGithubAppInstallationList({ total_count: 2 }).length, 0);
  assert.equal(
    parseGithubAppInstallationList([{ id: 1, account: { login: "raneyja", type: "User" } }]).length,
    1
  );
});
