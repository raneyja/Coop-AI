import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { loadProjectInstructions } from "./projectInstructionsLoader";
import { resolveProjectInstructionsState } from "./projectInstructionsStatus";

function withTempRepo(run: (root: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "coop-agents-"));
  try {
    fs.mkdirSync(path.join(root, ".git"));
    run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("resolveProjectInstructionsState reports missing when git repo has no AGENTS.md", () => {
  withTempRepo((root) => {
    const state = resolveProjectInstructionsState({
      enabled: true,
      activeFile: "src/index.ts",
      workspaceRoots: [root]
    });
    assert.equal(state.status, "missing");
    assert.equal(state.gitRoot, root);
  });
});

test("resolveProjectInstructionsState reports loaded when root AGENTS.md exists", () => {
  withTempRepo((root) => {
    fs.writeFileSync(path.join(root, "AGENTS.md"), "# Guide\n");
    const state = resolveProjectInstructionsState({
      enabled: true,
      workspaceRoots: [root]
    });
    assert.equal(state.status, "loaded");
    assert.equal(state.hasAgentsMd, true);
    assert.deepEqual(state.sources, ["AGENTS.md"]);
  });
});

test("resolveProjectInstructionsState reports hasAgentsMd false when only repo rule files exist", () => {
  withTempRepo((root) => {
    fs.mkdirSync(path.join(root, ".cursor", "rules"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".cursor", "rules", "style.mdc"),
      "---\nalwaysApply: true\n---\nUse coop tokens.\n"
    );
    const state = resolveProjectInstructionsState({
      enabled: true,
      workspaceRoots: [root]
    });
    assert.equal(state.status, "loaded");
    assert.equal(state.hasAgentsMd, false);
  });
});

test("resolveProjectInstructionsState uses attached AGENTS.md without git root", () => {
  withTempRepo((root) => {
    const attached = path.join(root, "AGENTS.md");
    fs.writeFileSync(attached, "# Attached guide\n");
    const state = resolveProjectInstructionsState({
      enabled: true,
      attachedAgentsMdPath: attached
    });
    assert.equal(state.status, "loaded");
    assert.equal(state.hasAgentsMd, true);
    assert.equal(state.attachedAgentsMdLabel, "AGENTS.md");
  });
});

test("loadProjectInstructions includes alwaysApply cursor rules", () => {
  withTempRepo((root) => {
    fs.mkdirSync(path.join(root, ".cursor", "rules"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".cursor", "rules", "style.mdc"),
      "---\nalwaysApply: true\n---\nUse coop tokens.\n"
    );
    fs.writeFileSync(
      path.join(root, ".cursor", "rules", "optional.mdc"),
      "---\nalwaysApply: false\n---\nIgnore me.\n"
    );
    const loaded = loadProjectInstructions({ gitRoot: root });
    assert.equal(loaded.files.length, 1);
    assert.equal(loaded.files[0]?.path, ".cursor/rules/style.mdc");
  });
});
