import assert from "node:assert/strict";
import { discoverCatalogRepoIds } from "./catalogSyncService";

async function testDiscoverGitLabRepoIdsShape() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("/projects?")) {
      return new Response(
        JSON.stringify([
          {
            path: "api",
            path_with_namespace: "acme/backend/api",
            default_branch: "main",
            visibility: "private",
            web_url: "https://gitlab.com/acme/backend/api"
          }
        ]),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const repoIds = await discoverCatalogRepoIds("gitlab", "test-token", {
      gitlabApiBase: "https://gitlab.com/api/v4"
    });
    assert.deepEqual(repoIds, ["gitlab:acme/backend/api"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function run() {
  await testDiscoverGitLabRepoIdsShape();
  console.log("catalogSyncService: 1/1 tests passed");
}

void run();
