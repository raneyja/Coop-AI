import assert from "node:assert/strict";
import test from "node:test";
import { renderSourceEvidenceReferences as render } from "./sourceEvidenceReferences";
import { verifySourceCitationQuotes } from "./sourceCitationIntegrity";
import { snapshotSourceClaimEvidence } from "../chat/sourceClaimReview";
import type { StreamChatParams } from "../chat/SecureApiClient";

test("source references render exact Unicode and CRLF bytes at original coordinates", () => {
  const windows = [{ path: "nested/λ.opaque", startLine: 41, content: "α = '🦆';\r\nβ();\r\nγ();" }];
  const output = render("Observation.\r\n\r\n[[source:window-1:41:42]]\r\n", windows);
  assert.equal(output.invalidReferences, 0);
  assert.equal(output.content, "Observation.\r\n\r\n```41:42:nested/λ.opaque\nα = '🦆';\r\nβ();\r\n```\r\n");
  assert.equal(verifySourceCitationQuotes(output.content, windows).verifiedQuotes, 1);
});

test("IDs match evidence admission with disjoint starts and duplicate paths", () => {
  const windows = [
    { path: "skipped", startLine: 1, content: "" },
    { path: "skipped", startLine: 0, content: "invalid" },
    { path: "same/path.txt", startLine: 5, content: "first\nsecond" },
    { path: "same/path.txt", startLine: 25, content: "other\nlast" }
  ];
  const request = { context: { owner: "tenant", repo: "arbitrary", branch: "ref" } } as StreamChatParams;
  const snapshot = snapshotSourceClaimEvidence(request, windows);
  assert.deepEqual(snapshot.windows.map(window => [window.id, window.startLine]), [["window-1", 5], ["window-2", 25]]);
  const output = render("[[source:window-2:25:26]]\n\n[[source:window-1:6:6]]", windows);
  assert.equal(output.invalidReferences, 0);
  assert.ok(output.content.includes("```25:26:same/path.txt\nother\nlast\n```"));
  assert.ok(output.content.includes("```6:6:same/path.txt\nsecond\n```"));
});

test("admitted root-level extensionless paths are rendered without language heuristics", () => {
  const windows = [{ path: "customconfig", startLine: 7, content: "first\nsecond" }];
  const output = render("[[source:window-1:7:8]]", windows);
  assert.deepEqual(output, {
    content: "```7:8:customconfig\nfirst\nsecond\n```", invalidReferences: 0
  });
  assert.equal(verifySourceCitationQuotes(output.content, windows).verifiedQuotes, 1);
});

test("malformed, inline, foreign and out-of-range references fail without invented source", () => {
  const windows = [{ path: "source.unknown", startLine: 10, content: "first\nsecond" }];
  for (const marker of [
    "[[source:window-9:10:11]]", "[[source:window-1:9:10]]", "[[source:window-1:10:12]]",
    "[[source:window-1:11:10]]", "[[source:window-1:0:10]]", "[[source:window-1:-1:10]]",
    "[[source:window-1:10.5:11]]", "[[source:window-1:1e1:11]]", "[[source:window-1:9007199254740992:9007199254740992]]",
    "[[source:window-x:10:11]]", "[[source:window-1:10:11]", "[[source:window-1:10:11", "[[SOURCE:window-1:10:11]]",
    "prefix [[source:window-1:10:11]]", "[[source:window-1:10:11]] suffix", "`[[source:window-1:10:11]]`"
  ]) {
    const output = render(marker, windows);
    assert.equal(output.invalidReferences, 1, marker);
    assert.equal(output.content, marker);
  }
  assert.equal(render("[[source:window-1:10:11]] [[source:window-1:10:11]]", windows).invalidReferences, 2);
  assert.equal(render("[[source:window-1:1:1]]", [{ path: "x", startLine: 1, content: " " }]).invalidReferences, 1);
});

test("anonymous or unfinished fences keep markers opaque but cannot leak protocol", () => {
  for (const text of ["```text\n[[source:window-999:1:3]]\n```\n", "~~~\n[[source:malformed", "```\n[[source:window-1:1:1]]"]) {
    assert.deepEqual(render(text, []), { content: text, invalidReferences: 1 });
  }
  const numeric = "```21:21:source.opaque\n[[source:window-999:1:3]]\n```\n";
  assert.deepEqual(render(numeric, []), { content: numeric, invalidReferences: 0 });
  const legacy = "```\n21:21:source.opaque\n[[source:window-999:1:3]]\n```\n";
  assert.deepEqual(render(legacy, []), { content: legacy, invalidReferences: 0 });
  const unfinished = "```21:21:source.opaque\n[[source:window-999:1:3]]";
  assert.deepEqual(render(unfinished, []), { content: unfinished, invalidReferences: 1 });
});

test("quoted marker bytes are not rescanned and source backticks cannot close the fence", () => {
  const windows = [{ path: "any.syntax", startLine: 30, content: "before\n``````\n[[source:window-999:1:2]]\nafter" }];
  const output = render("[[source:window-1:30:33]]", windows);
  assert.equal(output.invalidReferences, 0);
  assert.equal(output.content, "```````30:33:any.syntax\nbefore\n``````\n[[source:window-999:1:2]]\nafter\n```````");
  assert.deepEqual(render(output.content, windows), output);
  assert.equal(verifySourceCitationQuotes(output.content, windows).verifiedQuotes, 1);
});

test("unsafe window coordinates and malformed paths cannot inject a fence", () => {
  for (const window of [
    { path: "x", startLine: Number.MAX_SAFE_INTEGER + 1, content: "body" },
    { path: "x\n```", startLine: 1, content: "body" },
    { path: "source\n", startLine: 1, content: "body" },
    { path: "../source.ts", startLine: 1, content: "body" },
    { path: "source\u0000", startLine: 1, content: "body" },
    { path: "", startLine: 1, content: "body" }
  ]) assert.equal(render("[[source:window-1:1:1]]", [window]).invalidReferences, 1);
});

test("valid long spans split into exact source cards without truncation", () => {
  const windows = [{ path: "source.opaque", startLine: 50, content: Array.from({ length: 21 }, (_, index) => `line${index}`).join("\n") }];
  assert.equal(render("[[source:window-1:50:69]]", windows).invalidReferences, 0);
  const marker = "[[source:window-1:50:70]]";
  const output = render(marker, windows);
  assert.equal(output.invalidReferences, 0);
  assert.ok(output.content.includes("```50:69:source.opaque\n" + windows[0].content.split("\n").slice(0, 20).join("\n") + "\n```"));
  assert.ok(output.content.endsWith("```70:70:source.opaque\nline20\n```"));
  assert.equal(verifySourceCitationQuotes(output.content, windows).verifiedQuotes, 2);
});

test("split cards share a collision-safe fence and blank-only cards may be omitted", () => {
  const windows = [{ path: "source.opaque", startLine: 1, content: [...Array.from({length: 20}, () => "body"), "``````"].join("\n") }];
  const output = render("[[source:window-1:1:21]]", windows);
  assert.equal(output.invalidReferences, 0);
  assert.equal((output.content.match(/^`{7}/gm) ?? []).length, 4);
  assert.equal(verifySourceCitationQuotes(output.content, windows).verifiedQuotes, 2);
  const blanks = [{ path: "opaque", startLine: 10, content: [...Array.from({length: 20}, () => ""), "body", "next"].join("\n") }];
  assert.deepEqual(render("[[source:window-1:10:31]]", blanks), {
    content: "```30:31:opaque\nbody\nnext\n```", invalidReferences: 0
  });
});

test("an oversized card expansion is rejected whole without partial rendering", () => {
  const windows = [{ path: "opaque", startLine: 1, content: Array.from({length: 321}, () => "x").join("\n") }];
  const marker = "[[source:window-1:1:321]]";
  assert.deepEqual(render(marker, windows), { content: marker, invalidReferences: 1 });
  const selected = "[[source:window-1:1:301]]";
  const output = render(`[[source:window-1:1:1]]\n\n${selected}`, windows);
  assert.equal(output.invalidReferences, 1);
  assert.equal((output.content.match(/```1:1:opaque/g) ?? []).length, 1);
  assert.ok(output.content.endsWith(selected));
});

test("repeated references count toward the sixteen rendered-reference limit", () => {
  const marker = "[[source:window-1:1:1]]";
  const windows = [{ path: "opaque", startLine: 1, content: "exact source" }];
  const output = render(Array.from({ length: 17 }, () => marker).join("\n\n"), windows);
  assert.equal(output.invalidReferences, 1);
  assert.equal((output.content.match(/```1:1:opaque/g) ?? []).length, 16);
  assert.ok(output.content.endsWith(marker));
});

test("the total source-byte budget counts UTF-8 and never clips source", () => {
  const marker = "[[source:window-1:1:1]]";
  const exact = "🦆".repeat(4000);
  assert.equal(new TextEncoder().encode(exact).byteLength, 16_000);
  const accepted = render(marker, [{ path: "unicode", startLine: 1, content: exact }]);
  assert.equal(accepted.invalidReferences, 0);
  assert.ok(accepted.content.includes(exact));
  assert.deepEqual(render(marker, [{ path: "unicode", startLine: 1, content: exact + "🦆" }]), { content: marker, invalidReferences: 1 });
  const partial = "🦆".repeat(2500);
  const repeated = render(`${marker}\n\n${marker}`, [{ path: "unicode", startLine: 1, content: partial }]);
  assert.equal(repeated.invalidReferences, 1);
  assert.equal((repeated.content.match(/```1:1:unicode/g) ?? []).length, 1);
  assert.ok(repeated.content.includes(partial));
  assert.ok(repeated.content.endsWith(marker));
});
