import assert from "node:assert/strict";
import { NotionClient } from "./notionClient";

const originalFetch = globalThis.fetch;

async function run(): Promise<void> {
  let passed = 0;
  let failed = 0;

  globalThis.fetch = (async (url: string | URL) => {
    const href = String(url);
    if (href.includes("/blocks/") && href.includes("/children")) {
      return new Response(
        JSON.stringify({
          results: [
            {
              type: "paragraph",
              paragraph: {
                rich_text: [{ plain_text: "Chose GitHub App over PAT for requireAuth." }]
              }
            },
            {
              type: "heading_2",
              heading_2: { rich_text: [{ plain_text: "Decision" }] }
            }
          ],
          has_more: false
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;

  try {
    const client = new NotionClient({ token: "test-token" });
    const text = await client.getPagePlainText("page-abc");
    assert.match(text ?? "", /GitHub App over PAT/);
    assert.match(text ?? "", /Decision/);
    console.log("  ✓ getPagePlainText flattens block plain_text");
    passed++;
  } catch (err) {
    console.error("  ✗ getPagePlainText flattens block plain_text");
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  } finally {
    globalThis.fetch = originalFetch;
  }

  const total = passed + failed;
  console.log(`\nnotionClient: ${passed}/${total} tests passed`);
  if (failed > 0) {
    process.exit(1);
  }
}

void run();
