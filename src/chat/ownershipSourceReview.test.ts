import assert from "node:assert/strict";
import test from "node:test";
import type { OwnershipReport } from "../types/ownership";
import type { SecureApiClient, StreamChatParams } from "./SecureApiClient";
import type { LocalFileContextPayload } from "../context/localFileContext";
import { ownershipCurrentWindows, snapshotOwnershipClaimEvidence } from "../context/ownershipClaimEvidence";
import { streamSourceReviewedOwnership } from "./ownershipSourceReview";
import { sourceClaimVerdictFixture } from "./sourceClaimReviewTestFixture";
import { resolveAssignedSourceVerificationModel } from "../config/featureModelAssignments";

const request: StreamChatParams = { message: "Who should review this file?", context: {owner: "org", repo: "service", branch: "release", file: "unusual/core.rs"},
  history: [{role: "user", content: "Old unverified claim", timestamp: 1}], model: "picked-model", provider: "anthropic", useCase: "ownership",
  quotaTurnId: "same-owner-turn", maxTokens: 16000, enableThinking: true };
const report: OwnershipReport = { owner: "org", repo: "service", path: "unusual/core.rs", provider: "gitlab", completeness: "full",
  scores: [{owner: "contributor", score: 100, tier: "primary", commitCount: 0, reviewApprovals: 2, issueResolutions: 1, activityWeight: 1,
    role: "both", specialty: "database/migrations", presence: {state: "active", label: "Active · inferred"}}],
  signals: {commits: [{author: "contributor", authorLogin: "contributor", counts: {sixMonths: 0, oneYear: 1, allTime: 3}, recencyScore: 0,
    lastCommitDate: "2025-01-01T00:00:00Z", messages: ["Add route"]}], reviews: [], issues: [], activity: [], specialties: []},
  teamGraph: {members: [], escalationPath: "Unverified policy narrative"}, history: [{period: "now", label: "Current", primaryOwner: "contributor", secondaryOwners: [], narrative: "Invented complete-history narrative"}],
  risk: {singlePointOfFailure: true, expertUnavailable: false, orphaned: true, highTurnover: false, teamDispersion: false},
  messageDraft: {recipient: "contributor", text: "Invented maintainership"}, warnings: ["Invented behavioral warning"] };
const usage = {model: request.model, provider: request.provider, inputTokens: 10, outputTokens: 4, estimatedCostUsd: 0.1};
const result = (content: string) => ({message: {role: "assistant" as const, content, timestamp: 1}, finishReason: "stop" as const, usage: {...usage}});

test("typed ownership snapshot separates sampled commits, labels, presence and unmatched policy from absence or duties", () => {
  const snapshot = snapshotOwnershipClaimEvidence({...report, evidenceSummary: "Invented authority"} as OwnershipReport, [], request.context);
  const serialized = JSON.stringify(snapshot);
  for (const excluded of ["Invented authority", "Unverified policy narrative", "Invented complete-history narrative", "Invented maintainership", "Invented behavioral warning"])
    assert.ok(!serialized.includes(excluded));
  const facts = snapshot.facts.map(fact => fact.value as Record<string, unknown>);
  assert.equal(facts.find(fact => fact.source === "ownership-policy-coverage")!.declaredPolicyMatchReturned, false);
  assert.equal(facts.find(fact => fact.source === "scored-contributor")!.sampledCommitsSixMonths, 0);
  assert.equal(facts.find(fact => fact.source === "scored-contributor")!.derivedSpecialtyLabel, "database/migrations");
  assert.equal(facts.find(fact => fact.source === "slack-presence")!.label, "Active · inferred");
  assert.match(serialized, /not all activity|not no activity/);
  assert.match(serialized, /never that no declared owner exists/);
  assert.match(serialized, /do not establish maintainership/);
  assert.match(serialized, /cannot establish response availability/);
  assert.equal(snapshotOwnershipClaimEvidence({...report, owner: "foreign"}, [], request.context).facts.length, 0);
  assert.equal(snapshotOwnershipClaimEvidence({...report, path: "neighbor.rs"}, [], request.context).facts.length, 0);
  assert.throws(() => snapshotOwnershipClaimEvidence(report, [], {owner: "org", repo: "service"}));
});

test("declared policy handles and organizational lookup members remain distinct typed facts", () => {
  const org = {source: "codeowners" as const, teamName: "Platform", teamSlug: "org/platform", members: ["org/platform", "declared"], teamMembers: ["extra"], codeownersPattern: "unusual/"};
  const declared = snapshotOwnershipClaimEvidence({...report, orgContext: org}, [], request.context);
  const policy = declared.facts.find(fact => (fact.value as {source: string}).source === "matched-codeowners")!;
  assert.deepEqual((policy.value as {declaredHandles: string[]}).declaredHandles, ["org/platform", "declared"]);
  assert.deepEqual((policy.value as {extraLookupMembers: string[]}).extraLookupMembers, ["extra"]);
  const lookup = snapshotOwnershipClaimEvidence({...report, orgContext: {...org, source: "github_teams"}}, [], request.context);
  assert.ok(!lookup.facts.some(fact => (fact.value as {source: string}).source === "matched-codeowners"));
  assert.match(lookup.facts.find(fact => (fact.value as {source: string}).source === "repository-team-lookup")!.scope, /not a matched CODEOWNERS rule/);
  org.members.push("mutation");
  assert.ok(!JSON.stringify(declared).includes("mutation"));
});

test("only a commit tuple admits a dated message and its sample/tie boundary stays frozen", () => {
  const legacy = snapshotOwnershipClaimEvidence(report, [], request.context);
  const oldFact = legacy.facts.find(fact => (fact.value as { source: string }).source === "commit-sample")!;
  assert.equal((oldFact.value as { latestSampledCommit?: unknown }).latestSampledCommit, undefined);
  assert.match(oldFact.scope, /Undated messages.*no relationship/);
  const tuple = { sha: "sample-sha", date: "2025-01-01T00:00:00Z", message: "Exact sampled message", sameTimeCount: 2 };
  const updated = { ...report, signals: { ...report.signals!, commits: report.signals!.commits.map(c => ({ ...c, latestSampledCommit: tuple })) } };
  const admitted = snapshotOwnershipClaimEvidence(updated, [], request.context);
  const fact = admitted.facts.find(f => (f.value as { source: string }).source === "commit-sample")!;
  assert.deepEqual((fact.value as { latestSampledCommit: unknown }).latestSampledCommit, tuple);
  assert.match(fact.scope, /tie, not a unique latest commit/);
  tuple.message = "mutation";
  assert.ok(!JSON.stringify(admitted).includes("mutation"));
});

test("remote window admission preserves original lines across languages and rejects local, external or foreign attachments", () => {
  for (const path of ["root.ts", "odd/route.py", "nested/core.rs", "command/main.go"]) {
    const payload: LocalFileContextPayload = {source: "remote-codehost", activeFile: path, files: [{path, content: "guard\nwrite", lineRange: [20, 21]}], fallbackLevel: "partial"};
    assert.deepEqual(ownershipCurrentWindows(payload, path), [{path, content: "guard\nwrite", startLine: 20}]);
    assert.deepEqual(ownershipCurrentWindows({...payload, source: "local-workspace"}, path), []);
    assert.deepEqual(ownershipCurrentWindows({...payload, activeFile: "other.rs"}, path), []);
    assert.deepEqual(ownershipCurrentWindows({...payload, files: [{...payload.files[0], lineRange: [20, 24]}]}, path), []);
    assert.deepEqual(ownershipCurrentWindows(payload, "/private/customer/core.rs"), []);
  }
});

test("unsupported policy absence and all-activity claims repair privately once and retain routing, quota and exact publication body", async () => {
  for (const bad of ["None of these contributors are declared owners.", "The contributor had no activity in the six-month window."]) {
    const calls: StreamChatParams[] = [], visible: string[] = [];
    const good = "Declared ownership is unverified in this evidence; the retrieved sample contains zero six-month commits for this contributor.";
    const stream: SecureApiClient["streamChat"] = async (body, chunk, _base, _signal, thinking) => {
      calls.push(body); chunk("Private draft"); thinking?.("Private reasoning"); assert.equal(visible.length, 0);
      if (!body.sourceClaimReview) return result(calls.length === 1 ? bad : good);
      const evidence = JSON.parse(body.message); assert.ok(evidence.facts.length > 0); assert.deepEqual(body.history, []);
      assert.equal(evidence.facts.find((fact: {value: {source: string}}) => fact.value.source === "ownership-policy-coverage").value.declaredPolicyMatchReturned, false);
      return result(sourceClaimVerdictFixture(body, calls.length === 2 ? [{claim: bad, category: "scope", reason: "Unmatched policy and sampled commits do not establish this absence claim."}] : []));
    };
    const answer = await streamSourceReviewedOwnership({stream, request, report, windows: [], baseUrl: "https://fixture.invalid", onChunk: chunk => visible.push(chunk), onThinking: () => assert.fail("Unreviewed thinking leaked")});
    assert.equal(calls.length, 4); assert.deepEqual(visible, [good]); assert.equal(answer.message.content, good); assert.equal(answer.usage?.estimatedCostUsd, 0.4);
    for (const call of calls) {assert.equal(call.quotaTurnId, request.quotaTurnId); assert.equal(call.model, call.sourceClaimReview || call.sourceEvidenceRepair ? resolveAssignedSourceVerificationModel().model : request.model); assert.equal(call.enableThinking, true); assert.equal(call.context.branch, "release");}
  }
});

test("post-formatting unsupported owner claims cannot publish; repeated rejection reports all known calls", async () => {
  let calls = 0, cost = 0; const visible: string[] = [];
  const bad = "No declared owner exists.";
  const stream: SecureApiClient["streamChat"] = async body => {calls++; return result(body.sourceClaimReview ? sourceClaimVerdictFixture(body, [{claim: bad, category: "scope", reason: "Policy coverage is partial."}]) : "A contact candidate was sampled.");};
  await assert.rejects(streamSourceReviewedOwnership({stream, request, report, windows: [], baseUrl: "https://fixture.invalid", prepareAnswer: answer => answer + "\n\n" + bad,
    onChunk: chunk => visible.push(chunk), onFailureUsage: value => {cost += value.estimatedCostUsd;}}), /could not verify/);
  assert.equal(calls, 4); assert.equal(cost, 0.4); assert.deepEqual(visible, []);
});

test("ownership facts and source windows are frozen before synthesis; scoped no-code ownership answers need no invented quote", async () => {
  const mutable = structuredClone(report), visible: string[] = [];
  const windows = [{path: report.path, content: "// comment is only an attributed statement", startLine: 10}];
  let calls = 0;
  const good = "The contributor is a suggested contact; declared ownership and response availability remain unverified.";
  const stream: SecureApiClient["streamChat"] = async body => {
    calls++;
    if (!body.sourceClaimReview) {mutable.signals!.commits[0].counts.sixMonths = 999; mutable.scores[0].presence!.label = "Verified on call"; windows[0].content = "destroy()"; return result(good);}
    const evidence = JSON.parse(body.message);
    assert.equal(evidence.facts.find((fact: {value: {source: string}}) => fact.value.source === "commit-sample").value.sampledCommits.sixMonths, 0);
    assert.equal(evidence.facts.find((fact: {value: {source: string}}) => fact.value.source === "slack-presence").value.label, "Active · inferred");
    assert.equal(evidence.windows[0].lines.map((line: {text: string}) => line.text).join("\n"), "// comment is only an attributed statement");
    return result(sourceClaimVerdictFixture(body));
  };
  const answer = await streamSourceReviewedOwnership({stream, request, report: mutable, windows, baseUrl: "https://fixture.invalid", onChunk: chunk => visible.push(chunk)});
  assert.equal(calls, 2); assert.deepEqual(visible, [good]); assert.equal(answer.message.content, good);
});

test("operator verification and selected generation retain their actual usage labels across repair and Stop", async () => {
  for (const stopDuringReview of [false, true]) {
    const controller = new AbortController(), known: Array<{model: string; estimatedCostUsd: number}> = [], visible: string[] = [];
    let calls = 0;
    const bad = "No declared owner exists.", good = "Declared ownership is unverified in this pass.";
    const stream: SecureApiClient["streamChat"] = async body => {
      calls++;
      const content = body.sourceClaimReview ? sourceClaimVerdictFixture(body, calls === 2 ? [{claim: bad, category: "scope", reason: "No returned policy match is not exhaustive absence."}] : [])
        : calls === 1 ? bad : good;
      if (stopDuringReview && calls === 2) controller.abort();
      return {...result(content), usage: {...usage, model: body.model, provider: body.provider}};
    };
    const pending = streamSourceReviewedOwnership({stream, request, report, windows: [], signal: controller.signal,
      onChunk: value => visible.push(value), onFailureUsage: value => known.push(value), baseUrl: "https://fixture.invalid"});
    if (stopDuringReview) {await assert.rejects(pending, {name: "AbortError"});assert.deepEqual(visible, []);assert.equal(calls, 2);}
    else {const final = await pending;assert.equal(final.usage, undefined);assert.deepEqual(visible, [good]);assert.equal(calls, 4);}
    assert.equal(known.reduce((sum,value)=>sum+value.estimatedCostUsd,0), calls * usage.estimatedCostUsd);
    assert.deepEqual(known.map(value=>value.model), Array.from({length:calls},(_,index)=>index ? resolveAssignedSourceVerificationModel().model : request.model));
  }
});
