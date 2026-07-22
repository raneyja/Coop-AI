import assert from "node:assert/strict";
import {
  coerceChipFileSource,
  isRemoteChip,
  shouldKeepRemoteProvenance
} from "./fileChipIdentity";
import { mergeRepoContext } from "./repoContextMerge";
import { normalizeRepoContext } from "./contextScope";

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

  await test("coerceChipFileSource forces absolute disk to external", () => {
    assert.equal(
      coerceChipFileSource("/Users/jon/Downloads/a.md", "remote"),
      "external"
    );
    assert.equal(coerceChipFileSource("src/a.ts", "remote"), "remote");
    assert.equal(coerceChipFileSource("src/a.ts", "workspace"), "workspace");
  });

  await test("isRemoteChip never treats Downloads as remote", () => {
    assert.equal(
      isRemoteChip({ file: "/Users/jon/Downloads/a.md", fileSource: "remote" }),
      false
    );
    assert.equal(isRemoteChip({ file: "src/a.ts", fileSource: "remote" }), true);
  });

  await test("normalizeRepoContext overrides remote stamp on absolute path", () => {
    const normalized = normalizeRepoContext({
      file: "/Users/jonraney/Downloads/cursor_session.md",
      fileSource: "remote",
      owner: "acme",
      repo: "coop"
    });
    assert.equal(normalized.fileSource, "external");
    assert.equal(normalized.scope, "file");
  });

  await test("merge keeps remote provenance when local clone opens same path", () => {
    const merged = mergeRepoContext(
      {
        owner: "acme",
        repo: "coop",
        file: ".cursor/rules/clear-user-requests.mdc",
        fileSource: "remote",
        scope: "file"
      },
      {
        file: ".cursor/rules/clear-user-requests.mdc",
        fileSource: "workspace",
        languageId: "markdown"
      }
    );
    assert.equal(merged.fileSource, "remote");
    assert.equal(merged.file, ".cursor/rules/clear-user-requests.mdc");
  });

  await test("merge forces external when absolute path arrives after remote stamp", () => {
    const merged = mergeRepoContext(
      { owner: "acme", repo: "coop", file: "src/a.ts", fileSource: "remote" },
      {
        file: "/Users/jonraney/Downloads/notes.md",
        fileSource: "remote",
        languageId: "markdown"
      }
    );
    assert.equal(merged.fileSource, "external");
    assert.equal(merged.file, "/Users/jonraney/Downloads/notes.md");
    assert.equal(isRemoteChip(merged), false);
  });

  await test("shouldKeepRemoteProvenance rejects absolute incoming", () => {
    assert.equal(
      shouldKeepRemoteProvenance(
        { file: "src/a.ts", fileSource: "remote" },
        { file: "/Users/jon/Downloads/a.md", fileSource: "workspace" }
      ),
      false
    );
  });

  const total = passed + failed;
  console.log(`\nfileChipIdentity: ${passed}/${total} tests passed`);
  if (failed > 0) {
    process.exit(1);
  }
}

void run();
