import assert from "node:assert/strict";
import {
  buildPrNotesUserMessage,
  filePathsFromPrDiff,
  formatPrNotesBody,
  parsePrNotesResponse,
  sanitizePrNotes,
  sanitizePrTitle,
  summarizePrNotes
} from "./prNotesSummary";

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

  await test("sanitizePrTitle keeps a change summary and drops Update filename", () => {
    assert.equal(
      sanitizePrTitle("Add TRIAGE to default work item states."),
      "Add TRIAGE to default work item states"
    );
    assert.equal(
      sanitizePrTitle("Update state.py", {
        fallback: "Update state.py",
        files: ["apps/api/plane/db/models/state.py"]
      }),
      "Update state.py"
    );
    assert.equal(
      sanitizePrTitle("Update 2 files", { fallback: "Update state.py and views.py" }),
      "Update state.py and views.py"
    );
  });

  await test("buildPrNotesUserMessage asks for per-file JSON", () => {
    const message = buildPrNotesUserMessage({
      title: "Update src/server/authMiddleware.ts",
      diff: "src/server/authMiddleware.ts\n+ // Check if the plan is allowed",
      files: ["src/server/authMiddleware.ts"]
    });
    assert.match(message, /Update src\/server\/authMiddleware\.ts/);
    assert.match(message, /Check if the plan is allowed/);
    assert.match(message, /"files"/);
    assert.match(message, /src\/server\/authMiddleware\.ts/);
  });

  await test("filePathsFromPrDiff reads compact section headers", () => {
    assert.deepEqual(
      filePathsFromPrDiff("src/a.ts\n+ one\n\napps/b.py\n- old\n+ new"),
      ["src/a.ts", "apps/b.py"]
    );
  });

  await test("formatPrNotesBody uses a heading per file", () => {
    const body = formatPrNotesBody({
      summary: "Adds triage and hides cancelled items.",
      files: [
        {
          path: "apps/api/plane/db/models/state.py",
          notes: "Adds a TRIAGE group to default states."
        },
        {
          path: "apps/api/plane/views.py",
          notes: "Filters cancelled states out of the list."
        }
      ]
    });
    assert.match(body, /^## Summary/m);
    assert.match(body, /^## state\.py/m);
    assert.match(body, /^## views\.py/m);
    assert.match(body, /`apps\/api\/plane\/db\/models\/state\.py`/);
    assert.match(body, /TRIAGE/);
    assert.match(body, /Filters cancelled/);
    const stateAt = body.indexOf("## state.py");
    const viewsAt = body.indexOf("## views.py");
    assert.ok(stateAt >= 0 && viewsAt > stateAt);
  });

  await test("parsePrNotesResponse formats JSON into per-file sections", () => {
    const parsed = parsePrNotesResponse(
      JSON.stringify({
        title: "Add TRIAGE to default work item states",
        summary: "Adds a triage bucket and updates the list view.",
        files: [
          { path: "apps/api/plane/db/models/state.py", notes: "Adds TRIAGE to DEFAULT_STATES." },
          { path: "apps/api/plane/views.py", notes: "Excludes cancelled states." }
        ]
      }),
      {
        files: ["apps/api/plane/db/models/state.py", "apps/api/plane/views.py"]
      }
    );
    assert.equal(parsed.title, "Add TRIAGE to default work item states");
    assert.match(parsed.notes ?? "", /## Summary/);
    assert.match(parsed.notes ?? "", /## state\.py/);
    assert.match(parsed.notes ?? "", /## views\.py/);
  });

  await test("parsePrNotesResponse wraps a blob when there are two files", () => {
    const parsed = parsePrNotesResponse(
      "Title: Add TRIAGE default state\n\nAdds triage and tweaks the list view.",
      {
        files: ["apps/api/plane/db/models/state.py", "apps/api/plane/views.py"]
      }
    );
    assert.equal(parsed.title, "Add TRIAGE default state");
    assert.match(parsed.notes ?? "", /## Summary/);
    assert.match(parsed.notes ?? "", /## state\.py/);
    assert.match(parsed.notes ?? "", /## views\.py/);
  });

  await test("summarizePrNotes returns model text and fails open", async () => {
    const notes = await summarizePrNotes({
      title: "Update a.ts",
      diff: "a.ts\n+ hello",
      files: ["a.ts"],
      complete: async () => "Adds a one-line comment in a.ts explaining the allowed-plan check."
    });
    assert.match(notes?.notes ?? "", /a\.ts/);

    const json = await summarizePrNotes({
      title: "Update a.ts",
      diff: "a.ts\n+ hello\n\nb.ts\n+ world",
      files: ["a.ts", "b.ts"],
      complete: async () =>
        JSON.stringify({
          title: "Add comments to a.ts and b.ts",
          summary: "Documents the allowed-plan check in two modules.",
          files: [
            { path: "a.ts", notes: "Explains the allowed-plan check." },
            { path: "b.ts", notes: "Mirrors the comment for callers." }
          ]
        })
    });
    assert.equal(json?.title, "Add comments to a.ts and b.ts");
    assert.match(json?.notes ?? "", /## a\.ts/);
    assert.match(json?.notes ?? "", /## b\.ts/);

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
