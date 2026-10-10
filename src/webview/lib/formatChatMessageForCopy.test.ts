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

test("formatChatMessageForCopy keeps Sources citation labels", () => {
  const copy = formatChatMessageForCopy(
    [
      "**Sources**",
      "- [Sources: Repository inventory] — file counts.",
      "- [Sources: Anchor files] — package.json and README."
    ].join("\n")
  );

  assert.match(copy, /\[Sources: Repository inventory\]/);
  assert.match(copy, /\[Sources: Anchor files\]/);
  assert.ok(!/^-\s+—/m.test(copy));
});

test("copy of a validated source answer preserves exact code and anonymous-example provenance", () => {
  const code = "if ready:\r\n\r\n\r\n    persist()\r";
  const source = "~~~~8:11:src/action.py\n" + code + "\n~~~~";
  const copied = formatChatMessageForCopy("**Observed behavior**\n\n" + source + "\n\nSee `src/action.py`.\n\n```python\npersist('example')\n```",
    { sourceCitationMode: "explicit" });
  assert.ok(copied.includes(code), "source blank lines, indentation and CRLF must survive whole-message Copy");
  assert.ok(copied.includes("~~~~\n" + code + "\n~~~~"));
  assert.ok(copied.includes("```python\npersist('example')\n```"));
});

test("copy preserves literal inner fences from a validated source quote", () => {
  const code = "const example = `\n```\nbody\n```\n`;";
  const copied = formatChatMessageForCopy("````1:5:src/sample.ts\n" + code + "\n````", { sourceCitationMode: "explicit" });
  assert.ok(copied.includes("````\n" + code + "\n````"));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
