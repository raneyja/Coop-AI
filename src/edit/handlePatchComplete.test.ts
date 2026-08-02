import "../autocomplete/test/vscodeMockSetup";
import assert from "node:assert/strict";
import { handlePatchComplete } from "./handlePatchComplete";
import { listPatchCards, resetPatchSessionForTests } from "./patchSession";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  resetPatchSessionForTests();
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

const SAMPLE_PATCH = [
  "File: `src/foo.ts`",
  "",
  "```patch",
  "<<<<<<< SEARCH",
  "const x = 1;",
  "=======",
  "const x = 2;",
  ">>>>>>> REPLACE",
  "```"
].join("\n");

async function main(): Promise<void> {
  await test("ignoreParseFailure leaves session untouched when no patches", async () => {
    const published: unknown[] = [];
    const result = await handlePatchComplete("**Answer**\nJust advice, no edits.", {
      messageTimestamp: 42,
      ignoreParseFailure: true,
      publish: (state) => {
        published.push(state);
      }
    });
    assert.equal(result, undefined);
    assert.equal(published.length, 0);
    assert.equal(listPatchCards().length, 0);
  });

  await test("ignoreParseFailure still elevates valid ask-mode patches", async () => {
    const content = ["**Answer**", "Apply this mapping change.", "", SAMPLE_PATCH].join("\n");
    const published: Array<{ cards: unknown[] }> = [];
    const result = await handlePatchComplete(content, {
      messageTimestamp: 99,
      ignoreParseFailure: true,
      publish: (state) => {
        published.push(state);
      }
    });
    assert.ok(result);
    assert.equal(result?.status, "pending");
    assert.equal(result?.messageTimestamp, 99);
    assert.equal(listPatchCards().length, 1);
    assert.equal(published.length, 1);
  });

  await test("edit-mode parse failure still publishes failed suppression path", async () => {
    const published: Array<{ suppressedMessageTimestamps?: number[] }> = [];
    const result = await handlePatchComplete("no patches here", {
      messageTimestamp: 7,
      publish: (state) => {
        published.push(state);
      }
    });
    assert.ok(result);
    assert.equal(result?.status, "failed");
    assert.equal(published.length, 1);
    assert.deepEqual(published[0]?.suppressedMessageTimestamps, [7]);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

void main();
