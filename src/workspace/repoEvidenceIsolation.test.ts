import assert from "node:assert/strict";
import {
  dropForeignActiveFileEvidence,
  filterCodeEvidenceToActiveRepo,
  isForeignActiveFileForUseRepo,
  orgDocsSynthesisGuardrail,
  ORG_DOCS_EVIDENCE_LABEL,
  parseRepoIdCoords,
  sameRepoCoords,
  shouldIsolateActiveFileForQuickAction,
  shouldSkipLocalEditorAttachForRepoScope,
  snippetBelongsToActiveRepo
} from "./repoEvidenceIsolation";

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

test("parseRepoIdCoords handles github:owner/repo", () => {
  assert.deepEqual(parseRepoIdCoords("github:CoopAI-Corp/plane"), {
    owner: "CoopAI-Corp",
    repo: "plane"
  });
});

test("sameRepoCoords matches plane Use-repo against github:…/plane", () => {
  assert.equal(
    sameRepoCoords(
      { owner: "CoopAI-Corp", repo: "plane" },
      { repoId: "github:CoopAI-Corp/plane" }
    ),
    true
  );
  assert.equal(
    sameRepoCoords(
      { owner: "CoopAI-Corp", repo: "plane" },
      { repoId: "github:CoopAI-Corp/documenso" }
    ),
    false
  );
});

test("snippetBelongsToActiveRepo rejects wrong-repo and local Coop bleed", () => {
  const plane = { repoId: "github:CoopAI-Corp/plane" };
  assert.equal(
    snippetBelongsToActiveRepo(
      { repoId: "github:CoopAI-Corp/documenso" },
      plane,
      { allowMissingRepoId: false }
    ),
    false
  );
  assert.equal(
    snippetBelongsToActiveRepo(
      { repoId: "github:raneyja/Coop-AI" },
      plane,
      { allowMissingRepoId: false }
    ),
    false
  );
  assert.equal(
    snippetBelongsToActiveRepo(
      { repoId: "github:CoopAI-Corp/plane" },
      plane,
      { allowMissingRepoId: false }
    ),
    true
  );
});

test("filterCodeEvidenceToActiveRepo drops documenso + Coop paths for plane Use-repo", () => {
  const filtered = filterCodeEvidenceToActiveRepo(
    [
      {
        path: "apps/api/plane/bgtasks/notification.py",
        repoId: "github:CoopAI-Corp/plane",
        content: "plane"
      },
      {
        path: "packages/lib/types/is-document-status.ts",
        repoId: "github:CoopAI-Corp/documenso",
        content: "documenso"
      },
      {
        path: "src/chat/types.ts",
        repoId: "github:raneyja/Coop-AI",
        content: "coop"
      }
    ],
    { owner: "CoopAI-Corp", repo: "plane", repoId: "github:CoopAI-Corp/plane" },
    { allowMissingRepoId: false }
  );
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]?.path, "apps/api/plane/bgtasks/notification.py");
  assert.ok(!filtered.some((file) => file.path.includes("is-document-status")));
  assert.ok(!filtered.some((file) => file.path.includes("src/chat/types.ts")));
});

test("isForeignActiveFileForUseRepo drops Coop workspace file while Use-repo is plane", () => {
  assert.equal(
    isForeignActiveFileForUseRepo(
      {
        owner: "CoopAI-Corp",
        repo: "plane",
        file: "src/chat/types.ts",
        fileSource: "workspace",
        scope: "file"
      },
      { localWorkspaceMatchesUseRepo: false }
    ),
    true
  );
});

test("isForeignActiveFileForUseRepo drops remote tab from documenso while Use-repo is plane", () => {
  assert.equal(
    isForeignActiveFileForUseRepo(
      {
        owner: "CoopAI-Corp",
        repo: "plane",
        file: "packages/lib/types/is-document-status.ts",
        fileSource: "remote",
        scope: "file"
      },
      { fileOwner: "CoopAI-Corp", fileRepo: "documenso" }
    ),
    true
  );
});

test("dropForeignActiveFileEvidence clears chip and restores repo scope", () => {
  const dropped = dropForeignActiveFileEvidence(
    {
      owner: "CoopAI-Corp",
      repo: "plane",
      branch: "preview",
      file: "src/chat/types.ts",
      fileSource: "workspace",
      scope: "file",
      selectedLines: [1, 10]
    },
    { localWorkspaceMatchesUseRepo: false }
  );
  assert.equal(dropped.file, undefined);
  assert.equal(dropped.fileSource, undefined);
  assert.equal(dropped.selectedLines, undefined);
  assert.equal(dropped.scope, "repo");
  assert.equal(dropped.owner, "CoopAI-Corp");
  assert.equal(dropped.repo, "plane");
});

test("dropForeignActiveFileEvidence keeps in-repo remote file", () => {
  const kept = dropForeignActiveFileEvidence(
    {
      owner: "CoopAI-Corp",
      repo: "plane",
      file: "apps/web/package.json",
      fileSource: "remote",
      scope: "file"
    },
    { fileOwner: "CoopAI-Corp", fileRepo: "plane", localWorkspaceMatchesUseRepo: false }
  );
  assert.equal(kept.file, "apps/web/package.json");
  assert.equal(kept.fileSource, "remote");
});

test("shouldSkipLocalEditorAttachForRepoScope honors sticky Use-repo", () => {
  assert.equal(
    shouldSkipLocalEditorAttachForRepoScope({
      owner: "CoopAI-Corp",
      repo: "plane",
      scope: "repo"
    }),
    true
  );
  assert.equal(
    shouldSkipLocalEditorAttachForRepoScope({
      owner: "CoopAI-Corp",
      repo: "plane",
      file: "apps/web/package.json",
      scope: "file"
    }),
    false
  );
});

test("shouldIsolateActiveFileForQuickAction covers Gaps and Understand", () => {
  assert.equal(shouldIsolateActiveFileForQuickAction("knowledge-gaps"), true);
  assert.equal(shouldIsolateActiveFileForQuickAction("understand-repo"), true);
  assert.equal(shouldIsolateActiveFileForQuickAction(undefined), false);
});

test("org docs guardrail names active Use-repo and refuses Coop-AI ADRs as architecture", () => {
  const text = orgDocsSynthesisGuardrail("CoopAI-Corp", "plane");
  assert.ok(text.includes("CoopAI-Corp/plane"));
  assert.ok(text.includes("org-wide"));
  assert.ok(text.includes("Coop-AI ADRs"));
  assert.ok(ORG_DOCS_EVIDENCE_LABEL.toLowerCase().includes("org"));
});

console.log(`\nrepoEvidenceIsolation: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
