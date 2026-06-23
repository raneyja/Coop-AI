import assert from "node:assert/strict";
import { quickActionModelPrompt } from "../prompts/quickActionPrompts";
import { resolveChatUseCase } from "../prompts/systemPrompts";
import { wantsSlackContext } from "../context/slackContext";

const ctx = {
  file: "fastify.js",
  owner: "coop-demo-lab",
  repo: "fastify",
  branch: "main"
};

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

test("find-owner model prompt must not trigger slack integration routing", () => {
  const model = quickActionModelPrompt("find-owner", ctx);
  assert.equal(wantsSlackContext(model), true, "documents why grid button used to mis-route");
  assert.equal(resolveChatUseCase("find-owner", "slack"), "integration");
  assert.equal(resolveChatUseCase("find-owner", undefined), "ownership");
});

test("quick actions without integration provider use ownership use case", () => {
  assert.equal(resolveChatUseCase("find-owner"), "ownership");
});

console.log(`\nquickActionIntegrationRouting: ${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  process.exit(1);
}
