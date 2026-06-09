import assert from "node:assert/strict";
import { formatChatMessageForCopy } from "./formatChatMessageForCopy";

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

test("formatChatMessageForCopy preserves markdown links and file paths", () => {
  const copy = formatChatMessageForCopy(
    [
      "**Documentation gaps**",
      "",
      "- [Coop AI — Architecture Overview](https://example/wiki/arch) — Repo architecture overview.",
      "- **Open question:** Review `src/server/githubAppApi.ts` for handlers.",
      "",
      "**Recommended next steps**",
      "",
      "1. Open `docs/webhook-backend.md`",
      "2. Read [Integrations](https://example/wiki/integrations)"
    ].join("\n")
  );

  assert.ok(copy.includes("**Documentation gaps**"));
  assert.ok(copy.includes("[Coop AI — Architecture Overview](https://example/wiki/arch)"));
  assert.ok(copy.includes("**Open question:**"));
  assert.ok(copy.includes("`src/server/githubAppApi.ts`"));
  assert.ok(copy.includes("1. Open `docs/webhook-backend.md`"));
  assert.ok(copy.includes("[Integrations](https://example/wiki/integrations)"));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
