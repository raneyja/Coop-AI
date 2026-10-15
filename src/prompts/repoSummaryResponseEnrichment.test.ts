import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { enrichUnderstandRepoResponse } from "./repoSummaryResponseEnrichment";
import { splitMarkdownBlocks } from "./markdownProse";
import { verifySourceCitationQuotes, type ReviewedSourceWindow } from "./sourceCitationIntegrity";
import { renderSourceEvidenceReferences, MAX_RENDERED_SOURCE_BYTES, MAX_RENDERED_SOURCE_REFERENCES } from "./sourceEvidenceReferences";
import { enrichChatResponseForAction } from "../chat/chatResponseEnrichment";
import { streamSourceReviewedEvidence } from "../chat/sourceBackedActionReview";
import { sourceClaimVerdictFixture } from "../chat/sourceClaimReviewTestFixture";
import { parseSlashCommand } from "../context/slashCommands";
import type { StreamChatParams, SecureApiClient } from "../chat/SecureApiClient";
import type { RepoSummaryEvidence } from "../context/contextBundleEvidence";

const focus = "Explain backend authentication, input validation and persistence";
const request: StreamChatParams = { message: focus, context: { owner: "fixture", repo: "service", branch: "release" },
  model: "claude-sonnet-4-6", provider: "anthropic", useCase: "comprehension", maxTokens: 16000,
  enableThinking: true, quotaTurnId: "same-fixture-turn" };
const card = (source: string, start = 10, fence = "```", path = "src/operation.ts", close = fence) =>
  `${fence}${start}:${start + source.split("\n").length - 1}:${path}\n${source}\n${close}\n`;
const blocks = (content: string) => splitMarkdownBlocks(content).filter(block => block.kind === "code");
const summary = (files: ReviewedSourceWindow[]): RepoSummaryEvidence => ({ userFocus: focus, entryFiles: files });
const prepare = (files: ReviewedSourceWindow[], content: string) => enrichChatResponseForAction({ content,
  quickAction: "understand-repo", owner: "fixture", repo: "service", userQuestion: focus,
  contextBundle: [{ type: "repo-summary", data: summary(files) }] });

for (const length of [3,4,5,6,8]) {
  test(`${length}-tick admitted card remains exact through focused helper and actual action preparation`, () => {
    const fence = "`".repeat(length);
    const source = length === 3 ? "const first = 1;\nconst second = 2;"
      : `\nconst first = 1;\n${"`".repeat(length - 1)}\n\n\nconst second = 2;  \n${"`".repeat(length - 1)}\n`;
    const files = [{ path: "src/operation.ts", content: source, startLine: 10 }];
    const quote = card(source,10,fence), content = "Before\n\n\n" + quote + "\n\n\nAfter";
    assert.equal(verifySourceCitationQuotes(content,files).verifiedQuotes,1);
    for (const result of [enrichUnderstandRepoResponse(content,summary(files)),prepare(files,content)]) {
      assert.equal(blocks(result).length,1); assert.equal(blocks(result)[0].text,quote);
      assert.equal(blocks(result)[0].closed,true);
      const checked = verifySourceCitationQuotes(result,files);
      assert.equal(checked.verifiedQuotes,1); assert.equal(checked.invalidQuotes,0);
      assert.match(result,/Before\n\n/); assert.ok(result.endsWith("After"));
    }
  });
}
test("valid card retains original info, longer closing delimiter, trailing separator and source whitespace", () => {
  const source = "\nconst first = 1;  \n\n\nconst last = 2;\n";
  const files = [{ path: "src/operation.ts", content: source, startLine: 10 }];
  const quote = card(source,10,"````",undefined,"``````  ").replace("````10:","````typescript 10:");
  assert.equal(verifySourceCitationQuotes(quote,files).verifiedQuotes,1);
  assert.equal(enrichUnderstandRepoResponse(quote,summary(files)),quote);
});
test("renderer split cards and repeated identical source lines retain count/ranges/bytes without reselection", () => {
  const source = Array.from({ length: 43 },(_,index) => index % 4 === 0 ? "" : "same();").join("\n");
  const files = [{ path: "src/repeated.ts", content: source, startLine: 50 }];
  const rendered = renderSourceEvidenceReferences("Shown code.\n\n[[source:window-1:50:92]]\n",files);
  assert.equal(rendered.invalidReferences,0);assert.equal(blocks(rendered.content).length,3);
  const checked = verifySourceCitationQuotes(rendered.content,files);assert.equal(checked.verifiedQuotes,3);
  const after = enrichUnderstandRepoResponse(checked.content,summary(files));
  assert.deepEqual(blocks(after).map(block => block.text),blocks(checked.content).map(block => block.text));
  assert.equal(verifySourceCitationQuotes(after,files).verifiedQuotes,3);
  const duplicate = card("same();",51,"```","src/repeated.ts");
  assert.equal(enrichUnderstandRepoResponse(duplicate,summary(files)),duplicate,"valid claimed span disambiguates identical lines");
  assert.equal(verifySourceCitationQuotes(card("same();",999,"```","src/repeated.ts"),files).invalidQuotes,1);
});
test("already verified numeric cards are never split again after source admission", () => {
  const source = Array.from({ length: 41 },(_,index) => `line${index}();`).join("\n");
  const files = [{ path: "src/operation.ts",content: source,startLine: 10 }],quote = card(source);
  assert.equal(verifySourceCitationQuotes(quote,files).verifiedQuotes,1);
  assert.equal(enrichUnderstandRepoResponse(quote,summary(files)),quote);
  assert.equal(blocks(enrichUnderstandRepoResponse(quote,summary(files))).length,1);
});
test("legacy path grounding remains contained and emits a sufficient generic fence", () => {
  const source = "start();\n```\n\nend();",files = [{ path: "src/operation.ts", content: source, startLine: 25 }];
  const legacy = "Before\n\n````src/operation.ts\n" + source + "\n````\nAfter";
  const after = enrichUnderstandRepoResponse(legacy,summary(files));
  assert.equal(blocks(after).length,1);assert.equal(blocks(after)[0].closed,true);
  assert.equal(blocks(after)[0].kind === "code" && blocks(after)[0].fence,"````");
  const checked = verifySourceCitationQuotes(after,files);assert.equal(checked.verifiedQuotes,1);assert.equal(checked.invalidQuotes,0);
  assert.match(after,/25:28:src\/operation.ts/);
});
test("malformed or unclosed blocks are never manufactured into a trusted quote", () => {
  const files = [{ path: "src/operation.ts", content: "same();\nsame();", startLine: 10 }];
  for (const bad of ["```0:1:src/operation.ts\nsame();\n```", "```20:19:src/operation.ts\nsame();\n```",
    "````10:10:src/operation.ts\nsame();\n```", "```10:10:../foreign.ts\nsame();\n```"]) {
    const after = enrichUnderstandRepoResponse(bad,summary(files));
    assert.equal(verifySourceCitationQuotes(after,files).verifiedQuotes,0);
  }
});
test("unfocused and unavailable focus keep their established paths", () => {
  const quote = card("same();");
  assert.equal(enrichUnderstandRepoResponse(quote,{ entryFiles: [{ path: "src/operation.ts",content: "same();",startLine: 10 }] }),quote);
  assert.match(enrichUnderstandRepoResponse(quote,{ userFocus: focus,entryFiles: [] }),/No source bodies were attached/);
});
test("slash canonical/alias and grid actions use the same direct-data preparation owner", () => {
  const source = "call();\n```\n\n\nreturn value;",files = [{ path: "src/operation.ts",content: source,startLine: 10 }],quote = card(source,10,"````");
  for (const input of ["/understand " + focus,"/understandrepo " + focus]) {
    const parsed = parseSlashCommand(input);assert.equal(parsed?.def.target.kind,"action");
    assert.equal(parsed?.def.target.kind === "action" && parsed.def.target.actionId,"understand-repo");
    assert.deepEqual(blocks(prepare(files,quote)).map(block=>block.text),[quote]);
  }
});

async function runOwner(files: ReviewedSourceWindow[], generated: string, mode: "supported" | "rejected" | "stop" = "supported") {
  const visible: string[] = [],seen: StreamChatParams[] = [],controller = new AbortController();
  let reviewed: string | undefined;
  const stream: SecureApiClient["streamChat"] = async body => {
    seen.push(body);
    if (body.sourceClaimReview) {
      reviewed = JSON.parse(body.message).candidateId;
      if (mode === "stop") controller.abort();
      return { message: { role: "assistant",timestamp: 0,content: mode === "rejected" ? "{}" : sourceClaimVerdictFixture(body) },finishReason: "stop" };
    }
    return { message: { role: "assistant",timestamp: 0,content: generated },finishReason: "stop" };
  };
  const promise = streamSourceReviewedEvidence({ stream,request,windows: files,facts: [],question: focus,
    prepareAnswer: content => prepare(files,content),signal: controller.signal,onChunk: content => visible.push(content),baseUrl: "https://fixture.invalid" });
  return { promise,visible,seen,get reviewed() { return reviewed; } };
}
test("actual owner refuses invalid paths/ranges/source/fences and never reaches semantic/publication", async () => {
  const files = [{ path: "src/operation.ts",content: "same();\nsame();",startLine: 10 }];
  for (const bad of [card("same();",10,"```","src/foreign.ts"),card("same();",999),card("changed();",10),
    "````10:10:src/operation.ts\nsame();\n```", "```0:1:src/operation.ts\nsame();\n```", "[[source:window-1:10:99]]"]) {
    const run = await runOwner(files,bad);
    await assert.rejects(run.promise,/reviewed evidence/);assert.deepEqual(run.visible,[]);
    assert.equal(run.seen.length,2);assert.ok(run.seen.every(body => !body.sourceClaimReview));
  }
});
test("existing source-card and byte budgets still refuse atomically with positive counterparts", async () => {
  const files = [{ path: "src/operation.ts",content: "same();",startLine: 10 }];
  const marker = "[[source:window-1:10:10]]";
  for (const count of [MAX_RENDERED_SOURCE_REFERENCES,MAX_RENDERED_SOURCE_REFERENCES + 1]) {
    const run = await runOwner(files,Array(count).fill(marker).join("\n"));
    if (count === MAX_RENDERED_SOURCE_REFERENCES) { const final = await run.promise;assert.equal(verifySourceCitationQuotes(final.message.content,files).verifiedQuotes,count); }
    else { await assert.rejects(run.promise,/reviewed evidence/);assert.deepEqual(run.visible,[]);assert.equal(run.seen.length,2); }
  }
  for (const size of [MAX_RENDERED_SOURCE_BYTES,MAX_RENDERED_SOURCE_BYTES + 1]) {
    const window = [{ path: "src/operation.ts",content: "x".repeat(size),startLine: 10 }],run = await runOwner(window,marker);
    if (size === MAX_RENDERED_SOURCE_BYTES) { await run.promise;assert.equal(run.visible.length,1); }
    else { await assert.rejects(run.promise,/reviewed evidence/);assert.deepEqual(run.visible,[]);assert.equal(run.seen.length,2); }
  }
});
test("mechanical success still requires semantic/native Stop guards and publishes only the reviewed final body", async () => {
  const source = "call();\n```\n\n\nreturn value;",files = [{ path: "src/operation.ts",content: source,startLine: 10 }];
  for (const mode of ["supported","rejected","stop"] as const) {
    const run = await runOwner(files,"Scoped shown call.\n\n[[source:window-1:10:14]]",mode);
    if (mode === "supported") {
      const final = await run.promise;assert.deepEqual(run.visible,[final.message.content]);
      assert.equal(run.seen.length,2);assert.equal(run.reviewed,createHash("sha256").update(final.message.content).digest("hex"));assert.equal(blocks(final.message.content)[0].closed,true);
    } else { await assert.rejects(run.promise);assert.deepEqual(run.visible,[]);assert.equal(run.seen.length,2); }
    for (const body of run.seen) assert.equal(body.quotaTurnId,request.quotaTurnId);
  }
});
