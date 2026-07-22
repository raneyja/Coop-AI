import assert from "node:assert/strict";
import {
  applyPromptTemplate,
  MAX_WORKSPACE_PROMPTS,
  MAX_WORKSPACE_TEMPLATE_CHARS,
  mergeComposerWithPromptTemplate,
  resolvePromptLibraryRun,
  sanitizeWorkspacePromptEntries
} from "./promptLibraryRun";

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

test("resolvePromptLibraryRun routes bare slash templates without actionId", () => {
  const plan = resolvePromptLibraryRun("/understand focus on plugins");
  assert.equal(plan.kind, "slash");
  if (plan.kind === "slash") {
    assert.equal(plan.parsed.def.target.kind, "action");
    if (plan.parsed.def.target.kind === "action") {
      assert.equal(plan.parsed.def.target.actionId, "understand-repo");
    }
    assert.equal(plan.parsed.args, "focus on plugins");
  }
});

test("resolvePromptLibraryRun uses custom template as slashUserArgs when actionId is set", () => {
  const plan = resolvePromptLibraryRun("Focus on the plugin system", "understand-repo");
  assert.equal(plan.kind, "quick-action");
  if (plan.kind === "quick-action") {
    assert.equal(plan.actionId, "understand-repo");
    assert.equal(plan.slashUserArgs, "Focus on the plugin system");
  }
});

test("resolvePromptLibraryRun strips matching slash token when actionId is set", () => {
  const plan = resolvePromptLibraryRun("/understand focus on plugins", "understand-repo");
  assert.equal(plan.kind, "quick-action");
  if (plan.kind === "quick-action") {
    assert.equal(plan.slashUserArgs, "focus on plugins");
  }
});

test("resolvePromptLibraryRun uses default quick action when actionId set and template empty", () => {
  const plan = resolvePromptLibraryRun("", "understand-repo");
  assert.equal(plan.kind, "quick-action");
  if (plan.kind === "quick-action") {
    assert.equal(plan.slashUserArgs, undefined);
  }
});

test("mergeComposerWithPromptTemplate prepends composer text", () => {
  assert.equal(
    mergeComposerWithPromptTemplate("Also check auth", "Focus on {{repo}} plugins"),
    "Also check auth\n\nFocus on {{repo}} plugins"
  );
});

test("applyPromptTemplate substitutes context variables", () => {
  const text = applyPromptTemplate("Review {{file}} in {{owner}}/{{repo}}", {
    file: "lib/plugin-utils.js",
    owner: "coop-demo-lab",
    repo: "fastify",
    branch: "main"
  });
  assert.equal(text, "Review lib/plugin-utils.js in coop-demo-lab/fastify");
});

test("resolvePromptLibraryRun ignores unknown actionId (no blind cast)", () => {
  const plan = resolvePromptLibraryRun("Focus on plugins", "not-a-real-action");
  assert.equal(plan.kind, "chat");
  if (plan.kind === "chat") {
    assert.equal(plan.message, "Focus on plugins");
  }
});

test("sanitizeWorkspacePromptEntries drops malformed entries and caps count", () => {
  const entries = Array.from({ length: MAX_WORKSPACE_PROMPTS + 25 }, (_, i) => ({
    id: `p${i}`,
    title: `Prompt ${i}`,
    template: `Body ${i}`
  }));
  entries.push({ id: "", title: "bad", template: "x" } as { id: string; title: string; template: string });
  const sanitized = sanitizeWorkspacePromptEntries(entries);
  assert.equal(sanitized.length, MAX_WORKSPACE_PROMPTS);
  assert.ok(sanitized.every((entry) => entry.id && entry.title && entry.template));
});

test("sanitizeWorkspacePromptEntries truncates oversized templates", () => {
  const huge = "x".repeat(MAX_WORKSPACE_TEMPLATE_CHARS + 500);
  const sanitized = sanitizeWorkspacePromptEntries([
    { id: "big", title: "Big", template: huge }
  ]);
  assert.equal(sanitized.length, 1);
  assert.equal(sanitized[0]?.template.length, MAX_WORKSPACE_TEMPLATE_CHARS);
});

console.log(`\npromptLibraryRun: ${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  process.exit(1);
}
