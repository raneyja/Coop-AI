import assert from "node:assert/strict";
import test from "node:test";
import { BitbucketClient } from "./bitbucketClient";

test("listUserRepositories uses /user/workspaces then per-workspace repos", async () => {
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/user/workspaces")) {
      return new Response(
        JSON.stringify({
          values: [{ slug: "acme" }, { workspace: { slug: "other" } }]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("/repositories/acme?")) {
      return new Response(
        JSON.stringify({
          values: [
            {
              name: "app",
              full_name: "acme/app",
              workspace: { slug: "acme" },
              mainbranch: { name: "main" },
              is_private: true,
              links: { html: { href: "https://bitbucket.org/acme/app" } }
            }
          ]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("/repositories/other?")) {
      return new Response(JSON.stringify({ values: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
    if (url.includes("/workspaces?") || (/\/repositories\?role=member/.test(url) && !url.includes("/repositories/"))) {
      return new Response(
        JSON.stringify({
          type: "error",
          error: { message: "CHANGE-2770 - Functionality has been deprecated" }
        }),
        { status: 410, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response("unexpected", { status: 500 });
  }) as typeof fetch;

  try {
    const client = new BitbucketClient({ token: "bb-token" });
    const repos = await client.listUserRepositories(50);
    assert.equal(repos.length, 1);
    assert.equal(repos[0]?.owner, "acme");
    assert.equal(repos[0]?.name, "app");
    assert.ok(calls.some((url) => url.includes("/user/workspaces")));
    assert.ok(calls.some((url) => url.includes("/repositories/acme?")));
    assert.ok(calls.some((url) => url.includes("/repositories/other?")));
    assert.equal(
      calls.some((url) => url.includes("/workspaces?role=member")),
      false,
      "must not call deprecated /workspaces?role=member"
    );
    assert.equal(
      calls.some((url) => /\/repositories\?role=member/.test(url)),
      false,
      "must not call deprecated unscoped /repositories?role=member"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

const planeCoords = {
  provider: "bitbucket" as const,
  owner: "coop-ai",
  repo: "plane",
  branch: "preview"
};

test("getCommitHistory uses branch revision and path query param (not path as URL segment)", async () => {
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    return new Response(
      JSON.stringify({
        values: [
          {
            hash: "abc123def456",
            date: "2024-01-15T12:00:00+00:00",
            message: "Introduce StateGroup",
            author: { user: { display_name: "dev" } },
            links: { html: { href: "https://bitbucket.org/coop-ai/plane/commits/abc123def456" } }
          }
        ]
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as typeof fetch;

  try {
    const client = new BitbucketClient({ token: "bb-token" });
    const commits = await client.getCommitHistory(planeCoords, {
      path: "apps/api/plane/db/models/state.py",
      limit: 5
    });
    assert.equal(commits.length, 1);
    assert.equal(commits[0]?.sha, "abc123def456");
    assert.equal(commits[0]?.message, "Introduce StateGroup");
    assert.equal(calls.length, 1);
    const url = calls[0]!;
    assert.ok(
      url.includes("/repositories/coop-ai/plane/commits/preview?"),
      `expected commits/preview?… got ${url}`
    );
    assert.ok(url.includes("path=apps%2Fapi%2Fplane%2Fdb%2Fmodels%2Fstate.py"), `missing path query: ${url}`);
    assert.equal(
      /\/commits\/apps\//.test(url),
      false,
      "must not treat file path as revision segment"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("getFileHistory uses filehistory endpoint for Bitbucket file path", async () => {
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/filehistory/")) {
      return new Response(
        JSON.stringify({
          values: [
            {
              path: "apps/api/plane/db/models/state.py",
              commit: {
                hash: "newer001",
                date: "2024-06-01T00:00:00+00:00",
                message: "Tweak StateGroup",
                author: { raw: "dev <dev@example.com>" }
              }
            },
            {
              path: "apps/api/plane/db/models/state.py",
              commit: {
                hash: "older001",
                date: "2023-01-01T00:00:00+00:00",
                message: "Add StateGroup",
                author: { user: { display_name: "founder" } }
              }
            }
          ]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response("unexpected", { status: 500 });
  }) as typeof fetch;

  try {
    const client = new BitbucketClient({ token: "bb-token" });
    const history = await client.getFileHistory(
      planeCoords,
      "apps/api/plane/db/models/state.py",
      10
    );
    assert.equal(history.length, 2);
    assert.equal(history[0]?.sha, "newer001");
    assert.equal(history[1]?.sha, "older001");
    assert.equal(history[1]?.message, "Add StateGroup");
    assert.equal(calls.length, 1);
    const url = calls[0]!;
    assert.ok(
      url.includes("/filehistory/preview/apps/api/plane/db/models/state.py"),
      `expected filehistory URL, got ${url}`
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("getFileHistory falls back to commits?path= when filehistory fails", async () => {
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/filehistory/")) {
      return new Response(JSON.stringify({ type: "error", error: { message: "not found" } }), {
        status: 404,
        headers: { "Content-Type": "application/json" }
      });
    }
    if (url.includes("/commits/preview?")) {
      return new Response(
        JSON.stringify({
          values: [
            {
              hash: "fallbacksha",
              date: "2024-02-01T00:00:00+00:00",
              message: "via commits path filter",
              author: { user: { display_name: "dev" } }
            }
          ]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response("unexpected", { status: 500 });
  }) as typeof fetch;

  try {
    const client = new BitbucketClient({ token: "bb-token" });
    const history = await client.getFileHistory(planeCoords, "apps/api/plane/db/models/state.py", 5);
    assert.equal(history.length, 1);
    assert.equal(history[0]?.sha, "fallbacksha");
    assert.ok(calls.some((url) => url.includes("/filehistory/")));
    assert.ok(calls.some((url) => url.includes("/commits/preview?") && url.includes("path=")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("getBlameData maps filehistory commits without lines into blame SHAs", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/filehistory/")) {
      return new Response(
        JSON.stringify({
          values: [
            {
              path: "apps/api/plane/db/models/state.py",
              commit: {
                hash: "blame-sha-1",
                date: "2024-03-01T00:00:00+00:00",
                author: { user: { display_name: "alice" } }
              }
            },
            {
              path: "apps/api/plane/db/models/state.py",
              commit: {
                hash: "blame-sha-2",
                date: "2023-03-01T00:00:00+00:00",
                author: { user: { display_name: "bob" } }
              }
            }
          ]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response("unexpected", { status: 500 });
  }) as typeof fetch;

  try {
    const client = new BitbucketClient({ token: "bb-token" });
    const blame = await client.getBlameData(planeCoords, "apps/api/plane/db/models/state.py");
    assert.equal(blame.branch, "preview");
    assert.equal(blame.lines.length, 2);
    assert.equal(blame.lines[0]?.commitSha, "blame-sha-1");
    assert.equal(blame.lines[1]?.commitSha, "blame-sha-2");
    assert.equal(blame.lines[0]?.author, "alice");
    // Without real line annotations, SHAs must still be present for Trace archaeology.
    assert.ok(blame.lines.every((line) => line.commitSha && line.lineNumber > 0));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
