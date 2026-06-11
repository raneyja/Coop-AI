import assert from "node:assert/strict";

let capturedUrl = "";
const originalFetch = globalThis.fetch;

async function run(): Promise<void> {
  globalThis.fetch = (async (url: string | URL) => {
    capturedUrl = String(url);
    return new Response(JSON.stringify({ issues: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }) as typeof fetch;

  try {
    const { JiraClient } = await import("./jiraClient");
    const client = new JiraClient({
      baseUrl: "https://test.atlassian.net",
      email: "user@example.com",
      apiToken: "token"
    });
    await client.searchIssues("project = COOP ORDER BY updated DESC", 10);
    assert.ok(
      capturedUrl.includes("/rest/api/3/search/jql"),
      `Expected /search/jql endpoint, got ${capturedUrl}`
    );
    console.log("  ✓ searchIssues uses /rest/api/3/search/jql");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

void run().catch((error) => {
  console.error(error);
  process.exit(1);
});
