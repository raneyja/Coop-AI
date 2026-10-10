import assert from "node:assert/strict";
import { test } from "node:test";
import type { IndexBackend } from "../indexing/indexBackend";
import type { RepoTarget } from "../workspace/indexedRepoWorkspaceTypes";
import { gatherBlastRadiusSourceEvidence } from "./blastRadiusSourceEvidence";
import { blastRadiusFromBundle } from "./contextBundleEvidence";
import { buildBlastRadiusSynthesisUserPrompt, enrichBlastRadiusResponse } from "../prompts/blastRadiusSynthesis";
import { summarizeBlastRadius } from "../webview/evidenceCardSummary";

const target = { repoId: "github:acme/signing", provider: "github", owner: "acme", repo: "signing", branch: "release" };
const targetFile = "lib/sign.ts";
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function index(paths: string[], source = "import-parse"): IndexBackend {
  return { dependents: async () => ({ dependents: paths, source }),
    isEnabledForRepo: async () => false, search: async () => ({ hits: [], symbols: [], source: "zoekt" }) } as unknown as IndexBackend;
}
function workspace(bodies: Record<string, string>) {
  return { readFile: async (scope: RepoTarget, path: string) => {
    assert.deepEqual(scope, target, "caller reads must use the frozen selected ref");
    return bodies[path] === undefined ? undefined : { path, content: bodies[path], repoId: target.repoId, origin: "remote" as const };
  } };
}
test("full target and callers survive bundle extraction and synthesis with guards and conditional writes", async () => {
  const bodies = {
    [targetFile]: "export function signField() {\n  if (status !== PENDING) throw Error('pending');\n  if (field.inserted) throw Error('already inserted');\n  if (isSignatureField) signature.upsert({create: value, update: value});\n}",
    "api/guarded.ts": "import { signField } from '../lib/sign';\nif (status !== PENDING) return;\nsignField();",
    "api/batch.ts": "import { signField } from '../lib/sign';\nfields.filter(field => !field.inserted).map(() => signField());"
  };
  const evidence = await gatherBlastRadiusSourceEvidence({ workspace: workspace(bodies),
    indexBackend: index(["api/guarded.ts", "api/batch.ts"]), target, file: targetFile, startedAt: Date.now() });
  const extracted = blastRadiusFromBundle([{ type: "dependencies", data: evidence },
    { type: "dependencies", data: { jobScan: { dependentsSample: [] } } }])!;
  assert.equal(extracted.sourceFiles?.length, 3);
  assert.deepEqual(extracted.directDependents?.sort(), ["api/batch.ts", "api/guarded.ts"]);
  const prompt = buildBlastRadiusSynthesisUserPrompt({ evidence: extracted, file: targetFile });
  assert.match(prompt, /2 \| if \(status !== PENDING\) return;/);
  assert.match(prompt, /3 \|   if \(field.inserted\) throw/);
  assert.match(prompt, /4 \|   if \(isSignatureField\) signature.upsert/);
  assert.match(prompt, /## Source-grounded answer policy/);
  assert.match(prompt, /Preserve full conditions, earlier exits, exception branches, and conditional operations/);
  assert.match(prompt, /Answer the user's actual request/);
  assert.doesNotMatch(prompt, /## Source checkpoints to review|Use two sections only/);
  assert.doesNotMatch(prompt, /production callers first|Testing surfaces.*secondary/);
  assert.match(prompt, /ref release/);
  assert.match(prompt, /guards.*behavioral effects are unverified|Unread callers and helpers remain unverified/);
  assert.equal(summarizeBlastRadius(extracted, targetFile).quality, "strong");
});
test("graph and SCIP evidence alone cannot preserve an unsupported caller-behavior essay", async () => {
  const evidence = await gatherBlastRadiusSourceEvidence({ workspace: workspace({ [targetFile]: "export function signField() {}" }),
    indexBackend: index(["api/guarded.ts"], "scip"), target, file: targetFile, startedAt: Date.now() });
  const result = enrichBlastRadiusResponse("Both delegate status enforcement entirely to signField. The signature will be overwritten.", evidence);
  assert.match(result, /api\/guarded.ts/);
  assert.match(result, /source bodies were not attached/);
  assert.doesNotMatch(result, /delegate status|will be overwritten/);
  assert.equal(summarizeBlastRadius(evidence, targetFile).quality, "medium");
});
test("deadline keeps completed target/caller reads and ignores a late body", async () => {
  const bodies = { [targetFile]: "export function signField() {}", "api/fast.ts": "signField();" };
  const reader = workspace(bodies);
  const evidence = await gatherBlastRadiusSourceEvidence({
    workspace: { readFile: async (scope, path) => {
      if (path !== "api/slow.ts") return reader.readFile(scope as typeof target, path);
      await delay(100);
      return { path, content: "signField();", repoId: target.repoId, origin: "remote" as const };
    } }, indexBackend: index(["api/fast.ts", "api/slow.ts"]), target, file: targetFile,
    startedAt: Date.now() - 8_930
  });
  assert.deepEqual(evidence.sourceFiles?.map(file => file.path).sort(), ["api/fast.ts", targetFile]);
  await delay(110);
  assert.equal(evidence.sourceFiles?.length, 2, "late source cannot mutate the returned evidence");
  assert.equal(summarizeBlastRadius(evidence, targetFile).quality, "medium");
});
test("Stop prevents late read callbacks and source retention", async () => {
  const controller = new AbortController();
  let attachedReads = 0;
  const pending = gatherBlastRadiusSourceEvidence({ workspace: { readFile: async (_scope, path) => {
    await delay(20);
    return { path, content: "signField();", repoId: target.repoId, origin: "remote" as const };
  } }, indexBackend: index(["api/caller.ts"]), target, file: targetFile, startedAt: Date.now(),
    signal: controller.signal, onRead: () => attachedReads++ });
  controller.abort();
  const evidence = await pending;
  assert.equal(attachedReads, 0);
  assert.equal(evidence.sourceFiles?.length, 0);
});
test("caller reads are bounded, and truncated bodies cannot earn strong behavior evidence", async () => {
  const paths = Array.from({ length: 8 }, (_, i) => `api/caller${i}.ts`);
  const bodies = Object.fromEntries(paths.map(path => [path, "const value = 1;\n".repeat(4000)]));
  const evidence = await gatherBlastRadiusSourceEvidence({ workspace: workspace({ ...bodies, [targetFile]: "export function signField() {}" }),
    indexBackend: index(paths), target, file: targetFile, startedAt: Date.now() });
  assert.equal(evidence.sourceFiles?.filter(file => file.role === "dependent").length, 3);
  assert.ok(evidence.sourceFiles?.filter(file => file.role === "dependent").every(file => file.truncated));
  assert.equal(summarizeBlastRadius(evidence, targetFile).quality, "medium");
  const namedSummary = summarizeBlastRadius({ ...evidence, namedAskSymbols: ["action"] }, targetFile);
  assert.match(namedSummary.primaryFinding, /file dependent\(s\)/);
  assert.match(namedSummary.primaryFinding, /binding and behavioral impact remain unverified/);
  assert.doesNotMatch(namedSummary.primaryFinding, /caller\(s\) of/);
});
test("wrong repository, local origin, wrong returned path and untrusted graph cannot become source proof", async () => {
  for (const returned of [
    { repoId: "github:other/repo", origin: "remote" as const },
    { repoId: target.repoId, origin: "local" as const },
    { repoId: target.repoId, origin: "remote" as const, path: "src/unrequested.ts" }
  ]) {
    const evidence = await gatherBlastRadiusSourceEvidence({ workspace: { readFile: async (_scope, path) =>
      ({ path, content: "signField();", ...returned }) },
      indexBackend: index(["api/caller.ts"], "heuristic"), target, file: targetFile, startedAt: Date.now() });
    assert.equal(evidence.sourceFiles?.length, 0);
    assert.equal(evidence.directDependents?.length, 0);
    assert.match(enrichBlastRadiusResponse("No impact. Safe to ship.", evidence), /unverified/);
  }
});

test("Stop ends a pending gather without waiting for its source or index promises", async () => {
  const controller = new AbortController();
  let release: (() => void) | undefined;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const pending = gatherBlastRadiusSourceEvidence({ workspace: { readFile: async (_scope, path) => {
    await blocked;
    return { path, content: "remote source", repoId: target.repoId, origin: "remote" as const };
  } }, indexBackend: { dependents: async () => { await blocked; return { dependents: [], source: "scip" }; } } as unknown as IndexBackend,
    target, file: targetFile, startedAt: Date.now(), signal: controller.signal });
  controller.abort();
  let completed = false;
  pending.then(() => { completed = true; });
  await delay(5);
  assert.equal(completed, true, "user Stop must release the gather independently of network completion");
  release?.();
  const evidence = await pending;
  await delay(5);
  assert.equal(evidence.sourceFiles?.length, 0);
});
