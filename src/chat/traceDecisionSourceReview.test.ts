import assert from "node:assert/strict";
import test from "node:test";
import type { SecureApiClient, StreamChatParams } from "./SecureApiClient";
import type { DecisionTimeline } from "../types/decisionTimeline";
import { streamSourceReviewedTraceDecision } from "./traceDecisionSourceReview";
import { sourceClaimVerdictFixture } from "./sourceClaimReviewTestFixture";
import { resolveAssignedSourceVerificationModel, SOURCE_VERIFICATION_MAX_TOKENS } from "../config/featureModelAssignments";
import type { SourceReviewPhase } from "./sourceBackedActionReview";

const usage = { inputTokens: 20, outputTokens: 10, estimatedCostUsd: 0.1, model: "picked-model", provider: "anthropic" };
const result = (content: string) => ({ message: { role: "assistant" as const, timestamp: 1, content }, finishReason: "stop" as const, usage: { ...usage } });
const request: StreamChatParams = { message: "Explain the decision from admitted records.", context: { owner: "tenant", repo: "odd-layout", branch: "release" }, model: usage.model, provider: "anthropic", useCase: "decision_archaeology", quotaTurnId: "one-turn", enableThinking: true, maxTokens: 16000 };
const timeline: DecisionTimeline = { file: "nested/check.rs", originalCommit: { sha: "abc1234", author: "a", date: "then", message: "Fix validation", overview: "Unverified introduction" }, alternatives: [], chronology: [], warnings: [], completeness: "minimal" };
const bad = "The guard was introduced in commit abc1234.";
const good = "The sampled commit abc1234 is titled Fix validation; the exact guard introduction is unverified.";

test("Trace title-only history cannot bypass private review; one replacement and re-review", async () => {
  const calls: StreamChatParams[] = [], visible: string[] = [];
  const stream: SecureApiClient["streamChat"] = async (body, chunk, _base, _signal, thinking) => {
    calls.push(body); chunk("Private unreviewed prose"); thinking?.("Private reasoning");
    if (!body.sourceClaimReview) return result(calls.length === 1 ? bad : good);
    const input = JSON.parse(body.message);
    assert.equal(input.windows.length, 0);
    assert.equal(input.facts[0].kind, "provenance");
    assert.equal(input.facts.find((fact: { value: { source: string } }) => fact.value.source === "commit:abc1234").value.introductionVerified, false);
    assert.ok(!body.message.includes("Unverified introduction"));
    return result(sourceClaimVerdictFixture(body, calls.length === 2 ? [{ claim: bad, category: "scope", reason: "Only a message is attached, no target patch." }] : []));
  };
  const answer = await streamSourceReviewedTraceDecision({ stream, request, timeline, windows: [], baseUrl: "https://fixture.invalid", onChunk: text => visible.push(text), prepareAnswer: text => text + "\n\nCurrent responsibility remains unknown from these records." });
  assert.equal(calls.length, 4);
  assert.deepEqual(calls.map(call => Boolean(call.sourceClaimReview)), [false, true, false, true]);
  assert.deepEqual(calls.map(call => Boolean(call.sourceEvidenceRepair)), [false, false, true, false]);
  assert.deepEqual(visible, [answer.message.content]);
  assert.ok(!visible[0].includes(bad));
  assert.equal(answer.usage?.estimatedCostUsd, 0.4);
  assert.equal(calls.every(call => call.model === (call.sourceClaimReview || call.sourceEvidenceRepair ? resolveAssignedSourceVerificationModel().model : request.model)
    && call.maxTokens === (call.sourceClaimReview || call.sourceEvidenceRepair ? SOURCE_VERIFICATION_MAX_TOKENS : request.maxTokens)
    && call.quotaTurnId === request.quotaTurnId && call.enableThinking === true), true);
});

test("Trace corrective draft uses the operator model once and reports every actual cross-provider phase cost", async () => {
  const calls: StreamChatParams[] = [], phases: SourceReviewPhase[] = [], visible: string[] = [];
  const known: NonNullable<Awaited<ReturnType<SecureApiClient["streamChat"]>>["usage"]>[] = [];
  const stream: SecureApiClient["streamChat"] = async body => {
    calls.push(body);
    const content = body.sourceClaimReview ? sourceClaimVerdictFixture(body, calls.length === 2
      ? [{claim: bad, category: "attribution", reason: "No patch proves the introduction."}] : [])
      : body.sourceEvidenceRepair ? good : bad;
    return {...result(content), usage: {...usage, model: body.model, provider: body.provider,
      inputTokens: calls.length * 20, estimatedCostUsd: calls.length / 10}};
  };
  const answer = await streamSourceReviewedTraceDecision({stream, request, timeline, windows: [], baseUrl: "https://fixture.invalid",
    onChunk: text => visible.push(text), onFailureUsage: value => known.push(value), onPhase: value => phases.push(value)});
  assert.equal(calls.length, 4); assert.equal(answer.usage, undefined); assert.deepEqual(visible, [good]);
  assert.deepEqual(known.map(value => [value.model, value.provider, value.inputTokens, value.estimatedCostUsd]),
    calls.map((body, index) => [body.model, body.provider, (index + 1) * 20, (index + 1) / 10]));
  assert.deepEqual(phases.filter(phase => phase.event === "complete").map(phase => [phase.phase, phase.model, phase.provider]),
    calls.map((body, index) => [index === 0 ? "synthesis" : index === 2 ? "repair" : "claim-review", body.model, body.provider]));
  assert.equal(calls[0].model, request.model); assert.equal(calls[0].sourceEvidenceRepair, false);
  assert.equal(calls[2].model, resolveAssignedSourceVerificationModel().model);
  assert.equal(calls[2].provider, resolveAssignedSourceVerificationModel().provider);
  assert.equal(calls[2].sourceEvidenceSynthesis, true); assert.equal(calls[2].sourceClaimReview, false);
  const first = JSON.parse(calls[0].message), repair = JSON.parse(calls[2].message.slice(0, calls[2].message.indexOf("\n\n##")));
  assert.equal(first.evidenceId, repair.evidenceId); assert.deepEqual(first.facts, repair.facts);
  assert.equal(repair.candidate, undefined); assert.deepEqual(calls[2].history, []);
});

test("Trace persistent unsupported attribution never publishes and reports actual known calls", async () => {
  let count = 0, cost = 0; const visible: string[] = [];
  const stream: SecureApiClient["streamChat"] = async body => { count++; return result(body.sourceClaimReview ? sourceClaimVerdictFixture(body, [{ claim: bad, category: "scope", reason: "No target patch." }]) : bad); };
  await assert.rejects(streamSourceReviewedTraceDecision({ stream, request, timeline, windows: [], baseUrl: "https://fixture.invalid", onChunk: text => visible.push(text), onFailureUsage: value => { cost += value.estimatedCostUsd; } }), /could not verify/);
  assert.equal(count, 4); assert.equal(cost, 0.4); assert.deepEqual(visible, []);
});

test("Trace accepts scoped message attribution without requiring a code quote", async () => {
  let count = 0;
  const stream: SecureApiClient["streamChat"] = async body => { count++; return result(body.sourceClaimReview ? sourceClaimVerdictFixture(body) : good); };
  const answer = await streamSourceReviewedTraceDecision({ stream, request, timeline, windows: [], baseUrl: "https://fixture.invalid", onChunk: () => undefined });
  assert.equal(count, 2); assert.equal(answer.message.content, good);
});

test("Trace foreign target history is not admitted under a canonical selected file", async () => {
  const selected = "separate/layout/source.py";
  const windows = [{ path: selected, startLine: 73, content: "check()" }, { path: timeline.file, startLine: 1, content: "foreign()" }];
  const stream: SecureApiClient["streamChat"] = async body => {
    if (body.sourceClaimReview) {
      const input = JSON.parse(body.message);
      assert.deepEqual(input.facts, []);
      assert.equal(input.windows.length, 1);
      assert.equal(input.windows[0].path, selected);
      assert.ok(!body.message.includes("Fix validation"));
      return result(sourceClaimVerdictFixture(body));
    }
    return result("Historical rationale is unknown from the admitted evidence.");
  };
  const answer = await streamSourceReviewedTraceDecision({ stream, request: { ...request, context: { ...request.context, file: selected } }, timeline, windows, baseUrl: "https://fixture.invalid", onChunk: () => undefined });
  assert.ok(answer.message.content.includes("Historical rationale is unknown"));
});

test("Trace generation and review share exact admitted evidence without legacy derived stories", async () => {
  const calls: StreamChatParams[] = [];
  const selected = timeline.file;
  const windows = [{ path: selected, startLine: 31, content: "if ready { check(); }" }];
  const enriched: DecisionTimeline = {
    ...timeline,
    chronology: [{ date: "then", actor: "AI", event: "Invented design story", evidence: "Derived certainty" }],
    rationaleRanking: [{ source: "commit:abc1234", role: "rationale", label: "Invented primary rationale" }],
    alternatives: [{ option: "Invented option", proposed_by: "AI", reason_rejected: "Invented reason", source: "commit:abc1234" }]
  };
  const stream: SecureApiClient["streamChat"] = async body => {
    calls.push(body);
    return result(body.sourceClaimReview ? sourceClaimVerdictFixture(body) : good);
  };
  const customQuestion = "Which decisions are actually recorded for this behavior?";
  await streamSourceReviewedTraceDecision({
    stream, question: customQuestion, timeline: enriched, windows,
    request: { ...request, context: { ...request.context, file: selected }, message: "Legacy evidenceSummary: Invented design story",
      history: [{ role: "assistant", timestamp: 1, content: "Earlier unsupported design story" }] },
    baseUrl: "https://fixture.invalid", onChunk: () => undefined
  });
  const generated = JSON.parse(calls[0].message), reviewed = JSON.parse(calls[1].message);
  assert.equal(generated.task, customQuestion);
  assert.deepEqual(generated.windows, reviewed.windows);
  for (const window of generated.windows) {
    assert.deepEqual(window.lines.map((line: {line: number}) => line.line),
      Array.from({length: window.lines.length}, (_, index) => window.startLine + index));
  }
  assert.deepEqual(generated.facts, reviewed.facts);
  assert.equal(generated.evidenceId, reviewed.evidenceId);
  assert.equal(generated.schema, "coop-source-evidence-v1");
  assert.equal(calls[0].sourceEvidenceSynthesis, true);
  assert.equal(calls[1].sourceEvidenceSynthesis, false);
  assert.ok(!calls[0].message.includes("Invented"));
  assert.ok(!calls[0].message.includes("Unverified introduction"));
  assert.deepEqual(calls[0].history, []);
  assert.equal(calls[0].attachments, undefined);
  assert.equal(calls[0].mentions, undefined);
  assert.equal(calls[0].model, request.model);
  assert.equal(calls[0].quotaTurnId, request.quotaTurnId);
  assert.deepEqual(generated.identity, reviewed.identity);
});

test("Trace missing question cannot restore a legacy bundle as the generation task", async () => {
  let generated: StreamChatParams | undefined;
  const stream: SecureApiClient["streamChat"] = async body => {
    if (!body.sourceClaimReview) generated = body;
    return result(body.sourceClaimReview ? sourceClaimVerdictFixture(body) : good);
  };
  await streamSourceReviewedTraceDecision({
    stream, timeline, windows: [], request: { ...request, message: "Legacy evidenceSummary: unsupported design certainty" },
    baseUrl: "https://fixture.invalid", onChunk: () => undefined
  });
  assert.ok(generated?.sourceEvidenceSynthesis);
  assert.ok(!generated?.message.includes("unsupported design certainty"));
  const input = JSON.parse(generated!.message);
  assert.ok(input.task.trim());
  assert.ok(!input.task.includes("Legacy evidenceSummary"));
});
