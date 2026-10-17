import assert from "node:assert/strict";
import test from "node:test";
import { streamSourceGroundedBlast } from "./blastRadiusSourceReview";
import { streamSourceReviewedKnowledgeGaps } from "./knowledgeGapsSourceReview";
import { buildSourceClaimReviewRequest, parseSourceClaimVerdict, reviewSourceClaims, sourceClaimBlocks, supportedSourceCandidate } from "./sourceClaimReview";
import { sourceClaimVerdictFixture } from "./sourceClaimReviewTestFixture";
import { KNOWLEDGE_GAPS_CODE_RULE_AUDIT_MARKER } from "../prompts/knowledgeGapsSynthesis";
import { scopeKnowledgeGapsSourceAudit } from "../prompts/knowledgeGapsEnrichment";
import type { SecureApiClient, StreamChatParams } from "./SecureApiClient";
import { resolveAssignedSourceVerificationModel, SOURCE_VERIFICATION_MAX_TOKENS } from "../config/featureModelAssignments";
import { buildSourceEvidenceSynthesisRequest } from "./sourceEvidenceSynthesis";
import type { SourceReviewPhase } from "./sourceBackedActionReview";

const windows = [{ path: "arbitrary/nested/source.opaque", startLine: 21, content: "when (scope && allowed) {\n  await execute();\n}" }];
const quote = "```21:23:arbitrary/nested/source.opaque\n" + windows[0].content + "\n```";
const unsupported = "Every input is allowed to execute.";
const supported = "When reached, this operation requires both shown conditions.";
const answer = (claim: string) => `**Source-grounded review**\n\n${claim}\n\n${quote}\n\n**Open questions**\n\nWhich callers reach this check? Verify their definitions.`;
const usage = { inputTokens: 100, outputTokens: 20, estimatedCostUsd: 0.1, model: "selected-model", provider: "anthropic" };
const result = (content: string, finishReason: "stop" | "length" = "stop") => ({
  message: {role: "assistant" as const, content, timestamp: 1}, finishReason, usage: {...usage}
});
const request: StreamChatParams = { message: KNOWLEDGE_GAPS_CODE_RULE_AUDIT_MARKER, context: {
  owner: "tenant", repo: "arbitrary", branch: "release", contextBundle: {unreviewed: "wrong source"}},
  history: [{role: "assistant", timestamp: 1, content: "unverified old claims"}],
  model: usage.model, provider: "anthropic", useCase: "blast_radius", maxTokens: 16000,
  temperature: 0.5, enableThinking: true, quotaTurnId: "one-user-turn", sessionMode: "indexed-repo", fileSource: "remote" };
const verdict = (body: StreamChatParams, revise: boolean) => {
  const value = JSON.parse(sourceClaimVerdictFixture(body,
    revise ? [{claim: unsupported, category: "conditions",
      reason: "The shown operation is conditional on scope and allowed, not universal."}] : []));
  const input = JSON.parse(body.message);
  if (input.reviewCoverage === "complete") {
    // This fixture has exactly two possible factual statements; its headings,
    // open question and verification recommendation are not source findings.
    for (const check of value.checks) {
      const block = input.blocks.find((block: {id: string}) => block.id === check.blockId);
      if (![supported, unsupported].includes(block.text)) check.kind = block.text.endsWith("?") ? "question" : "scope";
    }
  }
  return result(JSON.stringify(value));
};

for (const action of ["blast_radius", "knowledge_gaps"] as const) {
  const run = (stream: SecureApiClient["streamChat"], extra: {signal?: AbortSignal; onUsage?: (cost: number) => void; onThinking?: (content: string) => void;
    onKnownUsage?: (usage: NonNullable<Awaited<ReturnType<SecureApiClient["streamChat"]>>["usage"]>) => void; onPhase?: (phase: SourceReviewPhase) => void;
    prepareAnswer?: (content: string) => string; onValidated?: (windows: unknown, quotes: number, content: string) => void} = {}) => {
    const visible: string[] = [];
    const options = {stream, request: {...request, useCase: action}, onChunk: (chunk: string) => visible.push(chunk),
      baseUrl: "https://fixture.invalid", signal: extra.signal, question: "What rules does this source establish?",
      prepareAnswer: extra.prepareAnswer, onValidated: extra.onValidated, onThinking: extra.onThinking, onPhase: extra.onPhase};
    const promise = action === "blast_radius"
      ? streamSourceGroundedBlast({...options, evidence: {directDependents: [windows[0].path],
          sourceFiles: windows.map(window => ({...window, endLine: window.startLine + window.content.split("\n").length - 1, truncated: false, role: "dependent", repoId: "github:tenant/arbitrary", branch: "release"}))}, onPartialUsage: u => {extra.onUsage?.(u.estimatedCostUsd); extra.onKnownUsage?.(u);}})
      : streamSourceReviewedKnowledgeGaps({...options, evidence: {focusFiles: windows}, onFailureUsage: u => {extra.onUsage?.(u.estimatedCostUsd); extra.onKnownUsage?.(u);},
          onCallComplete: (role, result) => extra.onPhase?.({phase: role === "source-synthesis" ? "synthesis" : role === "replacement" ? "repair" : "claim-review",
            event: "complete", model: result.usage?.model ?? "", provider: result.usage?.provider ?? "", usage: result.usage})});
    return {visible, promise};
  };

  test(`${action}: selected source references render before preparation and review, and invalid references stay private`, async () => {
    let reviewed = "", prepared = "";
    const stream: SecureApiClient["streamChat"] = async body => {
      if (body.sourceClaimReview) {
        const input = JSON.parse(body.message);
        assert.equal(input.candidate, undefined);
        reviewed = input.blocks.map((block: {text: string}) => block.text).join("\n\n");
        assert.equal(input.windows[0].lines.map((line: {text: string}) => line.text).join("\n"), windows[0].content);
        assert(!reviewed.includes("[[source:"));
        return verdict(body, false);
      }
      return result(answer(supported).replace(quote, "[[source:window-1:21:23]]"));
    };
    const {visible, promise} = run(stream, {prepareAnswer: content => {prepared = content; return content;}});
    await promise;
    assert(prepared.includes(quote)); assert(reviewed.includes(supported)); assert.equal(visible[0], prepared);
    let calls = 0;
    const invalid: SecureApiClient["streamChat"] = async body => {
      calls++; assert(!body.sourceClaimReview, "Invalid source selection must fail before explanation review");
      return result(answer(supported).replace(quote, "[[source:window-1:20:23]]"));
    };
    const failed = run(invalid);
    await assert.rejects(failed.promise, /source quotes/);
    assert.equal(calls, 2); assert.deepEqual(failed.visible, []);
  });

  test(`${action}: exact quotes with unsupported prose are privately reviewed, repaired once and reviewed again`, async () => {
    const calls: StreamChatParams[] = [];
    const stream: SecureApiClient["streamChat"] = async body => {
      calls.push(body);
      if (body.sourceClaimReview) return verdict(body, calls.length === 2);
      return result(answer(calls.length === 1 ? unsupported : supported));
    };
    const {visible, promise} = run(stream);
    const final = await promise;
    assert.equal(calls.length, 4);
    assert.deepEqual(calls.map(body => !!body.sourceClaimReview), [false, true, false, true]);
    assert.deepEqual(calls.map(body => !!body.sourceEvidenceRepair), [false, false, true, false]);
    assert.equal(visible.length, 1); assert(!visible[0].includes(unsupported)); assert(visible[0].includes(supported));
    assert.equal(final.usage?.estimatedCostUsd, 0.4);
    for (const body of calls) {
      const qualityPhase = body.sourceClaimReview || body.sourceEvidenceRepair;
      const assignment = qualityPhase ? resolveAssignedSourceVerificationModel() : request;
      assert.equal(body.model, assignment.model); assert.equal(body.provider, assignment.provider);
      assert.equal(body.enableThinking, true); assert.equal(body.maxTokens, qualityPhase ? SOURCE_VERIFICATION_MAX_TOKENS : request.maxTokens);
      assert.equal(body.quotaTurnId, request.quotaTurnId); assert.equal(body.context.branch, "release");
    }
    for (const body of calls.filter(body => body.sourceClaimReview)) {
      assert.deepEqual(body.history, []); assert.equal(body.context.contextBundle, undefined);
      const data = JSON.parse(body.message);
      assert.deepEqual(data.windows.map((window: {path: string; startLine: number; lines: Array<{text: string}>}) => ({
        path: window.path, startLine: window.startLine, content: window.lines.map(line => line.text).join("\n")})), windows);
      assert.equal(data.candidate, undefined); assert(!body.message.includes("wrong source"));
      assert(!body.message.includes("unverified old claims"));
    }
    assert(calls[2].message.includes("conditions"));
    assert(!calls[2].message.includes(JSON.stringify(answer(unsupported))), "Replacement must not be anchored to the rejected draft");
    assert(calls[2].message.includes("unchecked claims were not approved"));
  });

  test(`${action}: corrective quality-model phase preserves mixed provider usage without fabricating an aggregate`, async () => {
    const calls: StreamChatParams[] = [], phases: SourceReviewPhase[] = [];
    const known: NonNullable<Awaited<ReturnType<SecureApiClient["streamChat"]>>["usage"]>[] = [];
    const stream: SecureApiClient["streamChat"] = async body => {
      calls.push(body);
      const response = body.sourceClaimReview ? verdict(body, calls.length === 2)
        : result(answer(body.sourceEvidenceRepair ? supported : unsupported));
      return {...response, usage: {...usage, model: body.model, provider: body.provider, inputTokens: calls.length * 10,
        outputTokens: calls.length, estimatedCostUsd: calls.length / 10}};
    };
    const attempted = run(stream, {onKnownUsage: value => known.push(value), onPhase: value => phases.push(value)});
    const final = await attempted.promise;
    assert.equal(calls.length, 4); assert.equal(final.usage, undefined); assert.equal(attempted.visible.length, 1);
    assert.deepEqual(known.map(value => [value.model, value.provider, value.inputTokens, value.outputTokens, value.estimatedCostUsd]),
      calls.map((body, index) => [body.model, body.provider, (index + 1) * 10, index + 1, (index + 1) / 10]));
    const complete = phases.filter(phase => phase.event === "complete");
    assert.deepEqual(complete.map(phase => phase.phase), ["synthesis", "claim-review", "repair", "claim-review"]);
    assert.deepEqual(complete.map(phase => [phase.model, phase.provider]), calls.map(body => [body.model, body.provider]));
    assert.equal(known.reduce((sum, value) => sum + value.estimatedCostUsd, 0), 1);
    assert.equal(calls[0].model, request.model);
    assert.equal(calls[2].model, resolveAssignedSourceVerificationModel().model);
    assert.equal(calls[2].maxTokens, SOURCE_VERIFICATION_MAX_TOKENS);
    assert.equal(calls[2].sourceEvidenceSynthesis, true); assert.equal(calls[2].sourceClaimReview, false);
    assert.equal(calls[2].quotaTurnId, request.quotaTurnId);
  });

  test(`${action}: continuing unsupported claims never publish and cannot create a regeneration loop`, async () => {
    let calls = 0, cost = 0;
    const stream: SecureApiClient["streamChat"] = async body => {calls++; return body.sourceClaimReview ? verdict(body, true) : result(answer(unsupported));};
    const {visible, promise} = run(stream, {onUsage: value => cost += value});
    await assert.rejects(promise, /explanation against the reviewed source/);
    assert.equal(calls, 4); assert.deepEqual(visible, []); assert.equal(cost, 0.4);
  });

  test(`${action}: final formatting cannot add valid or unresolved source selections after validation`, async () => {
    for (const marker of ["[[source:window-999:21:23]]", "[[source:window-1:21:23]]"]) {
      let calls = 0;
      const stream: SecureApiClient["streamChat"] = async body => {
        calls++; assert(!body.sourceClaimReview, "A formatting-added source selection must fail before semantic review");
        return result(answer(supported));
      };
      const attempt = run(stream, {prepareAnswer: content => content + "\n\n" + marker});
      await assert.rejects(attempt.promise, /source quotes/);
      assert.equal(calls, 2); assert.deepEqual(attempt.visible, []);
    }
  });

  test(`${action}: rejected answer and reviewer reasoning stay private without disabling reasoning`, async () => {
    let calls = 0;
    const thoughts: string[] = [];
    const stream: SecureApiClient["streamChat"] = async (body, chunk, _base, _signal, thinking) => {
      calls++;
      assert.equal(body.enableThinking, true);
      thinking?.("Unsupported certainty inside generated reasoning.");
      chunk("Unreviewed partial answer.");
      return body.sourceClaimReview ? verdict(body, calls === 2) : result(answer(calls === 1 ? unsupported : supported));
    };
    const {visible, promise} = run(stream, {onThinking: content => thoughts.push(content)});
    await promise;
    assert.equal(calls, 4);
    assert.deepEqual(thoughts, []);
    assert.equal(visible.length, 1);
    assert(!visible[0].includes(unsupported));
  });

  test(`${action}: missing, malformed or truncated reviewer response fails closed with known cost`, async () => {
    for (const failure of ["throw", "legacy-answer", "length", "wrong-candidate"] as const) {
      let calls = 0, cost = 0;
      const stream: SecureApiClient["streamChat"] = async body => {
        calls++;
        if (!body.sourceClaimReview) return result(answer(supported));
        if (failure === "throw") throw Error("review unavailable");
        if (failure === "legacy-answer") return result("Old backend returned another answer.");
        const response = verdict(body, false);
        if (failure === "length") response.finishReason = "length";
        if (failure === "wrong-candidate") response.message.content = response.message.content.replace(JSON.parse(body.message).candidateId, "different");
        return response;
      };
      const {visible, promise} = run(stream, {onUsage: value => cost += value});
      await assert.rejects(promise);
      assert.equal(calls, 2); assert.deepEqual(visible, []); assert.equal(cost, failure === "throw" ? 0.1 : 0.2);
    }
  });

  test(`${action}: Stop during review prevents repair and publication and retains both call costs`, async () => {
    const controller = new AbortController(); let calls = 0, cost = 0;
    const stream: SecureApiClient["streamChat"] = async body => {
      calls++;
      if (!body.sourceClaimReview) return result(answer(unsupported));
      controller.abort(); return verdict(body, true);
    };
    const {visible, promise} = run(stream, {signal: controller.signal, onUsage: value => cost += value});
    await assert.rejects(promise, {name: "AbortError"});
    assert.equal(calls, 2); assert.deepEqual(visible, []); assert.equal(cost, 0.2);
  });

  test(`${action}: final display text is reviewed, and formatting cannot introduce unchecked factual claims`, async () => {
    let calls = 0;
    const candidates: string[] = [];
    const stream: SecureApiClient["streamChat"] = async body => {
      calls++;
      if (!body.sourceClaimReview) return result(answer(supported));
      candidates.push(JSON.parse(body.message).blocks.map((block: {text: string}) => block.text).join("\n\n"));
      assert(candidates.at(-1)!.includes(unsupported));
      return verdict(body, true);
    };
    const {visible, promise} = run(stream, {prepareAnswer: content => content.replace(supported, unsupported)});
    await assert.rejects(promise, /explanation against the reviewed source/);
    assert.equal(calls, 4); assert.equal(candidates.length, 2); assert.deepEqual(visible, []);
  });

  test(`${action}: preparation preserves citations and publication exactly matches the reviewed body`, async () => {
    let reviewedBlocks: ReturnType<typeof sourceClaimBlocks> = [], validatedBody = "";
    const stream: SecureApiClient["streamChat"] = async body => {
      if (!body.sourceClaimReview) return result(answer(supported));
      reviewedBlocks = JSON.parse(body.message).blocks;
      return verdict(body, false);
    };
    const {visible, promise} = run(stream, {prepareAnswer: content => content.replace(supported, supported + " The called implementation is unreviewed."),
      onValidated: (_windows, _quotes, content) => {validatedBody = content;}});
    const final = await promise;
    assert.equal(visible[0], validatedBody); assert.equal(final.message.content, validatedBody);
    assert.deepEqual(sourceClaimBlocks(validatedBody), reviewedBlocks); assert(validatedBody.includes(quote));
  });

  test(`${action}: formatting that changes exact source cannot bypass citation checking`, async () => {
    let calls = 0;
    const stream: SecureApiClient["streamChat"] = async body => {
      calls++; assert(!body.sourceClaimReview, "Invalid formatted citations must fail before explanation review");
      return result(answer(supported));
    };
    const {visible, promise} = run(stream, {prepareAnswer: content => content.replace("await execute();", "await destroy();")});
    await assert.rejects(promise, /source quotes/);
    assert.equal(calls, 2); assert.deepEqual(visible, []);
  });

  test(`${action}: missing completion cannot publish, and reported cancellation cannot regenerate`, async () => {
    for (const reason of [undefined, "error", "cancelled"] as const) {
      let calls = 0, cost = 0;
      const stream: SecureApiClient["streamChat"] = async body => {
        calls++;
        if (body.sourceClaimReview) return verdict(body, false);
        return {...result(answer(supported)), finishReason: calls === 1 ? reason : "stop"};
      };
      const {visible, promise} = run(stream, {onUsage: value => cost += value});
      if (reason === "cancelled") {
        await assert.rejects(promise, {name: "AbortError"});
        assert.equal(calls, 1); assert.deepEqual(visible, []); assert.equal(cost, 0.1);
      } else {
        await promise;
        assert.equal(calls, 3, "Incomplete draft must be replaced before any review or publication");
        assert.equal(visible.length, 1);
      }
    }
  });

  test(`${action}: all review batches retain actual cost and a single publication`, async () => {
    const candidate = answer(Array.from({length: 19}, (_, index) => `Scoped observation ${index + 1} is conditional.`).join("\n\n"));
    const published = action === "knowledge_gaps" ? scopeKnowledgeGapsSourceAudit(candidate) : candidate;
    const checked: string[] = []; let calls = 0;
    const stream: SecureApiClient["streamChat"] = async body => {
      calls++;
      if (!body.sourceClaimReview) return result(candidate);
      checked.push(...JSON.parse(body.message).blocks.map((block: {id: string}) => block.id));
      return result(sourceClaimVerdictFixture(body));
    };
    const {visible, promise} = run(stream);
    const final = await promise;
    assert.equal(calls, 1 + Math.ceil(sourceClaimBlocks(published).length / 16));
    assert.deepEqual(checked, sourceClaimBlocks(published).map(block => block.id));
    assert.equal(final.usage?.inputTokens, calls * usage.inputTokens);
    assert.equal(final.usage?.estimatedCostUsd, calls * usage.estimatedCostUsd);
    assert.deepEqual(visible, [published]);
  });
}

test("reviewer cannot certify another candidate, return inconsistent verdicts, or cite code as a prose issue", () => {
  const body = buildSourceClaimReviewRequest(request, answer(supported), windows);
  const good = verdict(body, false);
  assert.equal(parseSourceClaimVerdict(good, answer(supported), body).supported, true);
  assert.equal(parseSourceClaimVerdict(result("```json\n" + good.message.content + "\n```"), answer(supported), body).supported, true);
  for (const framed of ["Review:\n```json\n" + good.message.content + "\n```", "```json\n" + good.message.content,
    "```json\n" + good.message.content + "\n```\nUnchecked explanation."]) {
    assert.throws(() => parseSourceClaimVerdict(result(framed), answer(supported), body), /invalid review/);
  }
  const data = JSON.parse(good.message.content);
  const first = data.checks[0];
  for (const change of [{candidateId: "other"}, {evidenceId: "other"}, {schema: "coop-source-claims-v1"}, {schema: "coop-source-claims-v2"},
    {verdict: "revise"}, {checks: null}, {checks: data.checks.slice(1)},
    {checks: [...data.checks.slice(1), data.checks[1]]},
    {checks: [{...first, blockId: "unknown"}, ...data.checks.slice(1)]},
    {checks: [{...first, supports: []}, ...data.checks.slice(1)]},
    {checks: [{...first, supports: [{windowId: "window-1", startLine: 1, endLine: 1}]}, ...data.checks.slice(1)]},
    {checks: [{...first, supports: [{factId: "unadmitted"}]}, ...data.checks.slice(1)]},
    {checks: [{...first, category: "unknown"}, ...data.checks.slice(1)]},
    {checks: [{...first, counterexample: ""}, ...data.checks.slice(1)]}]) {
    assert.throws(() => parseSourceClaimVerdict(result(JSON.stringify({...data, ...change})), answer(supported), body), /invalid review/);
  }
});

test("all paragraphs, headings and question premises are covered; source quotes are excluded", () => {
  const body = buildSourceClaimReviewRequest(request, answer(supported), windows);
  const input = JSON.parse(body.message);
  assert.equal(input.blocks.length, 5);
  assert(input.blocks.some((block: {text: string}) => block.text.includes("Which callers")));
  assert(!input.blocks.some((block: {text: string}) => block.text.includes("await execute")));
  const data = JSON.parse(sourceClaimVerdictFixture(body));
  data.checks[4] = {...data.checks[4], kind: "question", supports: []};
  assert.equal(parseSourceClaimVerdict(result(JSON.stringify(data)), answer(supported), body).supported, true);
  const other = buildSourceClaimReviewRequest({...request, context: {...request.context, branch: "other"}}, answer(supported), windows);
  assert.throws(() => parseSourceClaimVerdict(result(JSON.stringify(data)), answer(supported), other), /invalid review/);
});

test("typed facts support only the frozen evidence ID and real source window ranges", () => {
  const candidate = "The inventory reports 42 files; listed entries are a sample.";
  const body = buildSourceClaimReviewRequest(request, candidate, [], undefined, undefined,
    [{kind: "inventory", scope: "Canonical inventory at selected branch; not sampled totals", value: {fileCount: 42}}]);
  assert.equal(parseSourceClaimVerdict(result(sourceClaimVerdictFixture(body)), candidate, body).supported, true);
  const changed = buildSourceClaimReviewRequest(request, candidate, [], undefined, undefined,
    [{kind: "sample", scope: "Capped sample only", value: {fileCount: 42}}]);
  assert.throws(() => parseSourceClaimVerdict(result(sourceClaimVerdictFixture(body)), candidate, changed), /invalid review/);
});


test("prose claim units keep inline source, URLs and original Unicode bytes opaque", () => {
  const candidate = "The local statement creates `Error('é. value')`. Called helpers remain unreviewed. See [rationale](https://example.test/a.b?q=x).";
  const blocks = sourceClaimBlocks(candidate);
  assert.equal(blocks.length, 3);
  assert.equal(blocks[0].text, "The local statement creates `Error('é. value')`.");
  assert.equal(blocks[1].text, "Called helpers remain unreviewed.");
  assert.equal(blocks[2].text, "See [rationale](https://example.test/a.b?q=x).");
});

test("formatted prose, anonymous code and diagram labels cannot bypass claim coverage", () => {
  for (const fence of ["```text\nEvery request writes without authorization.\n```", "~~~mermaid\nA[Every call succeeds]\n~~~",
    "```\nGuaranteed implementation\n```", "```ts\n// no other safeguards exist\nexecute();\n```", "```1:1:unverified.ts\nnot closed"]) {
    const blocks = sourceClaimBlocks(fence);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].text, fence);
  }
  assert.equal(sourceClaimBlocks(quote).length, 0, "Already verified numeric source remains quoted evidence");
});


test("negative-first review can defer remaining units, but no deferred unit can authorize publication", () => {
  const candidate = "All calls succeed. Helpers are unreviewed.";
  const body = buildSourceClaimReviewRequest(request, candidate, windows);
  const data = JSON.parse(sourceClaimVerdictFixture(body, [{claim: "All calls succeed.", category: "conditions", reason: "The awaited helper may reject."}]));
  data.checks[1] = {...data.checks[1], kind: "unreviewed", decision: "deferred", supports: [],
    qualificationStatus: "unreviewed", counterexampleStatus: "unreviewed", publicQualifications: []};
  assert.equal(parseSourceClaimVerdict(result(JSON.stringify(data)), candidate, body).supported, false);
  assert.throws(() => parseSourceClaimVerdict(result(JSON.stringify({...data, verdict: "supported"})), candidate, body));
  data.checks[0].decision = "supported";
  assert.throws(() => parseSourceClaimVerdict(result(JSON.stringify(data)), candidate, body), /invalid review/);
});

test("bounded reviews preserve full qualifiers and require every unit before publication", async () => {
  const candidate = Array.from({length: 19}, (_, i) => `Scoped observation ${i + 1} remains conditional.`).join("\n\n");
  const checked: string[] = [];
  const verdict = await reviewSourceClaims({request, candidate, windows, run: async body => {
    const input = JSON.parse(body.message);
    assert.equal(input.candidate, undefined);
    assert(input.blocks.length <= 16);
    assert.equal(input.windows[0].endLine, 23);
    checked.push(...input.blocks.map((block: {id: string}) => block.id));
    return result(sourceClaimVerdictFixture(body));
  }});
  assert.equal(verdict.supported, true);
  assert.deepEqual(checked, sourceClaimBlocks(candidate).map(block => block.id));
});

test("private review uses the operator assignment and fixed capacity without changing generation settings", () => {
  const synthesis = {...request, maxTokens: 8192};
  const body = buildSourceClaimReviewRequest(synthesis, supported, windows);
  assert.equal(synthesis.maxTokens, 8192);
  assert.equal(body.maxTokens, SOURCE_VERIFICATION_MAX_TOKENS);
  assert.equal(body.model, resolveAssignedSourceVerificationModel().model);
  assert.equal(body.provider, resolveAssignedSourceVerificationModel().provider);
  assert.equal(synthesis.model, request.model); assert.equal(synthesis.provider, request.provider);
  assert.equal(body.enableThinking, true);
  assert.equal(body.quotaTurnId, synthesis.quotaTurnId);
  assert.equal(buildSourceClaimReviewRequest({...request, maxTokens: 48000, enableThinking: false}, supported, windows).maxTokens, SOURCE_VERIFICATION_MAX_TOKENS);
  assert.equal(buildSourceClaimReviewRequest({...request, enableThinking: false}, supported, windows).enableThinking, true);
  const inherited = buildSourceClaimReviewRequest({...request, sourceEvidenceRepair: true, sourceEvidenceSynthesis: true}, supported, windows);
  assert.equal(inherited.sourceClaimReview, true); assert.equal(inherited.sourceEvidenceRepair, false);
  assert.equal(inherited.sourceEvidenceSynthesis, false);
});

test("bounded reviews stop on rejection or Stop and cannot certify foreign batch units", async () => {
  const candidate = Array.from({length: 19}, (_, i) => `Scoped observation ${i + 1} remains conditional.`).join("\n\n");
  let calls = 0;
  const verdict = await reviewSourceClaims({request, candidate, windows, run: async body => {
    calls++;
    return result(sourceClaimVerdictFixture(body, [{claim: JSON.parse(body.message).blocks[0].text,
      category: "scope", reason: "A stated condition is not supported."}]));
  }});
  assert.equal(verdict.supported, false); assert.equal(calls, 1);
  const controller = new AbortController(); calls = 0;
  await assert.rejects(reviewSourceClaims({request, candidate, windows, signal: controller.signal, run: async body => {
    calls++; controller.abort(); return result(sourceClaimVerdictFixture(body));
  }}), {name: "AbortError"});
  assert.equal(calls, 1);
  const blocks = sourceClaimBlocks(candidate);
  const body = buildSourceClaimReviewRequest(request, candidate, windows, undefined, undefined, undefined, blocks.slice(0, 8));
  const data = JSON.parse(sourceClaimVerdictFixture(body)); data.checks[0].blockId = blocks[8].id;
  assert.throws(() => parseSourceClaimVerdict(result(JSON.stringify(data)), candidate, body), /invalid review/);
  assert.throws(() => buildSourceClaimReviewRequest(request, candidate, windows, undefined, undefined, undefined,
    [{...blocks[0], text: "Mutated qualifier"}]), /invalid review/);
});

test("v3 consistency admissions require revision for every supported epistemic kind", () => {
  const candidate = "The token can complete any selected action.";
  const body = buildSourceClaimReviewRequest(request, candidate, windows);
  for (const kind of ["fact", "hypothesis", "question", "scope"]) {
    for (const admission of [{qualificationStatus: "missing"}, {counterexampleStatus: "unresolved-contradiction"}]) {
      const data = JSON.parse(sourceClaimVerdictFixture(body));
      Object.assign(data.checks[0], {kind}, admission);
      const parsed = parseSourceClaimVerdict(result(JSON.stringify(data)), candidate, body);
      assert.equal(parsed.supported, false);
      assert.equal(parsed.issues.length, 1);
      assert.equal(parsed.issues[0].claim, candidate);
      assert.match(parsed.issues[0].reason, /missing|unresolved/);
    }
  }
});

test("v3 exact local public qualifications allow honestly narrowed observations and hypotheses", () => {
  for (const [candidate, quote, kind, status] of [
    ["If execution reaches this branch, the shown guard runs. Earlier calls remain unreviewed.", "If execution reaches this branch", "fact", "excluded-by-candidate"],
    ["These are query arguments only; they do not establish successful authorization.", "do not establish successful authorization", "fact", "excluded-by-candidate"],
    ["Changing the returned shape could affect a caller, if that caller uses the property.", "if that caller uses the property", "hypothesis", "consistent"],
    ["The comment records duplication; current implementation elsewhere remains unknown.", "current implementation elsewhere remains unknown", "fact", "excluded-by-candidate"],
    ["The call expression is present; its successful completion is not established.", "successful completion is not established", "fact", "excluded-by-candidate"],
    ["If reached, the 😀 branch contains the call.", "If reached", "fact", "consistent"]
  ]) {
    const body = buildSourceClaimReviewRequest(request, candidate, windows);
    const data = JSON.parse(sourceClaimVerdictFixture(body));
    const check = data.checks[0];
    Object.assign(check, {kind, qualificationStatus: "present", counterexampleStatus: status, publicQualifications: [quote]});
    check.counterexample = "An earlier call might reject; the public statement preserves its actual scope.";
    assert.equal(parseSourceClaimVerdict(result(JSON.stringify(data)), candidate, body).supported, true);
  }
});

test("v3 scopes remain stable per prose paragraph/list item and never include fenced sources", () => {
  const candidate = "When reached, the call is shown. Its result is unreviewed.\n\n- First item is scoped to the sample.\n- Second item asserts a global result.\n\n" + quote + "\n\n```text\nA formatted claim remains checked.\n```";
  const blocks = sourceClaimBlocks(candidate);
  assert.equal(blocks[0].context?.id, blocks[1].context?.id);
  assert.notEqual(blocks.find(block => block.text.includes("First item"))?.context?.id,
    blocks.find(block => block.text.includes("Second item"))?.context?.id);
  assert(!blocks.some(block => block.context?.text.includes("await execute")));
  assert.equal(blocks.at(-1)?.context, null);
  const inline = sourceClaimBlocks("The shown string is `first\n- not a list item`; when reached it is local. Its uses remain unknown.");
  assert.equal(inline[0].context?.id, inline[1].context?.id);
  assert(inline[0].context?.text.includes("- not a list item"));
  const body = buildSourceClaimReviewRequest(request, candidate, windows);
  const forged = JSON.parse(body.message);
  forged.blocks[0].context.text += " Global safety is guaranteed.";
  assert.throws(() => parseSourceClaimVerdict(result(sourceClaimVerdictFixture(body)), candidate,
    {...body, message: JSON.stringify(forged)}), /invalid review/);
});

test("v3 malformed or foreign qualification anchors and legacy status fields fail closed", () => {
  const candidate = "Only sampled entries are known.\n\nThe operation always succeeds.\n\n" + quote;
  const body = buildSourceClaimReviewRequest(request, candidate, windows);
  const original = JSON.parse(sourceClaimVerdictFixture(body));
  for (const fields of [
    {qualificationStatus: undefined}, {counterexampleStatus: undefined}, {publicQualifications: undefined},
    {qualificationStatus: "safe"}, {counterexampleStatus: "unknown"}, {publicQualifications: "Only sampled entries"},
    {qualificationStatus: "present", publicQualifications: []},
    {qualificationStatus: "present", publicQualifications: [" "]},
    {qualificationStatus: "present", publicQualifications: ["."]},
    {qualificationStatus: "present", publicQualifications: ["Only sampled entries are known."]},
    {qualificationStatus: "present", publicQualifications: ["await execute();"]},
    {qualificationStatus: "present", publicQualifications: Array(9).fill("The operation always succeeds.")},
    {qualificationStatus: "none-required", publicQualifications: ["The operation always succeeds."]},
    {qualificationStatus: "unreviewed"}, {counterexampleStatus: "unreviewed"},
    {counterexampleStatus: "excluded-by-candidate", publicQualifications: []},
    {kind: "scope", supports: [], counterexampleStatus: "excluded-by-evidence"}
  ]) {
    const data = structuredClone(original);
    Object.assign(data.checks[1], fields);
    assert.throws(() => parseSourceClaimVerdict(result(JSON.stringify(data)), candidate, body), /invalid review/);
  }
  const formatted = "```text\nIf reached, the result is certain.\n```";
  const formattedBody = buildSourceClaimReviewRequest(request, formatted, windows);
  const data = JSON.parse(sourceClaimVerdictFixture(formattedBody));
  Object.assign(data.checks[0], {qualificationStatus: "present", publicQualifications: ["If reached"]});
  assert.throws(() => parseSourceClaimVerdict(result(JSON.stringify(data)), formatted, formattedBody), /invalid review/);
});

test("v3 inconsistent supported batch stops reviews with a material issue and no new loop", async () => {
  const candidate = Array.from({length: 19}, (_, i) => `Shown observation ${i + 1} is conditional.`).join("\n\n");
  let calls = 0;
  const verdict = await reviewSourceClaims({request, candidate, windows, run: async body => {
    calls++;
    const data = JSON.parse(sourceClaimVerdictFixture(body));
    data.checks[0].counterexampleStatus = "unresolved-contradiction";
    return result(JSON.stringify(data));
  }});
  assert.equal(verdict.supported, false); assert.equal(calls, 1); assert.equal(verdict.issues.length, 1);
});

test("missing qualifications may retain exact partial local anchors but can never authorize publication", () => {
  const candidate = "If reached, this action always succeeds.";
  const body = buildSourceClaimReviewRequest(request, candidate, windows);
  for (const kind of ["fact", "question", "scope", "hypothesis"]) {
    for (const counterexampleStatus of ["consistent", "unresolved-contradiction", "excluded-by-candidate"]) {
      const data = JSON.parse(sourceClaimVerdictFixture(body));
      Object.assign(data.checks[0], {kind, qualificationStatus: "missing", counterexampleStatus, publicQualifications: ["If reached"]});
      const parsed = parseSourceClaimVerdict(result(JSON.stringify(data)), candidate, body);
      assert.equal(parsed.supported, false); assert.equal(parsed.issues.length, 1);
    }
  }
  const data = JSON.parse(sourceClaimVerdictFixture(body));
  Object.assign(data.checks[0], {qualificationStatus: "missing", publicQualifications: ["Only authorized inputs"]});
  assert.throws(() => parseSourceClaimVerdict(result(JSON.stringify(data)), candidate, body), /invalid review/);
});

test("verification contains only selected units and owned contexts, never the full candidate body", () => {
  const candidate = "Shown local observation.\n\nUnrelated omitted paragraph must not bias this batch.";
  const blocks = sourceClaimBlocks(candidate);
  const body = buildSourceClaimReviewRequest(request, candidate, windows, "Review the selected unit.", undefined, undefined, [blocks[0]]);
  const input = JSON.parse(body.message);
  assert.equal(input.candidate, undefined);
  assert.equal(input.question, "Review the selected unit.");
  assert.deepEqual(input.blocks, [blocks[0]]);
  assert(!body.message.includes("Unrelated omitted paragraph"));
  assert.equal(parseSourceClaimVerdict(result(sourceClaimVerdictFixture(body)), candidate, body).supported, true);
  assert.throws(() => parseSourceClaimVerdict(result(sourceClaimVerdictFixture(body)), candidate + " Changed omitted prose.", body), /invalid review/);
});

test("generation and review share numbered exact source bytes and the same canonical evidence hash", () => {
  const sources = [{path: "same.opaque", startLine: 42, content: "α 😀\r\nsecond\r\n"},
    {path: "same.opaque", startLine: 150, content: "disjoint"}];
  const generation = JSON.parse(buildSourceEvidenceSynthesisRequest(request, "Explain", sources).message);
  const body = buildSourceClaimReviewRequest(request, "The shown source is sampled.", sources);
  const review = JSON.parse(body.message);
  assert.equal(review.evidenceId, generation.evidenceId);
  assert.deepEqual(review.windows, generation.windows);
  assert.deepEqual(review.windows[0].lines, [{line: 42, text: "α 😀\r"}, {line: 43, text: "second\r"}, {line: 44, text: ""}]);
  assert.equal(review.windows[1].lines[0].line, 150);
  assert(!("content" in review.windows[0]));
  assert.equal(parseSourceClaimVerdict(result(sourceClaimVerdictFixture(body)), "The shown source is sampled.", body).supported, true);
});

test("numbered source lines cannot mutate bytes, numbering or containment while retaining frozen evidence identity", () => {
  const candidate = "The source contains a conditional call.";
  const body = buildSourceClaimReviewRequest(request, candidate, windows);
  const good = result(sourceClaimVerdictFixture(body));
  const input = JSON.parse(body.message);
  for (const mutate of [
    (value: typeof input) => {value.windows[0].lines[0].text += " Altered bytes";},
    (value: typeof input) => {value.windows[0].lines[0].line += 1;},
    (value: typeof input) => {value.windows[0].lines.pop();},
    (value: typeof input) => {value.windows[0].endLine += 1;},
    (value: typeof input) => {value.windows[0].content = windows[0].content;},
    (value: typeof input) => {value.windows[0].path = "foreign.opaque";},
    (value: typeof input) => {value.identity.branch = "foreign";},
    (value: typeof input) => {value.facts[0] = {id: "fact-1", kind: "provenance", scope: "foreign", value: "new proof"};}
  ]) {
    const changed = structuredClone(input); mutate(changed);
    assert.throws(() => parseSourceClaimVerdict(good, candidate, {...body, message: JSON.stringify(changed)}), /invalid review/);
  }
});


test("a failed sole repair can retain independently supported whole contexts only after exact final review", async () => {
  for (const action of ["blast_radius", "knowledge_gaps"] as const) {
    const calls: StreamChatParams[] = [], visible: string[] = [];
    const candidate = answer(unsupported + "\n\n" + supported);
    const stream: SecureApiClient["streamChat"] = async body => {
      calls.push(body);
      if (!body.sourceClaimReview) return result(candidate);
      return result(sourceClaimVerdictFixture(body, body.message.includes(unsupported)
        ? [{claim: unsupported, category: "conditions", reason: "Conditional source does not establish universal execution."}] : []));
    };
    const run = action === "blast_radius"
      ? streamSourceGroundedBlast({stream, request: {...request, useCase: action}, onChunk: text => visible.push(text), baseUrl: "https://fixture.invalid",
        evidence: {directDependents: [windows[0].path], sourceFiles: windows.map(window => ({...window, endLine: window.startLine + window.content.split("\n").length - 1, truncated: false, role: "dependent" as const, repoId: "github:tenant/arbitrary", branch: "release"}))}})
      : streamSourceReviewedKnowledgeGaps({stream, request: {...request, useCase: action}, onChunk: text => visible.push(text), baseUrl: "https://fixture.invalid", evidence: {focusFiles: windows}});
    const final = await run;
    assert.equal(calls.filter(call => !call.sourceClaimReview).length, 2, "Only one model corrective replacement");
    assert.equal(calls.filter(call => call.sourceClaimReview).length, 3);
    assert.equal(JSON.parse(calls[3].message).reviewCoverage, "complete");
    assert.equal(JSON.parse(calls[4].message).reviewCoverage, "complete", "First reduced answer is fully reviewed to retain late counterexamples");
    assert.equal(visible.length, 1); assert.equal(visible[0], final.message.content);
    assert(visible[0].includes(supported)); assert(!visible[0].includes(unsupported)); assert(visible[0].includes(quote));
    assert.equal(JSON.parse(calls[4].message).candidateId, (await import("node:crypto")).createHash("sha256").update(visible[0]).digest("hex"));
  }
});

test("a rejected sentence removes its entire local context including otherwise supported neighbors", async () => {
  const kept = "The shown source contains a conditional execute call.";
  const candidate = answer(unsupported + " " + supported + "\n\n" + kept);
  const visible: string[] = [];
  const stream: SecureApiClient["streamChat"] = async body => result(body.sourceClaimReview
    ? sourceClaimVerdictFixture(body, body.message.includes(unsupported)
      ? [{claim: unsupported, category: "conditions", reason: "Universal claim is not supported."}] : []) : candidate);
  const final = await streamSourceReviewedKnowledgeGaps({stream, request: {...request, useCase: "knowledge_gaps"}, onChunk: text => visible.push(text), baseUrl: "https://fixture.invalid", evidence: {focusFiles: windows}});
  assert.equal(visible.length, 1); assert(final.message.content.includes(kept));
  assert(!final.message.content.includes(unsupported)); assert(!final.message.content.includes(supported));
});

test("partial publication refuses deferred units, rejected final review and Stop without another generation", async () => {
  for (const mode of ["deferred", "final-reject", "stop"] as const) {
    let calls = 0; const visible: string[] = [], controller = new AbortController();
    const stream: SecureApiClient["streamChat"] = async body => {
      calls++;
      if (!body.sourceClaimReview) return result(answer(unsupported + "\n\n" + supported));
      const raw = JSON.parse(sourceClaimVerdictFixture(body, body.message.includes(unsupported)
        ? [{claim: unsupported, category: "conditions", reason: "Universal claim unsupported."}] : mode === "final-reject"
          ? [{claim: supported, category: "scope", reason: "Deliberate final review rejection."}] : []));
      const input = JSON.parse(body.message);
      if (input.reviewCoverage === "complete") for (const check of raw.checks) {
        const block = input.blocks.find((block: {id: string}) => block.id === check.blockId);
        if (![supported,unsupported].includes(block.text)) check.kind = block.text.endsWith("?") ? "question" : "scope";
      }
      if (calls === 4 && mode === "deferred") {
        Object.assign(raw.checks[1], {kind: "unreviewed", decision: "deferred", supports: [], qualificationStatus: "unreviewed", counterexampleStatus: "unreviewed", publicQualifications: []});
      }
      if (calls === 5 && mode === "stop") controller.abort();
      return result(JSON.stringify(raw));
    };
    await assert.rejects(streamSourceReviewedKnowledgeGaps({stream, request: {...request, useCase: "knowledge_gaps"}, signal: controller.signal, onChunk: text => visible.push(text), baseUrl: "https://fixture.invalid", evidence: {focusFiles: windows}}));
    assert.deepEqual(visible, []); assert.equal(calls, mode === "deferred" ? 4 : 5);
  }
});


test("reduction reuses existing quotes and refuses repeated-card budget overflow", () => {
  const context = {text: supported, references: [{path: windows[0].path, startLine: 1, endLine: 10000}]};
  const subset = supportedSourceCandidate({supported: false, issues: [], supportedContexts: [context]},quote)!;
  assert(subset.includes(quote)); assert.equal((subset.match(/```21:23:/g) ?? []).length,1);
  assert.equal(supportedSourceCandidate({supported: false, issues: [], supportedContexts: Array(17).fill(context)},quote),undefined);
});


test("a new counterexample in reduced-body review removes that whole context with a hard reduction bound", async () => {
  let calls=0; const visible:string[]=[];
  const later="The operation always succeeds.";
  const stream:SecureApiClient["streamChat"]=async body=>{
    calls++;
    if(!body.sourceClaimReview)return result(answer(unsupported+"\n\n"+later+"\n\n"+supported));
    const bad=body.message.includes(later)&&!body.message.includes(unsupported)?later:unsupported;
    return result(sourceClaimVerdictFixture(body,body.message.includes(bad)?[{claim:bad,category:"conditions",reason:"An earlier call can prevent execution."}]:[]));
  };
  const final=await streamSourceReviewedKnowledgeGaps({stream,request:{...request,useCase:"knowledge_gaps"},evidence:{focusFiles:windows},baseUrl:"https://fixture.invalid",onChunk:x=>visible.push(x)});
  assert.equal(calls,6);assert.equal(visible.length,1);assert.equal(visible[0],final.message.content);
  assert(final.message.content.includes(supported));assert(!final.message.content.includes(unsupported));assert(!final.message.content.includes(later));
});


test("shared source reduction can reuse one exact original card across supported local contexts without clipping",()=>{
 const context={text:supported,references:[{path:windows[0].path,startLine:1,endLine:10000}]};
 const candidate=supportedSourceCandidate({supported:false,issues:[],supportedContexts:Array(17).fill(context)},quote,{deduplicateCitations:true})!;
 assert(candidate);assert.equal((candidate.match(/```21:23:/g)??[]).length,1);assert.equal((candidate.match(/When reached/g)??[]).length,17);
 assert(candidate.includes(quote));
});


test("shared flow collects every initial failure before its single corrective generation", async () => {
  const {streamSourceReviewedEvidence} = await import("./sourceBackedActionReview");
  const second = "Every downstream write succeeds.";
  let repairs = 0, initialReviews = 0;
  const visible: string[] = [];
  const stream: SecureApiClient["streamChat"] = async body => {
    if (body.sourceEvidenceRepair) {
      repairs++;
      assert(body.message.includes(unsupported)); assert(body.message.includes(second));
      return result(answer(supported));
    }
    if (!body.sourceClaimReview) return result(answer(unsupported + "\n\n" + second));
    const input = JSON.parse(body.message);
    if (body.message.includes(unsupported)) {
      initialReviews++; assert.equal(input.reviewCoverage, "complete");
    }
    return result(sourceClaimVerdictFixture(body, [unsupported, second].filter(claim => body.message.includes(claim))
      .map(claim => ({claim, category: "conditions" as const, reason: "Earlier failures may prevent execution."}))));
  };
  await streamSourceReviewedEvidence({stream, request, windows, facts: [], baseUrl: "https://fixture.invalid", onChunk: x => visible.push(x)});
  assert.equal(repairs, 1); assert.equal(initialReviews, 1); assert.equal(visible.length, 1);
  assert(visible[0].includes(supported)); assert(!visible[0].includes(unsupported)); assert(!visible[0].includes(second));
});

test("shared reduction prefers original cards covering the reviewed operations over a closing-brace fragment", () => {
  const closing = "```23:23:arbitrary/nested/source.opaque\n}\n```";
  const reduced = supportedSourceCandidate({supported: false, issues: [], supportedContexts: [{text: supported,
    references: [{path: windows[0].path, startLine: 21, endLine: 23}]}]}, closing + "\n\n" + quote, {deduplicateCitations: true});
  assert(reduced?.includes(quote)); assert(!reduced?.includes(closing));
});


test("qualifiers may omit inline-code formatting but never words, operators or owned-context boundaries", () => {
  const candidate = "When `enabled` is true and `authorized` is true, the body contains the call.";
  const body = buildSourceClaimReviewRequest(request, candidate, windows);
  const good = JSON.parse(sourceClaimVerdictFixture(body));
  Object.assign(good.checks[0], {qualificationStatus: "present", counterexampleStatus: "excluded-by-candidate",
    publicQualifications: ["When enabled is true and authorized is true"]});
  assert.equal(parseSourceClaimVerdict(result(JSON.stringify(good)), candidate, body).supported, true);
  for (const wrong of ["When enabled is true or authorized is true", "When enabled and authorized are true", "When enabled is false", "A qualification from another paragraph"]) {
    good.checks[0].publicQualifications = [wrong];
    assert.throws(() => parseSourceClaimVerdict(result(JSON.stringify(good)), candidate, body), /invalid review/);
  }
});


test("repeated literal qualifiers for repeated conditions do not invalidate a complete semantic review", () => {
  const candidate = "The first call is conditional when present, and the second call is conditional when present.";
  const body = buildSourceClaimReviewRequest(request, candidate, windows);
  const data = JSON.parse(sourceClaimVerdictFixture(body));
  Object.assign(data.checks[0], {qualificationStatus: "present", counterexampleStatus: "excluded-by-candidate",
    publicQualifications: ["when present", "when present"]});
  assert.equal(parseSourceClaimVerdict(result(JSON.stringify(data)), candidate, body).supported, true);
  data.checks[0].qualificationStatus = "missing";
  assert.equal(parseSourceClaimVerdict(result(JSON.stringify(data)), candidate, body).supported, false);
});
