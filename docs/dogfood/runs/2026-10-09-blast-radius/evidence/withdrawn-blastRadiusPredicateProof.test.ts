import assert from "node:assert/strict";
import test from "node:test";
import { renderBlastPredicateProof } from "./blastRadiusPredicateProof";
import { streamSourceReviewedBlast } from "../chat/blastRadiusSourceReview";
import type { BlastRadiusSourceFile } from "../context/blastRadiusSourceEvidence";
import type { BlastRadiusEvidence } from "../context/contextBundleEvidence";
import type { SecureApiClient } from "../chat/SecureApiClient";

const source = (path: string, content: string, role: BlastRadiusSourceFile["role"]): BlastRadiusSourceFile => ({
  path, content, role, repoId: "github:org/fixture", branch: "release", startLine: 1,
  endLine: content.split("\n").length, truncated: false
});
const target = source("lib/send.ts", [
  "import { validate } from './auth';",
  "export async function send(record, value) {",
  "  if (!record.ready) { throw Error('not ready'); }",
  "  validate(record);",
  "  const writable = record.kind === 'text' || record.kind === 'image';",
  "  if (record.locked && !writable) { throw Error('locked'); }",
  "  return database.transaction(async (tx) => {",
  "    if (writable && value) { await tx.record.upsert({ create: {value}, update: {value} }); }",
  "    await tx.audit.create({ record });",
  "  });",
  "}"
].join("\n"), "target");
const caller = source("api/caller.ts", [
  "import { send as submit } from '../lib/send';",
  "export async function route(record) {",
  "  if (!record.opened || record.rejected) return;",
  "  const fields = await query({ type: 'text', inserted: false });",
  "  return Promise.all(fields.map(field => submit(record, field.value)));",
  "}"
].join("\n"), "dependent");
const evidence: BlastRadiusEvidence = { directDependents: [caller.path], sourceFiles: [target, caller] };
const draft = "Any API caller can always overwrite COMPLETED records.\n```3:3:lib/send.ts\n  if (!record.ready) { throw Error('not ready'); }\n```";

test("source syntax replaces unsupported prose and preserves full predicates, callers and conditional create/update", () => {
  const proof = renderBlastPredicateProof(draft, evidence)!;
  assert.ok(proof);
  assert.doesNotMatch(proof, /COMPLETED|always overwrite|Any API caller/);
  assert.match(proof, /record\.locked && !writable/);
  assert.match(proof, /record\.kind === 'text' \|\| record\.kind === 'image'/);
  assert.match(proof, /!record\.opened \|\| record\.rejected/);
  assert.match(proof, /type: 'text', inserted: false/);
  assert.match(proof, /if \(writable && value\).*upsert\(\{ create: \{value\}, update: \{value\} \}\)/);
  assert.match(proof, /validate\(record\)/);
  assert.match(proof, /do not prove stored-data invariants/);
  for (const citation of proof.matchAll(/```(\d+):(\d+):([^\n]+)\n([\s\S]*?)\n```/g)) {
    const file = evidence.sourceFiles!.find(file => file.path === citation[3])!;
    assert.equal(citation[4], file.content.split("\n").slice(Number(citation[1]) - 1, Number(citation[2])).join("\n"));
  }
});

test("comments, type imports, shadowed identifiers and imports of a different module do not prove callers", () => {
  for (const content of [
    "// send(record)\nconst text = 'send(record)';",
    "import type {send} from '../lib/send';\nfunction caller() { send(record); }",
    "import {send} from '../lib/other';\nfunction caller() { send(record); }",
    "import {send} from '../lib/send';\nfunction caller(send) { send(record); }",
    "import {send} from '../lib/send';\nfunction caller({send}) { send(record); }",
    "import {send} from '../lib/send';\nfunction caller() { const [send] = values; send(record); }"
  ]) assert.equal(renderBlastPredicateProof(draft, { ...evidence, sourceFiles: [target, { ...caller, content }] }), undefined);
});

test("write enclosure retains outer predicates across callbacks and nested reject conjunctions", () => {
  const nested = { ...target, content: target.content.replace("if (record.locked && !writable) { throw Error('locked'); }", "if (record.locked && !writable) { if (record.invalid) throw Error('locked'); }")
    .replace("return database.transaction", "if (record.persist) return database.transaction") };
  const proof = renderBlastPredicateProof(draft, { ...evidence, sourceFiles: [nested, caller] })!;
  assert.match(proof, /record\.locked && !writable[^\n]+AND[^\n]+record\.invalid/);
  assert.match(proof, /tx\.record\.upsert[^\n]+record\.persist[^\n]+AND[^\n]+writable && value/);
});

test("invalid, truncated and unanchored source cannot become a predicate proof", () => {
  assert.equal(renderBlastPredicateProof("No source citation", evidence), undefined);
  assert.equal(renderBlastPredicateProof(draft, { ...evidence, sourceFiles: [{ ...target, truncated: true }, caller] }), undefined);
  assert.equal(renderBlastPredicateProof(draft, { ...evidence, sourceFiles: [{ ...target, content: "export function send( {" }, caller] }), undefined);
});

test("the frozen selection determines the predicate even when the model returns an incomplete or wrong anchor", () => {
  const proof = renderBlastPredicateProof("```6:6:lib/send.ts\nwrong focus", evidence, [3, 3])!;
  assert.ok(proof);
  assert.match(proof, /Changed predicate:\n\n```3:3:lib\/send.ts/);
  assert.equal(renderBlastPredicateProof("", evidence, [3, 3], "Change OTHER_STATUS"), renderBlastPredicateProof("", evidence, [3, 3]));
});

test("an explicit unique enum value in the original ask supplies a missing whole-file model citation", () => {
  const statusTarget = { ...target, content: target.content.replace("!record.ready", "record.status !== DeliveryStatus.PENDING") };
  const proof = renderBlastPredicateProof("No predicate citation", { ...evidence, sourceFiles: [statusTarget, caller] }, undefined,
    "If this handler allowed delivery when the record is not PENDING, which callers could be affected?")!;
  assert.ok(proof); assert.match(proof, /Changed predicate:\n\n```3:3:lib\/send.ts/);
  assert.equal(renderBlastPredicateProof("No citation", { ...evidence, sourceFiles: [statusTarget, caller] }, undefined, "Change COMPLETED"), undefined);
});

test("a private length-stopped draft can yield a complete source-derived answer without generic continuation", async () => {
  let calls = 0, proofEvents = 0; const visible: string[] = [];
  const stream: SecureApiClient["streamChat"] = async (_request, chunk) => {
    calls++; chunk(draft);
    return { message: { role: "assistant", content: draft, timestamp: 1 }, finishReason: "length" };
  };
  const result = await streamSourceReviewedBlast({ stream, evidence, request: {
    message: "Relax this guard", useCase: "blast_radius", model: "claude-sonnet-4-6", provider: "anthropic", history: []
  }, onChunk: text => visible.push(text), onSourceProof: () => proofEvents++, baseUrl: "https://api.example.test" });
  assert.equal(calls, 1); assert.equal(proofEvents, 1); assert.equal(visible.length, 1);
  assert.equal(result.finishReason, "stop"); assert.equal(result.message.content, visible[0]);
  assert.doesNotMatch(visible[0]!, /COMPLETED|always overwrite/);
});

test("an explicit source predicate publishes the same complete proof without requesting or charging for a model draft", async () => {
  const statusTarget = { ...target, content: target.content.replace("!record.ready", "record.status !== DeliveryStatus.PENDING") };
  const opened = { ...evidence, sourceFiles: [statusTarget, caller] };
  for (const focus of [{ focusLines: [3, 3] as [number, number] }, { question: "Allow delivery when the record is not PENDING" }]) {
    const visible: string[] = [], phases: string[] = [];
    const stream: SecureApiClient["streamChat"] = async () => { throw new Error("An unused model draft was requested"); };
    const result = await streamSourceReviewedBlast({ stream, evidence: opened, request: {
      message: "Opened source", useCase: "blast_radius", model: "claude-sonnet-4-6", provider: "anthropic", history: []
    }, ...focus, onChunk: text => visible.push(text), onSourceProof: phase => phases.push(phase), baseUrl: "https://api.example.test" });
    assert.deepEqual(phases, ["before-model"]);
    assert.deepEqual(visible, [renderBlastPredicateProof("", opened, focus.focusLines, focus.question)]);
    assert.equal(result.message.content, visible[0]); assert.equal(result.finishReason, "stop");
    assert.equal(result.usage, undefined, "A source-only answer must not invent model usage or cost");
  }
});

test("Stop prevents direct source publication, and an ambiguous focus still uses private model review", async () => {
  const controller = new AbortController(); controller.abort(); let published = false;
  const stream: SecureApiClient["streamChat"] = async () => { throw new Error("No request after Stop"); };
  const sourceRequest = { message: "Relax this guard", useCase: "blast_radius" as const, model: "claude-sonnet-4-6", provider: "anthropic" as const, history: [] };
  await assert.rejects(streamSourceReviewedBlast({ stream, evidence, request: sourceRequest, focusLines: [3, 3],
    signal: controller.signal, onChunk: () => { published = true; }, baseUrl: "https://api.example.test" }), { name: "AbortError" });
  assert.equal(published, false);
  const ambiguous = { ...target, content: target.content.replace("!record.ready", "record.status !== DeliveryStatus.PENDING")
    .replace("validate(record);", "if (record.otherStatus === DeliveryStatus.PENDING) validate(record);") };
  let calls = 0; const phases: string[] = [];
  const reviewed: SecureApiClient["streamChat"] = async () => {
    calls++; return { message: { role: "assistant", content: "No predicate could be verified.", timestamp: 1 }, finishReason: "stop" };
  };
  await streamSourceReviewedBlast({ stream: reviewed, evidence: { ...evidence, sourceFiles: [ambiguous, caller] },
    request: sourceRequest, question: "Relax PENDING", onChunk: () => undefined, onSourceProof: phase => phases.push(phase),
    baseUrl: "https://api.example.test" });
  assert.equal(calls, 2); assert.deepEqual(phases, []);
});
