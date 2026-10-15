import assert from "node:assert/strict";
import test from "node:test";
import { streamSourceGroundedBlast } from "./blastRadiusSourceReview";
import type { SecureApiClient, StreamChatParams } from "./SecureApiClient";
import { sourceClaimVerdictFixture } from "./sourceClaimReviewTestFixture";
import type { BlastRadiusEvidence } from "../context/contextBundleEvidence";

// These transport/control regressions do not certify model judgment. They prove
// that negative review cannot leak an answer, regardless of source language.
const fixtures = [
  { path: "modules/task.ts", source: "try { await work(); } catch (error) { if (known(error)) throw error; throw convert(error); }" },
  { path: "task.py", source: "try:\n    work()\nexcept KnownError:\n    raise\nexcept Exception as error:\n    raise convert(error)" },
  { path: "crates/task/src/lib.rs", source: "match work().await { Ok(v) => Ok(v), Err(Error::Known(e)) => Err(e), Err(e) => Err(convert(e)) }" },
  { path: "internal/task/work.go", source: "value, err := work()\nif errors.Is(err, known) { return value, err }\nreturn value, convert(err)" }
];

const request: StreamChatParams = {
  message: "Explain confirmed dependencies, possible impact and unknowns.",
  context: { owner: "org", repo: "arbitrary", branch: "review" },
  model: "claude-sonnet-4-6", provider: "anthropic", useCase: "blast_radius",
  maxTokens: 16000, enableThinking: true, quotaTurnId: "original-turn"
};
const response = (content: string) => ({ message: { role: "assistant" as const, content, timestamp: 1 }, finishReason: "stop" as const });

for (const fixture of fixtures) {
  test(`${fixture.path}: unsupported behavioral prose stays private until a reviewed replacement`, async () => {
    const quote = "```1:" + fixture.source.split("\n").length + ":" + fixture.path + "\n" + fixture.source + "\n```";
    const claim = "Every error is converted, so all dependents will silently break.";
    const invalid = claim + "\n\n" + quote;
    const valid = "**Direct impact**\n\n`consumer` is a dependency relation. The shown branches preserve known failures and translate other failures; effects on callers depend on the actual change.\n\n" + quote;
    const evidence: BlastRadiusEvidence = { directDependents: ["consumer"], sourceFiles: [{
      role: "target", path: fixture.path, content: fixture.source, repoId: "github:org/arbitrary", branch: "review",
      startLine: 1, endLine: fixture.source.split("\n").length, truncated: false
    }] };
    const calls: StreamChatParams[] = [], visible: string[] = [];
    let syntheses = 0;
    const stream: SecureApiClient["streamChat"] = async (body, onChunk) => {
      calls.push(body);
      assert.deepEqual(visible, []);
      if (body.sourceClaimReview) {
        const input = JSON.parse(body.message);
        assert.equal(input.windows[0].path, fixture.path);
        assert.equal(input.windows[0].lines.map((line: {text: string}) => line.text).join("\n"), fixture.source);
        assert.equal(input.candidate, undefined);
        const supported = !input.blocks.some((block: {text: string}) => block.text.includes(claim));
        return response(sourceClaimVerdictFixture(body, supported ? [] : [{claim, category: "conditions",
          reason: "The exception branch preserves a failure; caller handling and a proposed breaking change are not attached."}]));
      }
      const content = ++syntheses === 1 ? invalid : valid;
      onChunk(content);
      return response(content);
    };
    const final = await streamSourceGroundedBlast({ stream, request, evidence,
      onChunk: chunk => visible.push(chunk), baseUrl: "https://api.example.test" });
    assert.equal(calls.length, 4);
    assert.deepEqual(calls.map(call => Boolean(call.sourceClaimReview)), [false, true, false, true]);
    assert.match(calls[2].message, /unsupported-claims/);
    assert.ok(calls[2].message.includes(claim));
    assert.deepEqual(visible, [valid]);
    assert.equal(final.message.content, valid);
    assert.equal(final.usage, undefined);
  });
}

test("a repeatedly unsupported explanation exhausts one replacement and publishes nothing", async () => {
  const fixture = fixtures[0];
  const quote = "```1:1:" + fixture.path + "\n" + fixture.source + "\n```";
  const claim = "Every error is converted.";
  const content = claim + "\n\n" + quote;
  const evidence: BlastRadiusEvidence = { directDependents: ["consumer"], sourceFiles: [{ role: "target",
    path: fixture.path, content: fixture.source, repoId: "github:org/arbitrary", branch: "review",
    startLine: 1, endLine: 1, truncated: false }] };
  let calls = 0;
  const stream: SecureApiClient["streamChat"] = async body => {
    calls++;
    if (!body.sourceClaimReview) return response(content);
    return response(sourceClaimVerdictFixture(body, [{claim, category: "conditions",
      reason: "The known-failure branch rethrows instead."}]));
  };
  await assert.rejects(streamSourceGroundedBlast({ stream, request, evidence, baseUrl: "https://api.example.test",
    onChunk: () => assert.fail("unverified explanation became visible") }), /could not verify the answer's explanation/);
  assert.equal(calls, 4);
});
