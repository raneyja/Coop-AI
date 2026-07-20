import assert from "node:assert/strict";

let capturedUrls: string[] = [];
const originalFetch = globalThis.fetch;

async function run(): Promise<void> {
  capturedUrls = [];
  globalThis.fetch = (async (url: string | URL) => {
    const href = String(url);
    capturedUrls.push(href);
    if (href.includes("/wiki/api/v2/spaces")) {
      return new Response(
        JSON.stringify({
          results: [{ id: "111", key: "DOCS", name: "Documentation" }],
          _links: {}
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (href.includes("/wiki/rest/api/space")) {
      return new Response(
        JSON.stringify({
          message: "com.atlassian.confluence.api.service.exceptions.GoneException: This deprecated endpoint has been removed."
        }),
        { status: 410, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response(JSON.stringify({ results: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }) as typeof fetch;

  try {
    const { ConfluenceClient } = await import("./confluenceClient");

    const oauthClient = new ConfluenceClient({
      baseUrl: "https://test.atlassian.net/wiki",
      oauthAccessToken: "oauth-token",
      cloudId: "cloud-123"
    });
    const oauthSpaces = await oauthClient.listSpaces({ limit: 10 });
    assert.equal(oauthSpaces.length, 1);
    assert.equal(oauthSpaces[0]?.key, "DOCS");
    assert.ok(
      capturedUrls.some((url) =>
        url.includes("https://api.atlassian.com/ex/confluence/cloud-123/wiki/api/v2/spaces")
      ),
      `Expected OAuth listSpaces to call v2 /spaces, got: ${capturedUrls.join(", ")}`
    );
    assert.ok(
      !capturedUrls.some((url) => url.includes("/wiki/rest/api/space")),
      "OAuth listSpaces must not call deprecated v1 /space"
    );
    console.log("  ✓ OAuth listSpaces uses Confluence Cloud REST API v2 /spaces");

    capturedUrls = [];
    const basicClient = new ConfluenceClient({
      baseUrl: "https://test.atlassian.net/wiki",
      email: "user@example.com",
      apiToken: "token"
    });
    // Force empty result path so we don't need a full pagination mock beyond first page.
    globalThis.fetch = (async (url: string | URL) => {
      capturedUrls.push(String(url));
      return new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }) as typeof fetch;
    await basicClient.listSpaces({ limit: 10 });
    assert.ok(
      capturedUrls.some((url) => url.includes("/wiki/rest/api/space")),
      `Expected basic-auth listSpaces to call v1 /space, got: ${capturedUrls.join(", ")}`
    );
    console.log("  ✓ Basic-auth listSpaces still uses v1 /space");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

void run().catch((error) => {
  console.error(error);
  process.exit(1);
});
