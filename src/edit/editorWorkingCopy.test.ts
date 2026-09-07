import "../autocomplete/test/vscodeMockSetup";
import assert from "node:assert/strict";
import * as vscode from "vscode";
import {
  clearWorkingCopySnapshotsForTests,
  collectEditorPrFilesFromDocs,
  compactWorkingCopyDiff,
  snapshotWorkingCopyIfAbsent
} from "./editorWorkingCopy";
import { clearRemotePatchBuffersForTests, rememberRemotePatchBuffer } from "./patchTarget";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  clearWorkingCopySnapshotsForTests();
  clearRemotePatchBuffersForTests();
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

const plane = { owner: "acme", repo: "plane", provider: "github" as const };
const gitlabRepo = { owner: "acme", repo: "plane", provider: "gitlab" as const };

async function main(): Promise<void> {
  await test("GitHub VFS typed change is included", () => {
    snapshotWorkingCopyIfAbsent(
      "src/a.ts",
      "vscode-vfs://github/acme/plane/src/a.ts",
      "original\n",
      plane
    );
    const { files } = collectEditorPrFilesFromDocs({
      useRepo: plane,
      documents: [
        {
          uriString: "vscode-vfs://github/acme/plane/src/a.ts",
          scheme: "vscode-vfs",
          text: "original\ntyped\n"
        }
      ]
    });
    assert.equal(files.length, 1);
    assert.equal(files[0]?.path, "src/a.ts");
    assert.equal(files[0]?.content, "original\ntyped\n");
  });

  await test("unchanged GitHub VFS tab is excluded", () => {
    snapshotWorkingCopyIfAbsent(
      "src/a.ts",
      "vscode-vfs://github/acme/plane/src/a.ts",
      "same\n",
      plane
    );
    const { files } = collectEditorPrFilesFromDocs({
      useRepo: plane,
      documents: [
        {
          uriString: "vscode-vfs://github/acme/plane/src/a.ts",
          scheme: "vscode-vfs",
          text: "same\n"
        }
      ]
    });
    assert.equal(files.length, 0);
  });

  await test("GitLab untitled remembered tab is included", () => {
    const uri = vscode.Uri.parse("untitled:Untitled-1");
    rememberRemotePatchBuffer("apps/api/main.py", uri, "print(1)\n", {
      owner: "acme",
      repo: "plane"
    });
    const { files } = collectEditorPrFilesFromDocs({
      useRepo: gitlabRepo,
      documents: [
        {
          uriString: uri.toString(),
          scheme: "untitled",
          text: "print(1)\nprint(2)\n",
          isDirty: true
        }
      ],
      remembered: [
        {
          path: "apps/api/main.py",
          uriString: uri.toString(),
          content: "print(1)\n",
          owner: "acme",
          repo: "plane"
        }
      ]
    });
    assert.equal(files.length, 1);
    assert.equal(files[0]?.path, "apps/api/main.py");
    assert.match(files[0]?.content ?? "", /print\(2\)/);
  });

  await test("Bitbucket untitled remembered tab is included", () => {
    const uri = vscode.Uri.parse("untitled:Untitled-2");
    const { files } = collectEditorPrFilesFromDocs({
      useRepo: { owner: "acme", repo: "plane", provider: "bitbucket" },
      documents: [
        {
          uriString: uri.toString(),
          scheme: "untitled",
          text: "changed\n",
          isDirty: true
        }
      ],
      remembered: [
        {
          path: "src/bb.ts",
          uriString: uri.toString(),
          content: "orig\n",
          owner: "acme",
          repo: "plane"
        }
      ]
    });
    assert.equal(files.length, 1);
    assert.equal(files[0]?.path, "src/bb.ts");
  });

  await test("foreign file:// workspace is excluded even when dirty", () => {
    const { files } = collectEditorPrFilesFromDocs({
      useRepo: plane,
      localDiskMatchesUseRepo: false,
      documents: [
        {
          uriString: "file:///workspace/src/a.ts",
          scheme: "file",
          fsPath: "/workspace/src/a.ts",
          text: "not plane\n",
          isDirty: true
        }
      ]
    });
    assert.equal(files.length, 0);
  });

  await test("Use-repo file:// dirty buffer is included when the clone matches", () => {
    snapshotWorkingCopyIfAbsent("src/a.ts", "file:///workspace/src/a.ts", "orig\n");
    const { files } = collectEditorPrFilesFromDocs({
      useRepo: plane,
      localDiskMatchesUseRepo: true,
      documents: [
        {
          uriString: "file:///workspace/src/a.ts",
          scheme: "file",
          fsPath: "/workspace/src/a.ts",
          text: "orig\nautocomplete insert\n",
          isDirty: true
        }
      ]
    });
    assert.equal(files.length, 1);
    assert.match(files[0]?.content ?? "", /autocomplete insert/);
  });

  await test("GitHub VFS for a different repo is excluded", () => {
    snapshotWorkingCopyIfAbsent(
      "src/a.ts",
      "vscode-vfs://github/other/repo/src/a.ts",
      "orig\n",
      { owner: "other", repo: "repo" }
    );
    const { files } = collectEditorPrFilesFromDocs({
      useRepo: plane,
      documents: [
        {
          uriString: "vscode-vfs://github/other/repo/src/a.ts",
          scheme: "vscode-vfs",
          text: "changed\n"
        }
      ]
    });
    assert.equal(files.length, 0);
  });

  await test("dirty buffer without snapshot is included; clean needs remote", () => {
    const dirty = collectEditorPrFilesFromDocs({
      useRepo: plane,
      documents: [
        {
          uriString: "vscode-vfs://github/acme/plane/src/a.ts",
          scheme: "vscode-vfs",
          text: "typed\n",
          isDirty: true
        }
      ]
    });
    assert.equal(dirty.files.length, 1);
    const clean = collectEditorPrFilesFromDocs({
      useRepo: plane,
      documents: [
        {
          uriString: "vscode-vfs://github/acme/plane/src/a.ts",
          scheme: "vscode-vfs",
          text: "same-as-remote\n",
          isDirty: false
        }
      ]
    });
    assert.equal(clean.files.length, 0);
    assert.deepEqual(clean.needsRemote, ["src/a.ts"]);
  });

  await test("remote baseline skip when current matches fetched file", () => {
    const { files } = collectEditorPrFilesFromDocs({
      useRepo: plane,
      remoteBaselines: { "src/a.ts": "same-as-remote\n" },
      documents: [
        {
          uriString: "vscode-vfs://github/acme/plane/src/a.ts",
          scheme: "vscode-vfs",
          text: "same-as-remote\n",
          isDirty: false
        }
      ]
    });
    assert.equal(files.length, 0);
  });

  await test("compactWorkingCopyDiff shows editor lines", () => {
    const diff = compactWorkingCopyDiff([
      { path: "src/a.ts", content: "one\ntwo\n", baseline: "one\n" }
    ]);
    assert.match(diff, /src\/a\.ts/);
    assert.match(diff, /\+ two/);
  });
}

void main().then(() => {
  console.log(`\neditorWorkingCopy: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
});
