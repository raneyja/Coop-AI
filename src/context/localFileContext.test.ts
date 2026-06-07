import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  hasLocalDiskContext,
  isLocalDiskFileSource,
  rankLocalFilePaths,
  readLocalWorkspaceFiles,
  readWorkspaceFileFromAbsolutePath,
  sliceFileContent
} from "./localFileContext";
import { applyLocalFallbackToResult, contextResultHasLocalFiles } from "./localContextMerge";

async function run(): Promise<void> {
  let passed = 0;
  let failed = 0;

  const test = async (name: string, fn: () => void | Promise<void>) => {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}`);
      console.error(`    ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
  };

  await test("isLocalDiskFileSource accepts workspace and git only", () => {
    assert.equal(isLocalDiskFileSource("workspace"), true);
    assert.equal(isLocalDiskFileSource("git"), true);
    assert.equal(isLocalDiskFileSource("remote"), false);
    assert.equal(isLocalDiskFileSource(undefined), false);
  });

  await test("hasLocalDiskContext requires file path and local source", () => {
    assert.equal(hasLocalDiskContext({ file: "src/a.ts", fileSource: "workspace" }), true);
    assert.equal(hasLocalDiskContext({ file: "src/a.ts", fileSource: "git" }), true);
    assert.equal(hasLocalDiskContext({ file: "src/a.ts" }), true);
    assert.equal(hasLocalDiskContext({ file: "src/a.ts", fileSource: "remote" }), false);
    assert.equal(hasLocalDiskContext({ file: "src/a.ts", fileSource: "external" }), false);
    assert.equal(hasLocalDiskContext({ fileSource: "workspace" }), false);
  });

  await test("rankLocalFilePaths prioritizes active file then open editors", () => {
    const ranked = rankLocalFilePaths({
      activeFile: "src/active.ts",
      openEditors: ["src/other.ts", "src/active.ts"],
      maxFiles: 2
    });
    assert.deepEqual(ranked, ["src/active.ts", "src/other.ts"]);
  });

  await test("sliceFileContent includes padding around selected lines", () => {
    const content = ["line1", "line2", "line3", "line4", "line5", "line6", "line7"].join("\n");
    const sliced = sliceFileContent(content, { start: 4, end: 4 });
    assert.equal(sliced.lineRange?.[0], 1);
    assert.equal(sliced.lineRange?.[1], 7);
    assert.ok(sliced.content.includes("line4"));
  });

  await test("readLocalWorkspaceFiles reads active file from disk", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "coop-local-"));
    const filePath = path.join(root, "src", "panel.ts");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "export function bindSession() {}", "utf8");

    try {
      const payload = await readLocalWorkspaceFiles({
        file: "src/panel.ts",
        fileSource: "workspace",
        resolveAbsolutePath: (relativePath) => path.join(root, relativePath)
      });

      assert.ok(payload);
      assert.equal(payload.source, "local-workspace");
      assert.equal(payload.files[0]?.path, "src/panel.ts");
      assert.ok(payload.files[0]?.content.includes("bindSession"));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test("readWorkspaceFileFromAbsolutePath reads by tab fsPath", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "coop-tab-"));
    const filePath = path.join(root, "src", "server", "githubAppApi.ts");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "if (!deps.githubApp || !deps.githubAppConfig) {", "utf8");

    try {
      const payload = readWorkspaceFileFromAbsolutePath(filePath, "src/server/githubAppApi.ts");
      assert.ok(payload);
      assert.ok(payload.files[0]?.content.includes("deps.githubApp"));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test("applyLocalFallbackToResult clears hard errors when local files exist", () => {
    const merged = applyLocalFallbackToResult(
      {
        requestId: "req-1",
        type: "dependencies",
        error: "GitHub is offline and no cached blast radius data is available.",
        fetchedAt: new Date()
      },
      {
        source: "local-workspace",
        activeFile: "src/panel.ts",
        fallbackLevel: "partial",
        files: [{ path: "src/panel.ts", content: "export function bindSession() {}" }]
      }
    );

    assert.equal(merged.error, undefined);
    assert.equal(contextResultHasLocalFiles(merged), true);
    assert.ok(merged.message?.includes("local workspace"));
  });

  const total = passed + failed;
  console.log(`\nlocalFileContext: ${passed}/${total} tests passed`);
  if (failed > 0) {
    process.exit(1);
  }
}

void run();
