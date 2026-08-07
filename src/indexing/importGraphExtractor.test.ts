import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractImportEdges, extractImportEdgesFromSource } from "./importGraphExtractor";

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

test("responseDeadline: relative import resolves to src/config/responseDeadline.ts", () => {
  const fileSet = new Set(["src/config/responseDeadline.ts", "src/chat/CoopChatSession.ts"]);
  const source = `import {
  abortablePromise,
  clearResponseDeadlineForSynthesis,
  isSoftGatherLatencyMessage,
  remainingContextGatherBudgetMs
} from "../config/responseDeadline";`;
  const edges = extractImportEdgesFromSource("src/chat/CoopChatSession.ts", source, { fileSet });
  assert.equal(edges.length, 1);
  assert.equal(edges[0].from, "src/chat/CoopChatSession.ts");
  assert.equal(edges[0].to, "src/config/responseDeadline.ts");
  assert.equal(edges[0].kind, "import");
});

test("extension: ./foo resolves to foo.tsx", () => {
  const fileSet = new Set(["src/foo.tsx", "src/bar.ts"]);
  const edges = extractImportEdgesFromSource("src/bar.ts", `import x from "./foo";`, { fileSet });
  assert.equal(edges.length, 1);
  assert.equal(edges[0].to, "src/foo.tsx");
});

test("index folder: ../utils resolves to utils/index.ts", () => {
  const fileSet = new Set(["src/utils/index.ts", "src/components/page.tsx"]);
  const edges = extractImportEdgesFromSource(
    "src/components/page.tsx",
    `import { helper } from "../utils";`,
    { fileSet }
  );
  assert.equal(edges.length, 1);
  assert.equal(edges[0].to, "src/utils/index.ts");
});

test("no invent: lodash and ./missing produce zero edges", () => {
  const fileSet = new Set(["src/bar.ts"]);
  const lodashEdges = extractImportEdgesFromSource("src/bar.ts", `import _ from "lodash";`, { fileSet });
  assert.equal(lodashEdges.length, 0);
  const missingEdges = extractImportEdgesFromSource("src/bar.ts", `import x from "./missing";`, { fileSet });
  assert.equal(missingEdges.length, 0);
});

test("python: from .b import x resolves to pkg/b.py", () => {
  const fileSet = new Set(["pkg/a.py", "pkg/b.py"]);
  const edges = extractImportEdgesFromSource("pkg/a.py", "from .b import x\n", { fileSet });
  assert.equal(edges.length, 1);
  assert.equal(edges[0].from, "pkg/a.py");
  assert.equal(edges[0].to, "pkg/b.py");
  assert.equal(edges[0].kind, "import");
});

test("extractImportEdges walks a temp clone once and skips node_modules", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "coop-import-graph-"));
  try {
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.mkdirSync(path.join(root, "node_modules", "lodash"), { recursive: true });
    fs.writeFileSync(path.join(root, "src", "main.ts"), `import { x } from "./util";\nimport _ from "lodash";\n`);
    fs.writeFileSync(path.join(root, "src", "util.ts"), "export const x = 1;\n");
    fs.writeFileSync(path.join(root, "node_modules", "lodash", "index.js"), "module.exports = {};\n");

    const edges = extractImportEdges(root);
    assert.equal(edges.length, 1);
    assert.equal(edges[0].from, "src/main.ts");
    assert.equal(edges[0].to, "src/util.ts");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

console.log(`\nimportGraphExtractor: ${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  process.exit(1);
}
