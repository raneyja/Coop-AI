import assert from "node:assert/strict";
import {
  assembleDualRepoCompareEvidence,
  dualCompareEvidenceRepoIds,
  dualRepoCompareUserMessage,
  filterSnippetsForCompareSide,
  isRejectedCompareEvidencePath,
  parseDualRepoCompareArgs,
  resolveCompareRepoToken,
  splitCompareArgTokens
} from "./dualRepoCompare";
import { WORKSPACE_LOCAL_REPO_ID } from "../chat/mentionSearchMerge";

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

const CATALOG = ["github:CoopAI-Corp/plane", "github:CoopAI-Corp/documenso", "github:acme/other"];

test("splitCompareArgTokens extracts two repos and topic", () => {
  const split = splitCompareArgTokens("plane documenso auth and tenancy");
  assert.equal(split.leftToken, "plane");
  assert.equal(split.rightToken, "documenso");
  assert.equal(split.topic, "auth and tenancy");
});

test("resolveCompareRepoToken resolves short names from catalog", () => {
  const plane = resolveCompareRepoToken("plane", {
    catalogRepoIds: CATALOG,
    defaultOwner: "CoopAI-Corp",
    defaultProvider: "github"
  });
  assert.equal(plane?.repoId, "github:CoopAI-Corp/plane");
  const doc = resolveCompareRepoToken("documenso", {
    catalogRepoIds: CATALOG,
    defaultOwner: "CoopAI-Corp"
  });
  assert.equal(doc?.repoId, "github:CoopAI-Corp/documenso");
});

test("parseDualRepoCompareArgs builds plan for smoke #9", () => {
  const parsed = parseDualRepoCompareArgs("plane documenso auth tenancy", {
    catalogRepoIds: CATALOG,
    defaultOwner: "CoopAI-Corp",
    defaultProvider: "github"
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) {
    return;
  }
  assert.equal(parsed.plan.left.repoId, "github:CoopAI-Corp/plane");
  assert.equal(parsed.plan.right.repoId, "github:CoopAI-Corp/documenso");
  assert.equal(parsed.plan.topic, "auth tenancy");
  assert.match(dualRepoCompareUserMessage(parsed.plan), /plane.*documenso/i);
});

test("parseDualRepoCompareArgs rejects same repo twice", () => {
  const parsed = parseDualRepoCompareArgs("plane plane auth", {
    catalogRepoIds: CATALOG,
    defaultOwner: "CoopAI-Corp"
  });
  assert.equal(parsed.ok, false);
});

test("parseDualRepoCompareArgs requires two repos", () => {
  const parsed = parseDualRepoCompareArgs("plane", { catalogRepoIds: CATALOG });
  assert.equal(parsed.ok, false);
});

test("assembleDualRepoCompareEvidence includes both repoIds", () => {
  const parsed = parseDualRepoCompareArgs("plane documenso auth", {
    catalogRepoIds: CATALOG,
    defaultOwner: "CoopAI-Corp"
  });
  assert.ok(parsed.ok);
  if (!parsed.ok) {
    return;
  }
  const evidence = assembleDualRepoCompareEvidence({
    plan: parsed.plan,
    leftFiles: [
      {
        path: "apps/api/plane/authentication.py",
        repoId: "github:CoopAI-Corp/plane",
        content: "class APIKeyAuthentication: ..."
      }
    ],
    rightFiles: [
      {
        path: "packages/lib/server-only/api-token/get.ts",
        repoId: "github:CoopAI-Corp/documenso",
        content: "export const getApiTokenByToken = ..."
      }
    ],
    stickyRepoId: "github:CoopAI-Corp/plane"
  });
  const ids = dualCompareEvidenceRepoIds(evidence);
  assert.ok(ids.includes("github:CoopAI-Corp/plane"));
  assert.ok(ids.includes("github:CoopAI-Corp/documenso"));
  assert.equal(evidence.left.files.length, 1);
  assert.equal(evidence.right.files.length, 1);
  assert.equal(evidence.stickyRepoExcluded, undefined);
});

test("assembleDualRepoCompareEvidence rejects local Coop paths", () => {
  const parsed = parseDualRepoCompareArgs("plane documenso auth", {
    catalogRepoIds: CATALOG,
    defaultOwner: "CoopAI-Corp"
  });
  assert.ok(parsed.ok);
  if (!parsed.ok) {
    return;
  }
  const evidence = assembleDualRepoCompareEvidence({
    plan: parsed.plan,
    leftFiles: [
      {
        path: "src/chat/CoopChatSession.ts",
        repoId: "github:CoopAI-Corp/plane",
        content: "fake coop bleed"
      },
      {
        path: "/Users/jonraney/Coop-AI/src/chat/CoopChatSession.ts",
        repoId: "github:CoopAI-Corp/plane",
        content: "absolute coop"
      },
      {
        path: "apps/api/auth.py",
        repoId: WORKSPACE_LOCAL_REPO_ID,
        content: "workspace local"
      },
      {
        path: "apps/api/plane/authentication.py",
        repoId: "github:CoopAI-Corp/plane",
        content: "real plane auth"
      }
    ],
    rightFiles: [
      {
        path: "packages/lib/auth.ts",
        repoId: "github:CoopAI-Corp/documenso",
        content: "real documenso auth"
      }
    ]
  });
  assert.equal(evidence.left.files.length, 1);
  assert.equal(evidence.left.files[0]?.path, "apps/api/plane/authentication.py");
  assert.equal(evidence.right.files.length, 1);
  assert.ok(isRejectedCompareEvidencePath("src/chat/CoopChatSession.ts"));
});

test("assembleDualRepoCompareEvidence does not merge a third sticky repo silently", () => {
  const parsed = parseDualRepoCompareArgs("plane documenso auth", {
    catalogRepoIds: CATALOG,
    defaultOwner: "CoopAI-Corp"
  });
  assert.ok(parsed.ok);
  if (!parsed.ok) {
    return;
  }
  const evidence = assembleDualRepoCompareEvidence({
    plan: parsed.plan,
    leftFiles: [
      {
        path: "auth.py",
        repoId: "github:CoopAI-Corp/plane",
        content: "plane"
      },
      // Wrong-side / third-repo bleed into left bag
      {
        path: "src/other.ts",
        repoId: "github:acme/other",
        content: "third repo must drop"
      }
    ],
    rightFiles: [
      {
        path: "token.ts",
        repoId: "github:CoopAI-Corp/documenso",
        content: "documenso"
      }
    ],
    stickyRepoId: "github:acme/other"
  });
  const ids = dualCompareEvidenceRepoIds(evidence);
  assert.deepEqual(ids.sort(), ["github:CoopAI-Corp/documenso", "github:CoopAI-Corp/plane"].sort());
  assert.equal(evidence.stickyRepoExcluded, "github:acme/other");
  assert.equal(evidence.left.files.length, 1);
  assert.ok(!evidence.left.files.some((f) => f.repoId.includes("acme/other")));
});

test("filterSnippetsForCompareSide drops cross-repo bleed", () => {
  const kept = filterSnippetsForCompareSide(
    [
      { path: "a.ts", repoId: "github:CoopAI-Corp/plane", content: "ok" },
      { path: "b.ts", repoId: "github:CoopAI-Corp/documenso", content: "no" }
    ],
    { owner: "CoopAI-Corp", repo: "plane", repoId: "github:CoopAI-Corp/plane" }
  );
  assert.equal(kept.length, 1);
  assert.equal(kept[0]?.path, "a.ts");
});

console.log(`\ndualRepoCompare: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
