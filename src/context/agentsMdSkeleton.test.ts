import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { unusedAgentsMdRootPath } from "./agentsMdSkeleton";

test("unusedAgentsMdRootPath skips an existing repo AGENTS.md", () => {
  assert.equal(unusedAgentsMdRootPath("/repo", () => false), "/repo/AGENTS.md");
  assert.equal(unusedAgentsMdRootPath("/repo/", () => false), "/repo/AGENTS.md");
  assert.equal(unusedAgentsMdRootPath("/repo", () => true), undefined);
  assert.equal(unusedAgentsMdRootPath(undefined, () => false), undefined);
  assert.equal(unusedAgentsMdRootPath("C:\\repo", () => false), "C:\\repo\\AGENTS.md");
});

test("agentsMdSkeleton stays browser-safe for the webview", () => {
  const src = readFileSync(new URL("./agentsMdSkeleton.ts", import.meta.url), "utf8");
  assert.equal(/from ["']node:(?:path|fs)["']/.test(src), false);
});
