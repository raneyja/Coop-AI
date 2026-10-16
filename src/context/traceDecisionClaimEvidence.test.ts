import assert from "node:assert/strict";
import type { DecisionTimeline } from "../types/decisionTimeline";
import { snapshotTraceClaimEvidence, traceDecisionCurrentWindows } from "./traceDecisionClaimEvidence";

const timeline: DecisionTimeline = {
  file: "unusual-layout/core.go", provider: "gitlab", completeness: "partial", chronology: [{ date: "now", actor: "AI", event: "Invented why", evidence: "derived" }], warnings: ["No alternative exists anywhere"],
  originalCommit: { sha: "abc1234", author: "a", date: "then", message: "Rename component", overview: "AI says this introduced validation" },
  focusCommit: { sha: "def5678", author: "b", date: "later", message: "Fix validation" },
  introducingDiffSummary: { filesChanged: 18, summary: "AI says added all guards", fileChange: { type: "renamed", previousPath: "old/core.go" } },
  rationaleRanking: [{ source: "pr:4", role: "rationale", label: "AI says motive proven" }],
  linkedPR: { number: 4, title: "Validation", description: "We rejected polling because freshness matters.", state: "merged", labels: [], reviews: [{ id: "r", author: "c", body: "Approved", createdAt: "then", kind: "review" }], approvers: ["c"], overview: "AI motive" },
  alternatives: [{ option: "polling", reason_rejected: "invented reason", proposed_by: "AI", source: "derived" }],
  integrationSearch: { notion: { pages: [{ id: "n", title: "ADR validation", url: "https://example/n" }] }, confluence: { pages: [{ id: "c", title: "Design", excerpt: "We chose notifications.", htmlUrl: "https://example/c" }] } }
};
const windows = [{ path: timeline.file, content: "// TODO: extract shared validation\ncheck();", startLine: 47 }];
const snapshot = snapshotTraceClaimEvidence(timeline, windows);
assert.equal(snapshot.windows[0].startLine, 47);
assert.equal(snapshot.facts.every(fact => fact.kind === "provenance"), true);
const serialized = JSON.stringify(snapshot);
for (const unsupported of ["AI says", "AI motive", "invented reason", "No alternative exists anywhere", "Invented why"]) assert.ok(!serialized.includes(unsupported), unsupported);
assert.ok(serialized.includes("introductionVerified"));
assert.ok(serialized.includes("only; page body"));
assert.ok(serialized.includes("We rejected polling because freshness matters."));
const commitFacts = snapshot.facts.filter(fact => String((fact.value as { source: string }).source).startsWith("commit:") && !(fact.value as { source: string }).source.endsWith(":diff"));
assert.equal(commitFacts.length, 2);
timeline.linkedPR!.description = "mutated"; timeline.linkedPR!.approvers.push("new"); windows[0].content = "mutated";
assert.ok(JSON.stringify(snapshot).includes("freshness matters"));
assert.ok(!JSON.stringify(snapshot).includes("mutated"));
assert.equal(snapshot.windows[0].content, "// TODO: extract shared validation\ncheck();");
console.log("traceDecisionClaimEvidence: exact provenance, exclusion, scope and defensive copies passed");

const remotePayload = { source: "remote-codehost" as const, activeFile: "nested/core.rb", files: [{ path: "nested/core.rb", content: "check()\nreturn", lineRange: [47, 48] as [number, number] }], fallbackLevel: "partial" as const };
assert.deepEqual(traceDecisionCurrentWindows(remotePayload, "nested/core.rb"), [{ path: "nested/core.rb", content: "check()\nreturn", startLine: 47 }]);
assert.deepEqual(traceDecisionCurrentWindows({ ...remotePayload, source: "local-workspace" }, "nested/core.rb"), []);
assert.deepEqual(traceDecisionCurrentWindows(remotePayload, "other/core.rb"), []);
assert.deepEqual(traceDecisionCurrentWindows({ ...remotePayload, files: [{ ...remotePayload.files[0], lineRange: [47, 49] }] }, "nested/core.rb"), []);
assert.deepEqual(traceDecisionCurrentWindows({ ...remotePayload, files: [{ ...remotePayload.files[0], lineRange: undefined }] }, "nested/core.rb")[0].startLine, 1);

assert.deepEqual(traceDecisionCurrentWindows({ ...remotePayload, activeFile: "/nested/core.rb" }, "nested/core.rb"), []);
assert.deepEqual(traceDecisionCurrentWindows(remotePayload, "/nested/core.rb"), []);
assert.deepEqual(traceDecisionCurrentWindows({ ...remotePayload, activeFile: "../core.rb" }, "../core.rb"), []);

const retained = snapshotTraceClaimEvidence({ ...timeline, evolution: { commitCountSinceIntroduction: 2, recentCommits: [{ ...timeline.originalCommit!, message: "capped sampled title" }] } });
assert.equal((retained.facts.find(fact => (fact.value as { source: string }).source === "commit:abc1234")!.value as { message: string }).message, "Rename component");
