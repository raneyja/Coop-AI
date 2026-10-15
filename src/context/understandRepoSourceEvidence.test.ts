import assert from "node:assert/strict";
import {
  gatherUnderstandSourceEvidence, rankUnderstandSourcePaths,
  understandFocusCoverage, understandIncompleteFocusMessage,
  understandSourceWindows, understandFocusQueries
} from "./understandRepoSourceEvidence";
import { enrichUnderstandRepoResponse } from "../prompts/repoSummaryResponseEnrichment";
import { shouldEnableSynthesisThinking } from "../config/chatSynthesisThinking";

const focus = "Which backend components handle authentication, input validation, and persistence when creating records?";
const target = { repoId: "github:org/service", owner: "org", repo: "service", provider: "github" as const, branch: "preview" };
const sources = [
  { path: "odd-layout/endpoint.go", content: "func Process(req Request) error { return check(req) }" },
  { path: "core/actions.rs", content: "async fn create(input: Input) -> Result<Row> { authorize(input)?; write(input).await }" },
  { path: "Modules/RecordHandler.cs", content: "async Task<Row> Create(Input input) { Validate(input); return await Save(input); }" },
  { path: "lib/operation.py", content: "def create(data):\n    check(data)\n    return save(data)" },
  { path: "Records/Operation", content: "validate input; store record" },
  { path: "frontend/web/actions.tsx", content: "export const action = async (request: Request) => validate(await request.json());" }
];

async function main(): Promise<void> {
  assert.deepEqual(understandFocusQueries(focus), ["record", "authentication", "input validation", "persistence"]);
  for (const source of sources) {
    const coverage = understandFocusCoverage(focus, [source]);
    assert.equal(coverage.sourceBodiesAvailable, true);
    assert.deepEqual(coverage.missing, coverage.requested, "availability never proves requested behavior");
    assert.equal(understandIncompleteFocusMessage(coverage), undefined, "language/layout does not cause pre-synthesis rejection");
    assert.equal(enrichUnderstandRepoResponse("Read the attached source; imported implementations remain unknown.", {userFocus: focus, entryFiles: [source]}), "Read the attached source; imported implementations remain unknown.");
    assert.equal(shouldEnableSynthesisThinking({quickAction: "understand-repo", startedAt: Date.now() - 20_000, sourceFacts: {userFocus: focus, entryFiles: [source]}}), true, "elapsed soft target cannot drop reasoning on multi-component audit");
  }
  assert.ok(understandIncompleteFocusMessage(understandFocusCoverage(focus, []))?.includes("unverified"));
  assert.equal(understandIncompleteFocusMessage(understandFocusCoverage(focus, [{path: "route", content: "   "}])), understandIncompleteFocusMessage(understandFocusCoverage(focus, [])));
  console.log("✓ languages/layouts remain eligible without certifying behavior; empty sources stay honest");

  const ranked = rankUnderstandSourcePaths(["src/unrelated.py", "custom/Authentication.KT", "node_modules/authentication.js", "custom/record.go"], focus);
  assert.ok(ranked.indexOf("custom/Authentication.KT") < ranked.indexOf("src/unrelated.py"));
  assert.ok(!ranked.some(path => path.includes("node_modules")));
  console.log("✓ lexical relevance chooses evidence without framework or extension exclusions");

  const padding = Array.from({length: 500}, (_, i) => `unrelated filler ${i} ${"x".repeat(50)}`).join("\n");
  for (const path of ["odd/handler.go", "odd/handler.rs", "odd/handler.custom"]) {
    const file = {path, startLine: 51, content: padding + "\nauthentication validation persistence record\nreturn authorizeAndStore(input)"};
    const windows = understandSourceWindows(file, focus);
    assert.ok(windows.some(window => window.content.includes("authorizeAndStore")));
    assert.ok(windows.reduce((sum, window) => sum + window.content.length, 0) <= 24_000);
    for (const window of windows) assert.equal(window.content, file.content.split("\n").slice(window.startLine! - 51, window.endLine! - 50).join("\n"));
    assert.ok(windows.every(window => window.truncated));
  }
  const hugeLine = understandSourceWindows({path: "opaque", content: "x".repeat(30_000)});
  assert.equal(hugeLine.length, 0, "never slice a partial source line into purported exact evidence");
  console.log("✓ relevance windows retain original complete lines, numeric offsets, and bounded bytes");

  const reads: string[] = [];
  const result = await gatherUnderstandSourceEvidence({workspace: {
    findFiles: async () => sources.map(source => ({path: source.path, name: source.path.split("/").pop()!})),
    readFile: async (askedTarget, path) => {
      assert.equal(askedTarget.branch, "preview"); reads.push(path);
      return {...sources.find(source => source.path === path)!, repoId: target.repoId, origin: "remote" as const};
    }
  }, target, focus, deadlineAt: Date.now() + 1000});
  assert.ok(result.entryFiles.length);
  assert.equal(new Set(reads).size, reads.length, "independent topics share reads");
  assert.ok(reads.length <= 8);
  assert.ok(result.entryFiles.every(file => file.repoId === target.repoId));
  console.log("✓ canonical remote gather pins scope, deduplicates parallel topics, and bounds reads");

  const slow = await gatherUnderstandSourceEvidence({workspace: {
    findFiles: async (_target, query) => {
      if (query === "authentication") await new Promise(resolve => setTimeout(resolve, 100));
      return [{path: "odd-layout/endpoint.go", name: "endpoint.go"}];
    },
    readFile: async (_target, path) => ({path, repoId: target.repoId, origin: "remote" as const, content: sources[0].content})
  }, target, focus, deadlineAt: Date.now() + 30});
  assert.ok(slow.entryFiles.length);
  const snapshot = JSON.stringify(slow);
  await new Promise(resolve => setTimeout(resolve, 110));
  assert.equal(JSON.stringify(slow), snapshot);
  console.log("✓ slow sibling does not erase completed evidence or mutate it after deadline");

  const stop = new AbortController();
  let lateReads = 0;
  const stopped = gatherUnderstandSourceEvidence({workspace: {
    findFiles: async () => {await new Promise(resolve => setTimeout(resolve, 30)); return [{path: "odd/file", name: "file"}];},
    readFile: async (_target, path) => {lateReads++; return {path, repoId: target.repoId, origin: "remote" as const, content: "body"};}
  }, target, focus, deadlineAt: Date.now() + 1000, signal: stop.signal});
  stop.abort();
  assert.deepEqual((await stopped).entryFiles, []);
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(lateReads, 0);
  for (const origin of ["remote", "external"] as const) {
    const rejected = await gatherUnderstandSourceEvidence({workspace: {
      findFiles: async () => [{path: "odd/file", name: "file"}],
      readFile: async (_target, path) => ({path, repoId: origin === "remote" ? "github:foreign/repo" : target.repoId, origin, content: "body"})
    }, target, focus, deadlineAt: Date.now() + 100});
    assert.equal(rejected.entryFiles.length, 0);
  }
  console.log("✓ Stop prevents late reads; foreign/local body origins cannot pass remote gathering");

  const file = {path: "odd/record.custom", content: "validate(input);\nreturn await store(input);", startLine: 70, endLine: 71};
  const quoted = enrichUnderstandRepoResponse("Flow\n\n```70:71:odd/record.custom\nvalidate(input);\nreturn await store(input);\n```", {userFocus: focus, entryFiles: [file]});
  assert.ok(quoted.includes("```70:71:odd/record.custom"));
  const invalid = enrichUnderstandRepoResponse("Flow\n\n```70:71:odd/record.custom\nvalidate(input);\nreturn invented(input);\n```", {userFocus: focus, entryFiles: [file]});
  assert.ok(!invalid.includes("invented(input)"));
  console.log("✓ source quote integrity remains enforced independently of semantic availability");
}
void main();
