import assert from "node:assert/strict";
import { GoogleDocsClient } from "./googleDocsClient";

const originalFetch = globalThis.fetch;

async function run(): Promise<void> {
  let passed = 0;
  let failed = 0;

  globalThis.fetch = (async (url: string | URL) => {
    const href = String(url);
    if (href.includes("/export") && href.includes("mimeType=text%2Fplain")) {
      return new Response("Chose GitHub App over PAT for requireAuth.\n", {
        status: 200,
        headers: { "Content-Type": "text/plain" }
      });
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;

  try {
    const client = new GoogleDocsClient({ accessToken: "test-token" });
    const text = await client.getDocumentPlainText("doc-abc");
    assert.match(text ?? "", /GitHub App over PAT/);
    console.log("  ✓ getDocumentPlainText uses Drive text/plain export");
    passed++;
  } catch (err) {
    console.error("  ✗ getDocumentPlainText uses Drive text/plain export");
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  } finally {
    globalThis.fetch = originalFetch;
  }

  const total = passed + failed;
  console.log(`\ngoogleDocsClient: ${passed}/${total} tests passed`);
  if (failed > 0) {
    process.exit(1);
  }
}

void run();
