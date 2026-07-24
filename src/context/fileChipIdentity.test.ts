import assert from "node:assert/strict";
import {
  coerceChipFileSource,
  isRemoteChip,
  isRemoteProvenanceContext,
  preserveRemoteChipSource,
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

  await test("isRemoteProvenanceContext treats pin or remote stamp as remote-only", () => {
    assert.equal(
      isRemoteProvenanceContext({ file: "src/a.ts", fileSource: "remote" }),
      true
    );
    assert.equal(
      isRemoteProvenanceContext({ file: "src/a.ts", fileSource: "workspace" }, "src/a.ts"),
      true
    );
    assert.equal(
      isRemoteProvenanceContext({ file: "src/a.ts", fileSource: "workspace" }),
      false
    );
    assert.equal(
      isRemoteProvenanceContext(
        { file: "/Users/jon/Downloads/a.md", fileSource: "remote" },
        "/Users/jon/Downloads/a.md"
      ),
      false
    );
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

  await test("preserveRemoteChipSource blocks Trace Decision local-attach demotion", () => {
    assert.equal(preserveRemoteChipSource("remote", "workspace"), "remote");
    assert.equal(preserveRemoteChipSource("remote", "git"), "remote");
    assert.equal(preserveRemoteChipSource("remote", undefined), "remote");
    assert.equal(preserveRemoteChipSource("remote", "external"), "external");
    assert.equal(preserveRemoteChipSource("workspace", "workspace"), "workspace");
    assert.equal(preserveRemoteChipSource(undefined, "workspace"), "workspace");
    assert.equal(
      isRemoteChip({
        file: "src/CoopSettingsPanel.ts",
        fileSource: preserveRemoteChipSource("remote", "workspace")
      }),
      true
    );
  });

  const total = passed + failed;
  console.log(`\nfileChipIdentity: ${passed}/${total} tests passed`);
  if (failed > 0) {
    process.exit(1);
  }
}

void run();
