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

  await test("snaps paraphrased SEARCH onto highlighted lines using attached file bytes", async () => {
    const fileBody = [
      "class State:",
      "    id = 1",
      "",
      "    def __str__(self):",
      "        return self.name",
      "    x = 2"
    ].join("\n");
    const content = [
      "File: `apps/api/plane/db/models/state.py`",
      "",
      "```patch",
      "<<<<<<< SEARCH",
      "    {",
      '        "name": "In Progress",',
      '        "color": "#F59E0B",',
      "        \"sequence\": 35000,",
      "        \"group\": StateGroup.STARTED.value,",
      "    },",
      "=======",
      "    # Represents the In Progress state",
      "    {",
      '        "name": "In Progress",',
      '        "color": "#F59E0B",',
      "        \"sequence\": 35000,",
      "        \"group\": StateGroup.STARTED.value,",
      "    },",
      ">>>>>>> REPLACE",
      "```"
    ].join("\n");
    const result = await handlePatchComplete(content, {
      messageTimestamp: 813,
      file: "apps/api/plane/db/models/state.py",
      selectedLines: [4, 5],
      fileContents: { "apps/api/plane/db/models/state.py": fileBody },
      publish: () => undefined
    });
    assert.equal(result?.status, "pending");
    const hunk = result?.files[0]?.hunks[0];
    assert.equal(hunk?.matchStatus, "matched");
    const joined = (hunk?.lines ?? []).map((line) => line.text).join("\n");
    assert.ok(joined.includes("def __str__(self):"));
    assert.equal(joined.includes('"name": "In Progress"'), false);
  });

  await test("preview matches when highlight IS the SEARCH block and file bytes use a path alias", async () => {
    const fileBody = [
      "DEFAULT_STATES = [",
      "    {",
      '        "name": "Backlog",',
      "    },",
      "    {",
      '        "name": "In Progress",',
      '        "color": "#F59E0B",',
      "        \"sequence\": 35000,",
      "        \"group\": StateGroup.STARTED.value,",
      "    },",
      "]"
    ].join("\n");
    const search = [
      "    {",
      '        "name": "In Progress",',
      '        "color": "#F59E0B",',
      "        \"sequence\": 35000,",
      "        \"group\": StateGroup.STARTED.value,",
      "    },"
    ].join("\n");
    const content = [
      "File: `apps/api/plane/db/models/state.py`",
      "",
      "```patch",
      "<<<<<<< SEARCH",
      search,
      "=======",
      "    # State representing an ongoing task",
      search,
      ">>>>>>> REPLACE",
      "```"
    ].join("\n");
    const result = await handlePatchComplete(content, {
      messageTimestamp: 820,
      file: "apps/api/plane/db/models/state.py",
      selectedLines: [5, 10],
      fileContents: { "plane/apps/api/plane/db/models/state.py": fileBody },
      publish: () => undefined
    });
    assert.equal(result?.status, "pending");
    const hunk = result?.files[0]?.hunks[0];
    assert.equal(hunk?.matchStatus, "matched");
    const joined = (hunk?.lines ?? []).map((line) => line.text).join("\n");
    assert.ok(joined.includes('"name": "In Progress"'));
    assert.ok(joined.includes("# State representing an ongoing task"));
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

void main();
