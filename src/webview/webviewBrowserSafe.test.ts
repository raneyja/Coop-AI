import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import * as esbuild from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("webview bundle does not eagerly require Node builtins", async () => {
  const result = await esbuild.build({
    absWorkingDir: repoRoot,
    entryPoints: ["src/webview/index.tsx"],
    bundle: true,
    platform: "browser",
    format: "iife",
    write: false,
    external: ["node:fs", "node:path"],
    logLevel: "silent"
  });
  const code = result.outputFiles[0]?.text ?? "";
  assert.ok(code.includes("CoopAI failed to load"), "expected webview boot error path in bundle");
  assert.equal(
    /var \w+ = __toESM\(__require\("node:(?:path|fs|os)"\)\)/.test(code),
    false,
    "eager node builtin require crashes the CoopAI webview on load"
  );
});
