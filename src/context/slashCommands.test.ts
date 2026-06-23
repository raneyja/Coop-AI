import assert from "node:assert/strict";
import {
  matchSlashCommands,
  parseSlashCommand,
  segmentComposerSlashHighlights,
  slashCommandHistoryContent,
  slashMenuQuery
} from "./slashCommands";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

// ── parseSlashCommand: canonical tokens ──────────────────────────────────────
test("parses a bare canonical command with no args", () => {
  const parsed = parseSlashCommand("/blast");
  assert.ok(parsed);
  assert.equal(parsed!.def.target.kind, "action");
  if (parsed!.def.target.kind === "action") {
    assert.equal(parsed!.def.target.actionId, "blast-radius");
  }
  assert.equal(parsed!.args, "");
});

test("captures args after the command token", () => {
  const parsed = parseSlashCommand("/trace why was this retry added");
  assert.ok(parsed);
  if (parsed!.def.target.kind === "action") {
    assert.equal(parsed!.def.target.actionId, "trace-decision");
  }
  assert.equal(parsed!.args, "why was this retry added");
});

// ── parseSlashCommand: aliases ───────────────────────────────────────────────
test("resolves understand canonical token to understand-repo action", () => {
  const parsed = parseSlashCommand("/understand");
  assert.ok(parsed);
  if (parsed!.def.target.kind === "action") {
    assert.equal(parsed!.def.target.actionId, "understand-repo");
  }
});

test("resolves understandrepo alias to understand-repo action", () => {
  const parsed = parseSlashCommand("/understandrepo");
  assert.ok(parsed);
  if (parsed!.def.target.kind === "action") {
    assert.equal(parsed!.def.target.actionId, "understand-repo");
  }
});

test("resolves aliases to the same action", () => {
  for (const token of ["/who", "/owner", "/find-owner"]) {
    const parsed = parseSlashCommand(token);
    assert.ok(parsed, `expected ${token} to parse`);
    if (parsed!.def.target.kind === "action") {
      assert.equal(parsed!.def.target.actionId, "find-owner");
    }
  }
});

test("resolves blast-radius aliases", () => {
  for (const token of ["/impact", "/blast-radius"]) {
    const parsed = parseSlashCommand(token);
    assert.ok(parsed, `expected ${token} to parse`);
    if (parsed!.def.target.kind === "action") {
      assert.equal(parsed!.def.target.actionId, "blast-radius");
    }
  }
});

test("resolves trace-decision aliases", () => {
  for (const token of ["/trace", "/why", "/decision", "/history"]) {
    const parsed = parseSlashCommand(token);
    assert.ok(parsed, `expected ${token} to parse`);
    if (parsed!.def.target.kind === "action") {
      assert.equal(parsed!.def.target.actionId, "trace-decision");
    }
  }
});

test("is case-insensitive on the command token", () => {
  const parsed = parseSlashCommand("/BLAST surface area?");
  assert.ok(parsed);
  if (parsed!.def.target.kind === "action") {
    assert.equal(parsed!.def.target.actionId, "blast-radius");
  }
  assert.equal(parsed!.args, "surface area?");
});

test("trims leading whitespace before the slash", () => {
  const parsed = parseSlashCommand("   /gaps");
  assert.ok(parsed);
  if (parsed!.def.target.kind === "action") {
    assert.equal(parsed!.def.target.actionId, "knowledge-gaps");
  }
});

// ── parseSlashCommand: integrations ──────────────────────────────────────────
test("parses integration commands", () => {
  const parsed = parseSlashCommand("/slack who decided to drop redis");
  assert.ok(parsed);
  assert.equal(parsed!.def.target.kind, "integration");
  if (parsed!.def.target.kind === "integration") {
    assert.equal(parsed!.def.target.provider, "slack");
  }
  assert.equal(parsed!.args, "who decided to drop redis");
});

// ── parseSlashCommand: passthrough safety ────────────────────────────────────
test("returns null for unknown commands (sent as normal chat)", () => {
  assert.equal(parseSlashCommand("/explaineverything"), null);
  assert.equal(parseSlashCommand("/foo bar"), null);
});

test("does not treat file paths or bare slashes as commands", () => {
  assert.equal(parseSlashCommand("/etc/hosts is misconfigured"), null);
  assert.equal(parseSlashCommand("/"), null);
  assert.equal(parseSlashCommand("/ trace"), null);
  assert.equal(parseSlashCommand("just regular text"), null);
  assert.equal(parseSlashCommand(""), null);
  assert.equal(parseSlashCommand("foo/bar is not a command"), null);
});

test("parses a slash command anywhere in the message", () => {
  const parsed = parseSlashCommand("please check /slack who decided redis");
  assert.ok(parsed);
  if (parsed!.def.target.kind === "integration") {
    assert.equal(parsed!.def.target.provider, "slack");
  }
  assert.equal(parsed!.args, "who decided redis");
});

test("skips unknown slash tokens and uses the first recognized command", () => {
  const parsed = parseSlashCommand("try /foo then /jira ticket ABC-1");
  assert.ok(parsed);
  if (parsed!.def.target.kind === "integration") {
    assert.equal(parsed!.def.target.provider, "jira");
  }
  assert.equal(parsed!.args, "ticket ABC-1");
});

// ── slashMenuQuery ───────────────────────────────────────────────────────────
test("slashMenuQuery returns the partial token while typing", () => {
  assert.equal(slashMenuQuery("/"), "");
  assert.equal(slashMenuQuery("/tr"), "tr");
  assert.equal(slashMenuQuery("/BLA"), "bla");
});

test("slashMenuQuery detects a partial token at the cursor", () => {
  assert.equal(slashMenuQuery("please /tr", 10), "tr");
  assert.equal(slashMenuQuery("hello /", 7), "");
});

test("slashMenuQuery returns null once a space is typed or not slash-prefixed", () => {
  assert.equal(slashMenuQuery("/trace "), null);
  assert.equal(slashMenuQuery("/trace why"), null);
  assert.equal(slashMenuQuery("hello"), null);
  assert.equal(slashMenuQuery("hello /trace ", 13), null);
});

// ── matchSlashCommands ───────────────────────────────────────────────────────
test("matchSlashCommands returns all commands for an empty query", () => {
  assert.equal(matchSlashCommands("").length, 11);
});

test("matchSlashCommands includes integration commands like slack", () => {
  const slack = matchSlashCommands("sl");
  assert.ok(slack.some((def) => def.name === "slack"));
});

test("slashCommandHistoryContent preserves slash token and args for chat history", () => {
  const parsed = parseSlashCommand("/slack who decided redis");
  assert.ok(parsed);
  assert.equal(slashCommandHistoryContent(parsed.def, parsed.args), "/slack who decided redis");

  const bare = parseSlashCommand("/jira");
  assert.ok(bare);
  assert.equal(slashCommandHistoryContent(bare.def, bare.args), "/jira");
});

test("matchSlashCommands filters by token or alias prefix", () => {
  const blast = matchSlashCommands("bl");
  assert.equal(blast.length, 1);
  assert.equal(blast[0]!.name, "blast");

  // alias prefix "imp" -> blast (alias "impact")
  const viaAlias = matchSlashCommands("imp");
  assert.equal(viaAlias.length, 1);
  assert.equal(viaAlias[0]!.name, "blast");

  assert.equal(matchSlashCommands("zzz").length, 0);
});

// ── segmentComposerSlashHighlights ───────────────────────────────────────────
test("segmentComposerSlashHighlights colors a completed slash command", () => {
  const segments = segmentComposerSlashHighlights("/jira show me tickets");
  assert.deepEqual(segments, [
    { kind: "slash-command", text: "/jira" },
    { kind: "text", text: " show me tickets" }
  ]);
});

test("segmentComposerSlashHighlights finds commands anywhere in the message", () => {
  const segments = segmentComposerSlashHighlights("please /slack check this");
  assert.deepEqual(segments, [
    { kind: "text", text: "please " },
    { kind: "slash-command", text: "/slack" },
    { kind: "text", text: " check this" }
  ]);
});

test("segmentComposerSlashHighlights ignores unknown slash tokens", () => {
  const segments = segmentComposerSlashHighlights("/foo /jira ticket");
  assert.deepEqual(segments, [
    { kind: "text", text: "/foo " },
    { kind: "slash-command", text: "/jira" },
    { kind: "text", text: " ticket" }
  ]);
});

// ── Summary ──────────────────────────────────────────────────────────────────
const total = passed + failed;
console.log(`\nslashCommands: ${passed}/${total} tests passed`);
if (failed > 0) {
  process.exit(1);
}
