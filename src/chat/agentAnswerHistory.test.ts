import assert from "node:assert/strict";
import { summarizeAgentToolResultForHistory } from "./agentAnswerHistory";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    failed += 1;
  }
}

test("summarizes read_file bodies instead of dumping the full JSON", () => {
  const body = "x".repeat(4000);
  const raw = JSON.stringify({
    files: [{ path: "src/server/authMiddleware.ts", content: body, startLine: 10, endLine: 80 }]
  });
  const summarized = summarizeAgentToolResultForHistory(raw);
  assert.ok(summarized.length < raw.length);
  assert.match(summarized, /authMiddleware/);
  assert.ok(!summarized.includes(body));
});

test("plain text is clipped", () => {
  const raw = "n".repeat(5000);
  const summarized = summarizeAgentToolResultForHistory(raw);
  assert.ok(summarized.length < raw.length);
  assert.ok(summarized.endsWith("…"));
});

test("read_file with a late writeJson 401 unauthorized keeps that excerpt", () => {
  const padding = Array.from({ length: 80 }, (_, i) => `${i + 1}|const pad${i} = ${i};`).join("\n");
  const write = '81|    writeJson(response, 401, { error: "unauthorized" });';
  const raw = JSON.stringify({
    files: [{ path: "src/jobs/jobsApi.ts", content: `${padding}\n${write}` }]
  });
  const summarized = summarizeAgentToolResultForHistory(raw);
  assert.match(summarized, /jobsApi\.ts/);
  assert.match(summarized, /writeJson/);
  assert.match(summarized, /unauthorized/);
  assert.ok(!summarized.includes("const pad0 = 0;"));
});

test("verified remote evidence survives synthesis without a header-only clip", () => {
  const body = `${"# header\n".repeat(70)}180|raise ValidationError("Parent is invalid")`;
  const raw = JSON.stringify({ files: [{ path: "api/serializer.py", content: body, evidenceSource: "remote-read" }] });
  const summarized = JSON.parse(summarizeAgentToolResultForHistory(raw));
  assert.equal(summarized.files[0].content, body);
});

test("turn-owned attachment retains its late implementation and provenance", () => {
  const body = `${"1|// header\n".repeat(70)}180|return verifyToken(token);`;
  const raw = JSON.stringify({ files: [{ path: "src/auth.ts", content: body,
    evidenceSource: "turn-attachment", startLine: 1, endLine: 180 }] });
  const summarized = JSON.parse(summarizeAgentToolResultForHistory(raw));
  assert.equal(summarized.files[0].content, body);
  assert.equal(summarized.files[0].evidenceSource, "turn-attachment");
  assert.equal(summarized.files[0].endLine, 180);
});

console.log(`\nagentAnswerHistory: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
