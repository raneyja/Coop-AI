import "../autocomplete/test/vscodeMockSetup";
import assert from "node:assert/strict";
import { buildPatchCardState } from "./patchDiffPreview";
import type { ParsedPatchSet } from "./patchParser";

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

const samplePatch: ParsedPatchSet = {
  files: [
    {
      relativePath: "src/example.ts",
      hunks: [
        {
          search: "private bindSession(session: CoopChatSession): void {",
          replace: "/** Re-attaches session. */\nprivate bindSession(session: CoopChatSession): void {"
        }
      ]
    }
  ]
};

test("buildPatchCardState returns pending metadata", () => {
  const state = buildPatchCardState(samplePatch, {
    status: "pending",
    messageTimestamp: 123,
    fileContents: {
      "src/example.ts": "private bindSession(session: CoopChatSession): void {\n}\n"
    }
  });
  assert.equal(state.status, "pending");
  assert.equal(state.fileCount, 1);
  assert.equal(state.hunkCount, 1);
  assert.equal(state.messageTimestamp, 123);
  assert.equal(state.files[0]?.relativePath, "src/example.ts");
});

test("buildPatchCardState includes add/remove diff lines", () => {
  const state = buildPatchCardState(samplePatch, {
    status: "pending",
    fileContents: {
      "src/example.ts": "private bindSession(session: CoopChatSession): void {\n  // body\n}\n"
    }
  });
  const hunk = state.files[0]?.hunks[0];
  assert.ok(hunk);
  assert.equal(hunk.matchStatus, "matched");
  assert.ok(hunk.lines.some((line) => line.kind === "remove"));
  assert.ok(hunk.lines.some((line) => line.kind === "add"));
});

test("buildPatchCardState lists all locations when SEARCH is ambiguous", () => {
  const state = buildPatchCardState(
    {
      files: [
        {
          relativePath: "src/mapper.py",
          hunks: [
            {
              search: "    }",
              replace: '    "blocked_by": "blocking",\n    }'
            }
          ]
        }
      ]
    },
    {
      status: "pending",
      fileContents: {
        "src/mapper.py": [
          "def get_inverse_relation(relation_type):",
          "    relation_mapping = {",
          '        "blocking": "blocked_by",',
          "    }",
          "",
          "def get_actual_relation(relation_type):",
          "    actual_relation = {",
          '        "blocking": "blocking",',
          "    }",
          ""
        ].join("\n")
      }
    }
  );
  const hunk = state.files[0]?.hunks[0];
  assert.ok(hunk);
  assert.equal(hunk.matchStatus, "ambiguous");
  assert.equal(hunk.matchLocations?.length, 2);
  assert.equal(hunk.matchLocations?.[0]?.id, "loc-0");
  assert.equal(hunk.matchLocations?.[1]?.id, "loc-1");
  assert.equal(hunk.matchLocations?.[0]?.selected, false);
  assert.ok((hunk.matchLocations?.[0]?.startLine ?? 0) < (hunk.matchLocations?.[1]?.startLine ?? 0));
});

test("buildPatchCardState preserves prior location selection", () => {
  const fileContents = {
    "src/mapper.py": "foo\nbar\nfoo\n"
  };
  const patches = {
    files: [
      {
        relativePath: "src/mapper.py",
        hunks: [{ search: "foo", replace: "baz" }]
      }
    ]
  };
  const first = buildPatchCardState(patches, { status: "pending", fileContents });
  const selected = {
    ...first,
    files: first.files.map((file) => ({
      ...file,
      hunks: file.hunks.map((hunk) => ({
        ...hunk,
        matchLocations: hunk.matchLocations?.map((loc) =>
          loc.id === "loc-1" ? { ...loc, selected: true } : loc
        )
      }))
    }))
  };
  const rebuilt = buildPatchCardState(patches, {
    status: "pending",
    fileContents,
    previousFiles: selected.files
  });
  assert.equal(rebuilt.files[0]?.hunks[0]?.matchLocations?.[1]?.selected, true);
  assert.equal(rebuilt.files[0]?.hunks[0]?.matchLocations?.[0]?.selected, false);
});

test("pairs equal ambiguous hunks to unique lines (no duplicate options)", () => {
  const fileContents = {
    "src/mapper.py": [
      "def get_inverse_relation(relation_type):",
      "    relation_mapping = {",
      '        "blocking": "blocked_by",',
      "    }",
      "",
      "def get_actual_relation(relation_type):",
      "    actual_relation = {",
      '        "blocking": "blocking",',
      "    }",
      ""
    ].join("\n")
  };
  const state = buildPatchCardState(
    {
      files: [
        {
          relativePath: "src/mapper.py",
          hunks: [
            {
              search: "    }",
              replace: '    "caused_by": "causes",\n    }'
            },
            {
              search: "    }",
              replace: '    "caused_by": "caused_by",\n    }'
            }
          ]
        }
      ]
    },
    { status: "pending", fileContents }
  );

  assert.equal(state.hunkCount, 2);
  assert.equal(state.files[0]?.sharedMatchGroups, undefined);
  assert.equal(state.files[0]?.hunks[0]?.matchStatus, "matched");
  assert.equal(state.files[0]?.hunks[1]?.matchStatus, "matched");
  assert.deepEqual(state.files[0]?.hunks[0]?.resolvedMatchIndices, [0]);
  assert.deepEqual(state.files[0]?.hunks[1]?.resolvedMatchIndices, [1]);
  assert.equal(state.files[0]?.hunks[0]?.matchLocations, undefined);
  assert.equal(state.files[0]?.hunks[1]?.matchLocations, undefined);
  assert.ok(state.files[0]?.hunks[0]?.lines.some((line) => line.text.includes("causes")));
  assert.ok(state.files[0]?.hunks[1]?.lines.some((line) => line.text.includes('"caused_by"')));
});

test("shared group lists each line once when hunk/match counts differ", () => {
  const fileContents = {
    "src/mapper.py": "foo\nbar\nfoo\nbaz\nfoo\n"
  };
  const state = buildPatchCardState(
    {
      files: [
        {
          relativePath: "src/mapper.py",
          hunks: [
            { search: "foo", replace: "A" },
            { search: "foo", replace: "B" }
          ]
        }
      ]
    },
    { status: "pending", fileContents }
  );

  assert.equal(state.files[0]?.sharedMatchGroups?.length, 1);
  const group = state.files[0]?.sharedMatchGroups?.[0];
  assert.equal(group?.locations.length, 3);
  assert.equal(group?.locations[0]?.proposals.length, 2);
  assert.equal(state.files[0]?.hunks[0]?.matchLocations, undefined);
  assert.equal(state.files[0]?.hunks[1]?.matchLocations, undefined);
});

test("pairs ambiguous hunks that hit the same spans even when SEARCH text differs", () => {
  const fileContents = {
    "src/mapper.py": "  foo\n  bar\n  foo\n"
  };
  const state = buildPatchCardState(
    {
      files: [
        {
          relativePath: "src/mapper.py",
          hunks: [
            { search: "foo", replace: "A" },
            { search: "  foo", replace: "B" }
          ]
        }
      ]
    },
    { status: "pending", fileContents }
  );

  assert.equal(state.files[0]?.sharedMatchGroups, undefined);
  assert.equal(state.files[0]?.hunks[0]?.matchStatus, "matched");
  assert.equal(state.files[0]?.hunks[1]?.matchStatus, "matched");
  assert.deepEqual(state.files[0]?.hunks[0]?.resolvedMatchIndices, [0]);
  assert.deepEqual(state.files[0]?.hunks[1]?.resolvedMatchIndices, [1]);
});

test("buildPatchCardState matches SEARCH using an aliased fileContents key", () => {
  const body = [
    "    {",
    '        "name": "In Progress",',
    '        "color": "#F59E0B",',
    "        \"sequence\": 35000,",
    "        \"group\": StateGroup.STARTED.value,",
    "    },"
  ].join("\n");
  const state = buildPatchCardState(
    {
      files: [
        {
          relativePath: "apps/api/plane/db/models/state.py",
          hunks: [
            {
              search: body,
              replace: `    # ongoing\n${body}`
            }
          ]
        }
      ]
    },
    {
      status: "pending",
      fileContents: { "plane/apps/api/plane/db/models/state.py": `${body}\n` }
    }
  );
  assert.equal(state.files[0]?.hunks[0]?.matchStatus, "matched");
});

console.log(`\npatchDiffPreview: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
