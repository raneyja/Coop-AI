import assert from "node:assert/strict";
import { collectKnowledgeGapTreePaths } from "./knowledgeGapTreePaths";
import type { IndexedRepoWorkspace } from "../workspace/IndexedRepoWorkspace";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    failed += 1;
    console.error(`  ✗ ${name}`);
    console.error(error);
  }
}

const listings: Record<string, Array<{ name: string; type: "dir" | "file" }>> = {
  "": [
    { name: "src", type: "dir" },
    { name: "admin", type: "dir" },
    { name: "README.md", type: "file" },
    { name: "postcss.config.js", type: "file" },
    { name: "node_modules", type: "dir" }
  ],
  src: [
    { name: "chat", type: "dir" },
    { name: "jobs", type: "dir" },
    { name: "extension.ts", type: "file" }
  ],
  "src/chat": [
    { name: "CoopChatSession.ts", type: "file" },
    { name: "README.md", type: "file" }
  ],
  "src/jobs": [{ name: "executors.ts", type: "file" }],
  admin: [{ name: "src", type: "dir" }],
  "admin/src": [{ name: "page.tsx", type: "file" }]
};

const workspace = {
  listDirectory: async (_target: unknown, path = "") => listings[path] ?? []
} as unknown as IndexedRepoWorkspace;

async function main(): Promise<void> {
  await test("bounded tree walk collects high-value Coop paths", async () => {
    const paths = await collectKnowledgeGapTreePaths({
      workspace,
      target: { owner: "raneyja", repo: "Coop-AI", branch: "main" }
    });
    assert.ok(paths.includes("README.md"));
    assert.ok(paths.includes("src/extension.ts"));
    assert.ok(paths.includes("src/chat/CoopChatSession.ts"));
    assert.ok(paths.includes("src/jobs/executors.ts"));
    assert.ok(paths.includes("admin/src/page.tsx"));
    assert.ok(!paths.includes("postcss.config.js"));
    assert.ok(!paths.some((path) => path.includes("node_modules")));
  });

  console.log(`\nknowledgeGapTreePaths: ${passed}/${passed + failed} tests passed`);
  if (failed > 0) {
    process.exit(1);
  }
}

void main();
