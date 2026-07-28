import assert from "node:assert/strict";
import { branchForEditorContext } from "./branchForEditorContext";

async function run(): Promise<void> {
  let passed = 0;
  let failed = 0;

  const test = (name: string, fn: () => void) => {
    try {
      fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}`);
      console.error(`    ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
  };

  test("sticky Use-repo branch wins over prefs main", () => {
    assert.equal(
      branchForEditorContext({ branch: "preview" }, { branch: "main" }),
      "preview"
    );
  });

  test("prefs branch fills only when session has none", () => {
    assert.equal(branchForEditorContext({}, { branch: "main" }), "main");
    assert.equal(branchForEditorContext({ branch: "  " }, { branch: "develop" }), "develop");
  });

  test("empty prefs does not invent a branch", () => {
    assert.equal(branchForEditorContext({ branch: "preview" }, {}), "preview");
    assert.equal(branchForEditorContext({}, {}), undefined);
  });

  const total = passed + failed;
  console.log(`\nbranchForEditorContext: ${passed}/${total} tests passed`);
  if (failed > 0) {
    process.exit(1);
  }
}

void run();
