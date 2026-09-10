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

    assert.deepEqual(JiraClient.extractIssueKeys("covering COOP-401 (Jira COOP-242)"), [
      "COOP-401",
      "COOP-242"
    ]);
    assert.deepEqual(JiraClient.extractIssueKeys("see coop-242 in the summary"), ["COOP-242"]);
    console.log("  ✓ extractIssueKeys finds mixed-case keys");

    assert.deepEqual(JiraClient.extractIssueKeys("charset UTF-8 and ISO-8859"), []);
    assert.deepEqual(JiraClient.extractIssueKeys("see RFC-9110 and SHA-256"), []);
    assert.deepEqual(JiraClient.extractIssueKeys("CVE-2024-1234"), []);
    assert.deepEqual(JiraClient.extractIssueKeys("COOP-1 and UTF-8"), ["COOP-1"]);
    console.log("  ✓ extractIssueKeys ignores spec/encoding tokens");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

void run().catch((error) => {
  console.error(error);
  process.exit(1);
});
