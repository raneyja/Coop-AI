import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { clearProjectInstructionsCache, loadProjectInstructionsCached } from "./projectInstructionsCache";
import { loadProjectInstructions } from "./projectInstructionsLoader";
import { AGENTS_MD_SKELETON } from "./agentsMdSkeleton";
import { resolveProjectInstructionsState } from "./projectInstructionsStatus";

function withTempRepo(run: (root: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "coop-agents-"));
  clearProjectInstructionsCache();
  try {
    fs.mkdirSync(path.join(root, ".git"));
    run(root);
  } finally {
    clearProjectInstructionsCache();
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
    assert.equal(state.hasAgentsMd, false);
  });
});

test("resolveProjectInstructionsState does not treat workspace AGENTS.md as attached", () => {
  withTempRepo((root) => {
    fs.writeFileSync(path.join(root, "AGENTS.md"), "# Coop-AI local folder rules — do not leak.\n");
    const state = resolveProjectInstructionsState({
      enabled: true,
      workspaceRoots: [root]
    });
    assert.equal(state.status, "missing");
    assert.equal(state.hasAgentsMd, false);
    assert.equal(state.gitRoot, root);
    assert.equal(state.attachedAgentsMdLabel, undefined);
  });
});

test("resolveProjectInstructionsState reports missing when only repo rule files exist", () => {
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
    assert.equal(state.status, "missing");
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

test("resolveProjectInstructionsState uses attached file even when workspace has a different AGENTS.md", () => {
  withTempRepo((root) => {
    fs.writeFileSync(path.join(root, "AGENTS.md"), "# Coop-AI local folder rules — do not leak.\n");
    const attached = path.join(root, "my-guide.md");
    fs.writeFileSync(attached, "# My project guide\n");
    const state = resolveProjectInstructionsState({
      enabled: true,
      workspaceRoots: [root],
      attachedAgentsMdPath: attached,
      canMutate: true
    });
    assert.equal(state.status, "loaded");
    assert.equal(state.hasAgentsMd, true);
    assert.equal(state.source, "attached");
    assert.equal(state.attachedAgentsMdLabel, "my-guide.md");
    assert.deepEqual(state.sources, ["my-guide.md"]);
  });
});

test("resolveProjectInstructionsState Use-repo ignores a personal attached file", () => {
  withTempRepo((root) => {
    const attached = path.join(root, "my-guide.md");
    fs.writeFileSync(attached, "# Personal leftover\n");
    const state = resolveProjectInstructionsState({
      enabled: true,
      workspaceRoots: [root],
      attachedAgentsMdPath: attached,
      useRepoId: "github:acme/plane",
      remoteHasAgentsMd: false,
      canMutate: true
    });
    assert.equal(state.status, "missing");
    assert.equal(state.hasAgentsMd, false);
    assert.equal(state.source, "repo");
    assert.equal(state.canMutate, false);
  });
});

test("resolveProjectInstructionsState Use-repo reports remote AGENTS.md", () => {
  const state = resolveProjectInstructionsState({
    enabled: true,
    useRepoId: "github:acme/plane",
    remoteHasAgentsMd: true
  });
  assert.equal(state.status, "loaded");
  assert.equal(state.hasAgentsMd, true);
  assert.equal(state.source, "repo");
  assert.deepEqual(state.sources, ["AGENTS.md"]);
});

test("AGENTS.md create template is a blank starter, not Coop-AI's repo guide", () => {
  assert.match(AGENTS_MD_SKELETON, /^# Agent guide/m);
  assert.equal(/Coop AI repo|coop-ai\.dev|Zero-Clone/i.test(AGENTS_MD_SKELETON), false);
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

test("loadProjectInstructionsCached reuses hot-path result for same cache key", () => {
  withTempRepo((root) => {
    const agentsPath = path.join(root, "AGENTS.md");
    fs.writeFileSync(agentsPath, "# Guide\n");
    const initial = loadProjectInstructionsCached({
      enabled: true,
      gitRoot: root,
      activeFile: "src/index.ts",
      attachedAgentsMdPath: "/tmp/attached-a.md"
    });
    assert.equal(initial.length, 1);

    fs.chmodSync(agentsPath, 0o000);
    try {
      const cached = loadProjectInstructionsCached({
        enabled: true,
        gitRoot: root,
        activeFile: "src/index.ts",
        attachedAgentsMdPath: "/tmp/attached-a.md"
      });
      assert.equal(cached.length, 1);
      assert.equal(cached[0]?.path, "AGENTS.md");
    } finally {
      fs.chmodSync(agentsPath, 0o644);
    }
  });
});

test("loadProjectInstructionsCached invalidates when attached path changes", () => {
  withTempRepo((root) => {
    const agentsPath = path.join(root, "AGENTS.md");
    fs.writeFileSync(agentsPath, "# Guide\n");
    const initial = loadProjectInstructionsCached({
      enabled: true,
      gitRoot: root,
      activeFile: "src/index.ts",
      attachedAgentsMdPath: "/tmp/attached-a.md"
    });
    assert.equal(initial.length, 1);

    fs.chmodSync(agentsPath, 0o000);
    try {
      const reloaded = loadProjectInstructionsCached({
        enabled: true,
        gitRoot: root,
        activeFile: "src/index.ts",
        attachedAgentsMdPath: "/tmp/attached-b.md"
      });
      assert.equal(reloaded.length, 0);
    } finally {
      fs.chmodSync(agentsPath, 0o644);
    }
  });
});
