import assert from "node:assert/strict";
import { handleReadFile, numberReadLines, stripReadLinePrefixes } from "./readFile";
import type { AgentToolContext } from "../agentToolContext";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

function ctx(content: string): AgentToolContext {
  return {
    indexBackend: {} as AgentToolContext["indexBackend"],
    resolveAbsolutePath: () => undefined,
    readRemoteFile: async ({ path }) => ({ path, content })
  };
}

async function main(): Promise<void> {
  await test("read_file prefixes the real file line numbers", async () => {
    const body = Array.from({ length: 140 }, (_, i) =>
      i === 131 ? "export function requireAuth() {" : `// line ${i + 1}`
    ).join("\n");
    const raw = await handleReadFile(ctx(body), {
      path: "src/auth.ts",
      startLine: 132,
      endLine: 134
    });
    const parsed = JSON.parse(raw) as { files: Array<{ content: string }>; startLine: number };
    assert.equal(parsed.startLine, 132);
    assert.match(parsed.files[0]?.content ?? "", /^132\|export function requireAuth\(\) \{/m);
    assert.match(parsed.files[0]?.content ?? "", /^133\|\/\/ line 133/m);
  });

  await test("numberReadLines / stripReadLinePrefixes round-trip", () => {
    const numbered = numberReadLines("export function requireAuth() {", 132);
    assert.equal(numbered, "132|export function requireAuth() {");
    assert.equal(stripReadLinePrefixes(numbered), "export function requireAuth() {");
  });

  console.log(`\nreadFile: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

void main();
