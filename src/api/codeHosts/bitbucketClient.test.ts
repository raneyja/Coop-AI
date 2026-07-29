import assert from "node:assert/strict";
import test from "node:test";
import { BitbucketClient } from "./bitbucketClient";

test("listUserRepositories uses workspace-scoped endpoints after CHANGE-2770", async () => {
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/workspaces?")) {
      return new Response(
        JSON.stringify({
          values: [{ slug: "acme" }, { slug: "other" }]
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
    if (url.includes("/repositories?") && !url.includes("/repositories/")) {
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
    assert.ok(calls.some((url) => url.includes("/workspaces?role=member")));
    assert.ok(calls.some((url) => url.includes("/repositories/acme?")));
    assert.equal(
      calls.some((url) => /\/repositories\?role=member/.test(url)),
      false,
      "must not call deprecated unscoped /repositories?role=member"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
