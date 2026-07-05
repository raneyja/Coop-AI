import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  collectNestedAgentsMdPaths,
  findGitRoot,
  loadProjectInstructions,
  normalizeInstructionPath,
  parseMdcFrontmatter,
  resolveProjectInstructionsGitRoot
} from "./projectInstructionsLoader";

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

function withTempRepo(run: (root: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "coop-project-instructions-"));
  try {
    fs.mkdirSync(path.join(root, ".git"));
    run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function writeFile(root: string, relativePath: string, content: string): void {
  const absolute = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content, "utf8");
}

test("parseMdcFrontmatter detects alwaysApply true", () => {
  const parsed = parseMdcFrontmatter(`---
description: Test rule
alwaysApply: true
---

# Rule body
Follow this.`);
  assert.equal(parsed.alwaysApply, true);
  assert.match(parsed.body, /Follow this/);
});

test("parseMdcFrontmatter ignores alwaysApply false", () => {
  const parsed = parseMdcFrontmatter(`---
alwaysApply: false
---
Body`);
  assert.equal(parsed.alwaysApply, false);
});

test("findGitRoot walks up from nested file directory", () => {
  withTempRepo((root) => {
    writeFile(root, "src/chat/foo.ts", "export {}");
    const gitRoot = findGitRoot(path.join(root, "src/chat/foo.ts"));
    assert.equal(gitRoot, root);
  });
});

test("collectNestedAgentsMdPaths returns outer-to-inner AGENTS.md paths", () => {
  withTempRepo((root) => {
    writeFile(root, "src/AGENTS.md", "src agents");
    writeFile(root, "src/chat/AGENTS.md", "chat agents");
    const paths = collectNestedAgentsMdPaths(root, "src/chat/foo.ts");
    assert.deepEqual(paths, ["src/AGENTS.md", "src/chat/AGENTS.md"]);
  });
});

test("loadProjectInstructions loads root AGENTS.md, nested files, and alwaysApply rules", () => {
  withTempRepo((root) => {
    writeFile(root, "AGENTS.md", "Root agents");
    writeFile(root, "src/AGENTS.md", "Src agents");
    writeFile(
      root,
      ".cursor/rules/style.mdc",
      `---
alwaysApply: true
---
Always use TypeScript.`
    );
    writeFile(
      root,
      ".cursor/rules/manual.mdc",
      `---
alwaysApply: false
---
Manual only`
    );

    const loaded = loadProjectInstructions({
      gitRoot: root,
      activeFile: "src/chat/foo.ts"
    });

    assert.deepEqual(
      loaded.files.map((file) => file.path),
      ["AGENTS.md", "src/AGENTS.md", ".cursor/rules/style.mdc"]
    );
    assert.equal(loaded.files[0]?.kind, "agents-md");
    assert.equal(loaded.files[2]?.kind, "cursor-rule");
    assert.match(loaded.files[2]?.content ?? "", /Always use TypeScript/);
  });
});

test("loadProjectInstructions deduplicates repeated paths", () => {
  withTempRepo((root) => {
    writeFile(root, "AGENTS.md", "Root agents");
    const loaded = loadProjectInstructions({ gitRoot: root });
    assert.equal(loaded.files.length, 1);
    assert.equal(loaded.sourcePaths.length, 1);
  });
});

test("resolveProjectInstructionsGitRoot prefers active file git root", () => {
  withTempRepo((root) => {
    writeFile(root, "src/foo.ts", "export {}");
    const resolved = resolveProjectInstructionsGitRoot({
      activeFile: "src/foo.ts",
      resolveAbsolutePath: () => path.join(root, "src/foo.ts"),
      workspaceRoots: [path.join(root, "other-workspace")]
    });
    assert.equal(resolved, root);
  });
});

test("normalizeInstructionPath strips leading ./", () => {
  assert.equal(normalizeInstructionPath("./src/AGENTS.md"), "src/AGENTS.md");
});

console.log(`\nprojectInstructionsLoader: ${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  process.exit(1);
}
