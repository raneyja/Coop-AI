import assert from "node:assert/strict";
import { buildPrNotesUserMessage, sanitizePrNotes, summarizePrNotes } from "./prNotesSummary";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`  ✓ ${name}`);
      passed += 1;
    })
    .catch((err) => {
      console.error(`  ✗ ${name}`);
      console.error(`    ${err instanceof Error ? err.message : String(err)}`);
      failed += 1;
    });
}

void (async () => {
  await test("sanitizePrNotes keeps a short summary and drops junk", () => {
    assert.equal(sanitizePrNotes("ok"), undefined);
    assert.equal(
      sanitizePrNotes("Adds a comment above isPlanAllowed so reviewers see the plan check."),
      "Adds a comment above isPlanAllowed so reviewers see the plan check."
    );
  });

  await test("buildPrNotesUserMessage includes title and diff", () => {
    const message = buildPrNotesUserMessage({
      title: "Update src/server/authMiddleware.ts",
      diff: "src/server/authMiddleware.ts\n+ // Check if the plan is allowed"
    });
    assert.match(message, /Update src\/server\/authMiddleware\.ts/);
    assert.match(message, /Check if the plan is allowed/);
  });

  await test("summarizePrNotes returns model text and fails open", async () => {
    const notes = await summarizePrNotes({
      title: "Update a.ts",
      diff: "a.ts\n+ hello",
      complete: async () => "Adds a one-line comment in a.ts explaining the allowed-plan check."
    });
    assert.match(notes ?? "", /a\.ts/);

    const empty = await summarizePrNotes({
      title: "Update a.ts",
      diff: "a.ts\n+ hello",
      complete: async () => {
        throw new Error("boom");
      }
    });
    assert.equal(empty, undefined);
  });

  console.log(`\nprNotesSummary: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exitCode = 1;
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
