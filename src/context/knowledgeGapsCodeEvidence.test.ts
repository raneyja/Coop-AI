import assert from "node:assert/strict";
import test from "node:test";
import { gatherKnowledgeGapsCodeEvidence, knowledgeGapsSourceWindows, rankKnowledgeGapsCodePaths, KNOWLEDGE_GAPS_SOURCE_POLICY } from "./knowledgeGapsCodeEvidence";
import { knowledgeGapsFilenameQueries, knowledgeGapsFocusTopics, knowledgeGapsFocusGatherTerms } from "./knowledgeGapsFocus";
import { buildKnowledgeGapsSynthesisUserPrompt } from "../prompts/knowledgeGapsSynthesis";
import { enrichKnowledgeGapsResponse } from "../prompts/knowledgeGapsEnrichment";
import { summarizeKnowledgeGaps } from "../webview/evidenceCardSummary";
import { knowledgeGapScanCoverageFromJobScan } from "./knowledgeGapScanCoverage";
import { IntentDetector, requestTypesForIntent } from "./intentDetector";
import { streamSourceReviewedKnowledgeGaps } from "../chat/knowledgeGapsSourceReview";
import { withPassingClaimReview } from "../chat/sourceClaimReviewTestFixture";

const ask = "Before changing work-item state validation, which rules can we establish from the code, and which unanswered questions about allowed transitions need documentation or tests?";
const target = { repoId: "github:org/fixture", provider: "github", owner: "org", repo: "fixture", branch: "preview" };
const source = "class WorkSerializer:\n    def validate(self, attrs):\n        if attrs.get('state') and attrs['state'] not in self.project_states:\n            raise ValidationError('foreign state')\n        return attrs\n\n    def update(self, instance, validated_data):\n        return super().update(instance, validated_data)";

test("question framing preserves the changed subsystem and omits audit scaffolding", () => {
  assert.deepEqual(knowledgeGapsFocusTopics(ask), ["work-item state validation"]);
  assert(!knowledgeGapsFilenameQueries(ask).includes("issue"), "do not invent a canonical filename alias");
  assert(knowledgeGapsFilenameQueries(ask).includes("state"));
  assert(!knowledgeGapsFocusGatherTerms(ask).some(term => /unanswered|questions|establish/.test(term)));
});

test("focused Gaps dispatch reads code without serial repo-wide ownership/dependency scans", () => {
  const detector = new IntentDetector();
  assert.deepEqual(requestTypesForIntent(detector.fromQuickAction("knowledge-gaps", {owner: "org", repo: "fixture"}, ask)), ["knowledge_gaps"]);
  assert.deepEqual(requestTypesForIntent(detector.fromQuickAction("knowledge-gaps", {owner: "org", repo: "fixture"})), ["file_metadata", "ownership", "dependencies", "knowledge_gaps"]);
});

test("remote filename discovery survives empty semantic evidence and retains guards", async () => {
  const reads: string[] = [];
  const evidence = await gatherKnowledgeGapsCodeEvidence({ target, focus: ask, deadlineAt: Date.now() + 1_000,
    workspace: {
      findFiles: async (actualTarget, query) => {
        assert.deepEqual(actualTarget, target);
        return query === "state" ? [{ path: "service/serializers/issue.py", name: "issue.py" }] : [];
      },
      readFile: async (actualTarget, path) => {
        assert.deepEqual(actualTarget, target); reads.push(path);
        return { path, repoId: target.repoId, origin: "remote", content: source };
      }
    }, searchFocus: async () => [] });
  assert.deepEqual(reads, ["service/serializers/issue.py"]);
  assert(evidence.focusFiles[0].content.includes("raise ValidationError"));
  const prompt = buildKnowledgeGapsSynthesisUserPrompt({ evidence: { ...evidence, userFocus: ask }, userFocus: ask });
  assert(prompt.includes("L4:             raise ValidationError"));
  assert(prompt.includes("super().update"));
  assert(prompt.includes("Partial source and search misses cannot establish exhaustive coverage"));
  assert(prompt.includes("## Focused code rule audit"));
  assert(!prompt.includes("**Documentation gaps** must include"));
  assert(prompt.includes("Never merge nonadjacent ranges"));
});

test("term relevance and a fixed admission budget are independent of remote completion order", async () => {
  const reads: string[] = [];
  const focus = "Before changing token routing, which rules are established by source?";
  const paths = ["server/unrelated.data", "z/token.data", "a/other.data", "a/routing.data", "a/token-routing.data"];
  const evidence = await gatherKnowledgeGapsCodeEvidence({target, focus, deadlineAt: Date.now() + 1_000,
    workspace: {
      findFiles: async () => paths.map(path => ({path, name: path.split("/").pop()!})),
      readFile: async (actualTarget, path) => {
        assert.deepEqual(actualTarget, target);
        reads.push(path);
        if (path === "a/token-routing.data") await new Promise(resolve => setTimeout(resolve, 15));
        return {path, repoId: target.repoId, origin: "remote", content: "token routing data"};
      }
    }
  });
  assert.equal(reads.length, KNOWLEDGE_GAPS_SOURCE_POLICY.primaryFiles);
  assert.deepEqual(evidence.focusFiles.map(file => file.path), ["a/token-routing.data", "a/routing.data", "z/token.data", "a/other.data"]);
});

test("large source retains complete numeric windows beyond the old prefix cap", () => {
  const lines = [...Array.from({length: 900}, (_, i) => `# unrelated setup row ${i}`), ...source.split("\n"),
    ...Array.from({length: 180}, (_, i) => `# setup row ${i}`), "def update(instance, state):", "    return save(state)"];
  const windows = knowledgeGapsSourceWindows({ path: "service/serializers/issue.py", repoId: target.repoId, content: lines.join("\n") }, ask);
  assert(windows.some(window => window.content.includes("raise ValidationError")));
  assert(windows.some(window => window.content.includes("super().update")));
  for (const window of windows) {
    const original = lines.slice(window.startLine - 1, window.startLine - 1 + window.content.split("\n").length).join("\n");
    assert.equal(window.content, original);
  }
  const prompt = buildKnowledgeGapsSynthesisUserPrompt({evidence: {focusFiles: windows}, userFocus: ask});
  assert(prompt.includes("L904:             raise ValidationError"));
});

test("large source windows are bounded, disjoint exact excerpts without inferred semantic identity", () => {
  const lines = [...Array.from({length: 900}, () => "# unrelated file header"),
    "const quasar = route();", ...Array.from({length: 300}, () => "# unrelated middle"),
    "const routing = 'quasar';", ...Array.from({length: 300}, () => "# unrelated tail")];
  const windows = knowledgeGapsSourceWindows({path: "arbitrary.rules", repoId: target.repoId, content: lines.join("\n")}, "quasar routing");
  assert.equal(windows.length, 2);
  assert(windows.some(window => window.content.includes("const quasar")));
  assert(windows.some(window => window.content.includes("const routing")));
  for (const window of windows) {
    assert(window.content.length <= KNOWLEDGE_GAPS_SOURCE_POLICY.windowChars);
    assert.equal(window.content, lines.slice(window.startLine - 1, window.startLine - 1 + window.content.split("\n").length).join("\n"));
    assert.equal(window.enclosingClass, undefined);
  }
  assert(windows[0].startLine + windows[0].content.split("\n").length <= windows[1].startLine);
});

test("source prompt emits original numbered lines once without language-specific answer selection", () => {
  const body = "scope quasar\n    routing := enabled\n\n    delegate(value)";
  const windows = [{path: "arbitrary.rules", repoId: target.repoId, content: body, startLine: 900}];
  const prompt = buildKnowledgeGapsSynthesisUserPrompt({evidence: {focusFiles: windows}, userFocus: ask});
  assert(prompt.includes("L900: scope quasar\nL901:     routing := enabled\nL902: \nL903:     delegate(value)"));
  assert.equal(prompt.match(/L901:     routing := enabled/g)?.length, 1);
  assert(!prompt.includes("Copyable write-delegation"));
  assert(!prompt.includes("Window begins inside"));
  assert(prompt.includes("End the finding after its quote"));
  assert(prompt.includes("do not duplicate a condition and its operation as separate findings"));
  assert(prompt.includes("Unreviewed input handling and later calls are questions to verify"));
});

test("selected source starts immediately, deduplicates discovered reads, and keeps its ref", async () => {
  let reads = 0;
  const evidence = await gatherKnowledgeGapsCodeEvidence({target, focus: "Which rules are established for state validation?", selectedFile: "lib/state.ts", deadlineAt: Date.now() + 1_000,
    workspace: { findFiles: async () => [{path: "lib/state.ts", name: "state.ts"}],
      readFile: async (actualTarget, path) => { assert.deepEqual(actualTarget, target); reads++; return {path, repoId: target.repoId, origin: "remote", content: "export const state = 'PENDING';"}; } } });
  assert.equal(reads, 1);
  assert.equal(evidence.focusFiles[0].startLine, 1);
});

test("an explicit selected-file audit cannot substitute neighboring models or serializers", async () => {
  const evidence = await gatherKnowledgeGapsCodeEvidence({target, focus: "Before changing state validation in this selected issue serializer, which rules does its code establish and which questions need tests?", selectedFile: "service/serializers/issue.py", deadlineAt: Date.now() + 1_000,
    workspace: {findFiles: async () => {throw new Error("Selected-file audit must not broaden to filenames");},
      readFile: async (actualTarget, path) => {assert.deepEqual(actualTarget, target);assert.equal(path, "service/serializers/issue.py");return {path, repoId: target.repoId, origin: "remote", content: source};}},
    searchFocus: () => {throw new Error("Selected-file audit must not broaden to semantic search");}});
  assert.deepEqual(evidence.focusFiles.map(file => file.path), ["service/serializers/issue.py"]);
  assert(evidence.focusFiles[0].content.includes("super().update"));
});

test("this-file audits retain the actual remote body, not more similarly named search results", async () => {
  for (const selectedFile of ["opaque/a.ts", "nested/b.py", "c.rs", "rules.data"]) {
    const reads: string[] = [];
    const focus = "Before changing validation in this file, which rules are established by the code, and which questions need more evidence?";
    const evidence = await gatherKnowledgeGapsCodeEvidence({target, focus, selectedFile, deadlineAt: Date.now() + 1_000,
      workspace: {
        findFiles: async () => { assert.fail("Explicit file scope must not search for replacements"); },
        readFile: async (actualTarget, path) => {
          assert.deepEqual(actualTarget, target); reads.push(path);
          return {path, repoId: target.repoId, origin: "remote", content: source};
        }
      },
      searchFocus: async () => { assert.fail("Explicit file scope must not broaden to semantic hits"); }
    });
    assert.deepEqual(reads, [selectedFile]);
    assert.deepEqual(evidence.focusFiles.map(file => file.path), [selectedFile]);
    const prompt = buildKnowledgeGapsSynthesisUserPrompt({evidence, file: selectedFile, userFocus: focus});
    assert(prompt.includes(selectedFile));
    assert(prompt.includes("L4:             raise ValidationError"));
    assert(!prompt.includes("secondary"));
    const quote = `\`\`\`1:5:${selectedFile}\n${source.split("\n").slice(0, 5).join("\n")}\n\`\`\``;
    let published = "", calls = 0;
    await streamSourceReviewedKnowledgeGaps({
      evidence,
      request: {message: prompt, context: {owner: target.owner, repo: target.repo, branch: target.branch},
        model: "test-model", provider: "anthropic", useCase: "knowledge_gaps"},
      stream: withPassingClaimReview(async () => {
        calls++;
        return {message: {role: "assistant", timestamp: 1,
          content: `**Source-grounded review**\n\nWhen reached, this guard rejects a truthy state outside the shown set.\n\n${quote}\n\n**Open questions**\n\nWhich inputs reach this check? Verify the caller contract.`}, finishReason: "stop"};
      }),
      baseUrl: "https://example.test", onChunk: chunk => published += chunk
    });
    assert.equal(calls, 1, "A valid quote of the selected source needs no replacement");
    assert(published.includes(quote));
  }
});

test("an unreadable explicitly selected file cannot be replaced by a neighboring source", async () => {
  const evidence = await gatherKnowledgeGapsCodeEvidence({target, focus: "Which rules does the code in this file establish?", selectedFile: "opaque/source.data", deadlineAt: Date.now() + 1_000,
    workspace: {
      findFiles: async () => { assert.fail("An unavailable file is a coverage limit"); },
      readFile: async () => undefined
    }});
  assert.deepEqual(evidence.focusFiles, []);
});

test("focused rule audits keep scan ownership flags out of the final policy answer", () => {
  const quote = `\`\`\`1:${source.split("\n").length}:state.py\n${source}\n\`\`\``;
  const result = enrichKnowledgeGapsResponse("**Source-grounded review**\n\nThe shown excerpt establishes only its quoted syntax.\n\n" + quote + "\n\n**Open questions**\n\nWhich earlier field checks apply?", {
    userFocus: ask, focusFiles: [{path: "state.py", content: source, startLine: 1}],
    jobScanGaps: [{type: "missing_owner", message: "No ownership scores attached", file: "service/serializers/issue.py"}]
  });
  assert(result.includes("Which earlier field checks apply?"));
  assert(!result.includes("Ownership & maintenance"));
  assert(!result.includes("No ownership scores"));
});

test("deadline retains completed source and snapshots out late/foreign bodies", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const evidence = await gatherKnowledgeGapsCodeEvidence({target, focus: "Which state rules need documentation?", deadlineAt: Date.now() + 20,
    workspace: {findFiles: async () => [{path: "state.ts", name: "state.ts"}, {path: "foreign-state.ts", name: "foreign-state.ts"}, {path: "late-state.ts", name: "late-state.ts"}],
      readFile: async (_target, path) => { if(path === "late-state.ts") await gate; return {path, repoId: path === "foreign-state.ts" ? "github:other/fixture" : target.repoId, origin: "remote", content: "const state = 1;"}; }} });
  assert.deepEqual(evidence.focusFiles.map(file => file.path), ["state.ts"]);
  release(); await new Promise(resolve => setTimeout(resolve, 5));
  assert.deepEqual(evidence.focusFiles.map(file => file.path), ["state.ts"]);
});

test("completed source starts synthesis without waiting for a hung semantic enrichment", async () => {
  const start = Date.now();
  const result = await gatherKnowledgeGapsCodeEvidence({target, focus: ask, deadlineAt: start + 1_000,
    workspace: {findFiles: async () => [{path: "serializers/issue.py", name: "issue.py"}], readFile: async (_target, path) => ({path, repoId: target.repoId, origin: "remote", content: source})},
    searchFocus: () => new Promise(() => {}) });
  assert(result.focusFiles.length);
  assert(Date.now() - start < 300, "usable remote source must not wait for the gather deadline");
});

test("Stop ends focused gathering and prevents late source attachments and helper reads", async () => {
  const controller = new AbortController();
  let release!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  let reads = 0;
  const pending = gatherKnowledgeGapsCodeEvidence({target, focus: ask, signal: controller.signal, deadlineAt: Date.now() + 1_000,
    workspace: {findFiles: async () => {await gate;return [{path: "serializers/issue.py",name: "issue.py"}];},
      readFile: async (_target,path) => {reads++;return {path,repoId: target.repoId,origin: "remote",content: source};}}});
  controller.abort();
  const result = await pending;
  release(); await new Promise(resolve => setTimeout(resolve,5));
  assert.equal(reads,0);
  assert.deepEqual(result.focusFiles,[]);
});

test("search misses plus contributor scores cannot become Strong gap evidence or a generic essay", () => {
  const jobScan = {gaps: [{type: "focus_search_miss", priority: "medium"}], foundGaps: 1};
  const summary = summarizeKnowledgeGaps({jobScan, ownershipReport: {scores: [{owner: "contributor"}]} as never});
  assert.equal(summary.quality, "limited");
  assert.equal(knowledgeGapScanCoverageFromJobScan(jobScan), "scan_incomplete");
  const result = enrichKnowledgeGapsResponse("Ask @unverified to grep apiserver/; then write an ADR.", {jobScanGaps: jobScan.gaps});
  assert(!result.includes("@unverified"));
  assert(!result.includes("apiserver"));
  assert(result.includes("do not prove"));
});

test("code-only evidence counts distinct reviewed files and keeps intended policy unverified", () => {
  const summary = summarizeKnowledgeGaps({focusFiles: [
    {path: "state.py", content: source, startLine: 1},
    {path: "state.py", content: "def update(self):\n    return super().update()", startLine: 100}
  ]});
  assert.equal(summary.quality, "medium");
  assert(summary.primaryFinding?.includes("Reviewed 1 source file"));
  assert(summary.qualityReason.includes("policy and documentation coverage remain unverified"));
});

test("a focused named-file miss with no scan gaps stops without asserting path absence", () => {
  const result = enrichKnowledgeGapsResponse("The path does not exist. Write an ADR and ask @owner.", {
    userFocus: "Before changing quantum teleportation in nonexistent/quantum-teleportation.ts, which code rules can we establish?",
    focusFiles: [], jobScanGaps: []
  });
  assert.equal(result.split(/(?<=[.!?])\s+/).length, 2);
  assert(!result.includes("does not exist"));
  assert(!result.includes("@owner"));
  assert(!result.includes("**"));
  assert.equal(enrichKnowledgeGapsResponse(result, {userFocus: "quantum teleportation", focusFiles: [], jobScanGaps: []}), result);
  const summary = summarizeKnowledgeGaps({focusFiles: [], jobScan: {foundGaps: 0, gaps: [], scanCoverage: "scan_incomplete"},
    ownershipReport: {scores: [{owner: "contributor"}]} as never});
  assert.equal(summary.quality, "limited");
  assert(summary.primaryFinding?.includes("No relevant source bodies"));
  assert(!summary.limitations.some(line => line.includes("scan completed")));
});

test("code rules and motivated open questions survive empty documentation enrichment", () => {
  const content = "The state must belong to the project.\n\n**Source-grounded review**\n\nThe membership guard rejects foreign states.\n\n**Open questions**\n\nAre same-project backwards transitions intended? The membership check cannot establish that policy.\n\n**Documentation gaps**\n\nNo documentation was retrieved.";
  const result = enrichKnowledgeGapsResponse(content, {focusFiles: [{path: "state.py", content: source, startLine: 1}], jobScanGaps: []});
  assert(result.startsWith("This review is limited to the attached"));
  assert(result.includes("same-project backwards transitions"));
  assert(!result.includes("**Summary**"));
});

test("an uncited code audit cannot establish arbitrary repository-wide behavior or absence", () => {
  const unsupported = "Every caller accepts every value. No external policy or tests exist.";
  const result = enrichKnowledgeGapsResponse(unsupported, {userFocus: "Which code rules apply?", focusFiles: [{path: "arbitrary.source", content: source, startLine: 1}]});
  assert(!result.includes(unsupported));
  assert(result.includes("did not establish code rules"));
  assert(result.includes("remain unverified"));
});

test("an incomplete code audit stays unverified regardless of its topic or wording", () => {
  const result = enrichKnowledgeGapsResponse("All implementations were reviewed.\n\n**Source-grounded review**\n\nNothing else can reject this input.", {userFocus: "Which source rules apply?", focusFiles: [{path: "arbitrary.source", content: source, startLine: 1}]});
  assert(!result.includes("Nothing else"));
  assert(result.includes("remain unverified"));
});

test("policy prose normalization never rewrites a verified source quotation", () => {
  const body = 'const note = "no transition matrix is present";';
  const citation = `\`\`\`1:1:state.ts\n${body}\n\`\`\``;
  const result = enrichKnowledgeGapsResponse(`The guard's message is quoted below.\n\n${citation}\n\nAllowed transitions remain unverified.`, {focusFiles: [{path: "state.ts", content: body, startLine: 1}]});
  assert(result.includes(citation));
});

test("a citation cannot disguise a missing source review or unsupported policy assertion", () => {
  const citation = '\`\`\`1:1:arbitrary.source\nconst note = "unknown";\n\`\`\`';
  const context = {userFocus: "Which code rules apply?", focusFiles: [{path: "arbitrary.source", content: 'const note = "unknown";', startLine: 1}]};
  const result = enrichKnowledgeGapsResponse(`**Open questions**\n\nNo policy exists.\n\n${citation}`, context);
  assert(!result.includes("No policy exists"));
  assert(result.includes("remain unverified"));
  assert.equal(enrichKnowledgeGapsResponse(result, context), result);
});

test("quoted rules retain exact bytes and repair only source-established offsets", () => {
  const body = source.split("\n").slice(2,4).join("\n");
  const result = enrichKnowledgeGapsResponse(`The membership guard rejects foreign states.\n\n\`\`\`\n50:51:state.py\n${body}\n\`\`\``, {
    focusFiles: [{path: "state.py",content: source,startLine: 1}]
  });
  assert(result.includes("```3:4:state.py\n" + source.split("\n").slice(2,4).join("\n")));
  assert(!result.includes("50:51"));
  assert.equal(enrichKnowledgeGapsResponse(result,{focusFiles: [{path: "state.py",content: source,startLine: 1}]}),result);
});

test("noncontiguous model quotes cannot retain an unverified interactive citation", () => {
  const lines = source.split("\n");
  const result = enrichKnowledgeGapsResponse(`\`\`\`50:55:state.py\n${lines[0]}\n...\n${lines[4]}\n\`\`\``, {
    focusFiles: [{path: "state.py", content: source, startLine: 1}]
  });
  assert(!result.includes("50:55:state.py"));
  assert(result.includes("could not be matched to the reviewed source"));
  assert(result.includes("```1:"));
});

test("filename relevance cannot infer a source role from directory, language or types suffix", () => {
  const ranked = rankKnowledgeGapsCodePaths(["web/quasar.types.ts", "server/unrelated.ts", "rules/quasar.routing", "models/unrelated.py"], "quasar routing");
  assert.deepEqual(ranked, ["rules/quasar.routing", "web/quasar.types.ts", "models/unrelated.py", "server/unrelated.ts"]);
});

test("query terms do not substitute a domain alias or status vocabulary", () => {
  const queries = knowledgeGapsFilenameQueries("Before changing signing states, which source rules apply?");
  assert(queries.includes("signing")); assert(queries.includes("states"));
  assert(!queries.includes("sign")); assert(!queries.includes("state"));
});

test("relative import leads require one exact remote path; aliases and ambiguous modules stay unknown", async () => {
 for (const [specifier, candidates, expectedReads] of [
   ["./rules.ts", ["src/rules.ts"], ["src/allocation.ts", "src/rules.ts"]],
   ["./rules", ["src/rules.ts", "src/rules.rb"], ["src/allocation.ts"]],
   ["@fixture/rules", ["src/rules.ts"], ["src/allocation.ts"]]
 ] as const) {
  const reads: string[] = [];
  await gatherKnowledgeGapsCodeEvidence({ target, focus: "allocation behavior", deadlineAt: Date.now() + 1_000,
    workspace: {
      findFiles: async (_target, query) => (query === "allocation" ? ["src/allocation.ts"] :
        query.startsWith("src/rules") ? candidates : []).map(path => ({path, name:path})),
      readFile: async (_target, path) => {
        reads.push(path);
        return {path, repoId: target.repoId, origin: "remote", content: path === "src/allocation.ts"
          ? `import { check } from '${specifier}';\nreturn check(input);` : "export const check = value => value;"};
      }
    }
  });
  assert.deepEqual(reads, expectedReads);
 }
});

test("concurrent discovery enforces shared read and character budgets despite oversized result sets", async () => {
  const reads: string[] = [];
  const paths = Array.from({length: 500}, (_, i) => `src/settings-${String(i).padStart(3,"0")}.source`);
  const content = "import { one } from './extra-one.source';\nimport { two } from './extra-two.source';\n" +
    Array.from({length: 1200}, () => "settings " + "x".repeat(70)).join("\n");
  const result = await gatherKnowledgeGapsCodeEvidence({target, focus: "settings behavior", deadlineAt: Date.now() + 1_000,
    selectedFile: paths[0], searchFocus: async () => paths.map(path => ({path})),
    workspace: {
      findFiles: async (_target, query) => (query.startsWith("src/extra-") ? [query] : paths).map(path => ({path,name:path})),
      readFile: async (actualTarget,path) => { assert.deepEqual(actualTarget,target); reads.push(path);
        return {path, repoId:target.repoId, origin:"remote", content}; }
    }});
  assert.equal(reads.length, KNOWLEDGE_GAPS_SOURCE_POLICY.primaryFiles + KNOWLEDGE_GAPS_SOURCE_POLICY.linkedFiles);
  assert.equal(new Set(reads).size, reads.length);
  assert(result.focusFiles.length <= reads.length * KNOWLEDGE_GAPS_SOURCE_POLICY.windowsPerFile);
  assert(result.focusFiles.reduce((sum,file) => sum + file.content.length,0) <= KNOWLEDGE_GAPS_SOURCE_POLICY.maxSourceChars);
});

test("an over-budget source line cannot be partially quoted or acquire invented scope", () => {
  assert.deepEqual(knowledgeGapsSourceWindows({path:"opaque.source",repoId:target.repoId,content:"x".repeat(20_000)},"opaque rules"), []);
});

test("a body returned under another path cannot satisfy a frozen named source request", async () => {
  const result = await gatherKnowledgeGapsCodeEvidence({target,focus:"Which rules apply to requested.ts?",deadlineAt:Date.now()+1_000,
    workspace:{findFiles:async()=>[],readFile:async()=>({path:"other.ts",repoId:target.repoId,origin:"remote",content:"const requested = true;"})}});
  assert.deepEqual(result.focusFiles, []);
});
