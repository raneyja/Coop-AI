/**
 * Production-grade guard: retrieval and ranking must never encode one
 * repository's layout.
 *
 * On 2026-08-13 the hunt was "fixed" by hardcoding `apps/live`, `hocuspocus`,
 * and `auth-forms`. That made one question pass on one repo and would have
 * misranked every other customer's code. Three rules keep it out:
 *  1. no path-shaped literal in ranking code outside universal infrastructure
 *  2. the noise module's entire vocabulary must be universal infrastructure
 *  3. no product, framework, or vendor name anywhere in ranking code
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

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

/** Every module that decides which files become evidence. */
const RANKING_MODULES = [
  "src/api/agent/searchQuery.ts",
  "src/api/agent/AgentOrchestrator.ts",
  "src/api/agent/parseAgentToolPlan.ts",
  "src/indexing/evidencePathNoise.ts",
  "src/indexing/mentionPathScore.ts",
  "src/indexing/graphSearchHit.ts",
  "src/context/repoSemanticRetrieval.ts",
  // Decides whether a turn touches repo code at all — the same rule applies.
  "src/chat/repoCodeIntent.ts"
];

/** The one module allowed to name directories at all. */
const NOISE_MODULE = "src/indexing/evidencePathNoise.ts";

/**
 * Directory and extension words that mean the same thing in every repository.
 * Adding a word here is a deliberate claim that it is universal — not a way to
 * silence this test.
 */
const UNIVERSAL_PATH_WORDS = new Set([
  "node_modules",
  "vendor",
  "third_party",
  "dist",
  "build",
  "out",
  "coverage",
  "next",
  "turbo",
  "testdata",
  "shards",
  "generated",
  "min",
  "bundle",
  "snap",
  "map",
  "zoekt",
  "pb",
  "index",
  "package",
  "lock",
  "yarn",
  "pnpm",
  "poetry",
  "cargo",
  "go",
  "sum",
  "json",
  "yaml",
  "yml",
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "mts",
  "cts",
  "css",
  "py",
  "g",
  // Test trees (isTestPath) — universal across languages/layouts
  "test",
  "tests",
  "testing",
  "test_",
  "spec",
  "specs"
]);

/**
 * Products, frameworks, and vendors. Ranking that knows these names is ranking
 * that only works for the repo it was demoed on.
 */
const NEVER_NAMED = [
  "plane",
  "documenso",
  "hocuspocus",
  "auth-forms",
  "yjs",
  "django",
  "rails",
  "laravel",
  "nestjs",
  "fastapi",
  "express",
  "flask",
  "spring",
  "apps/api",
  "apps/web",
  "apps/live",
  "apps/space"
];

function readRepo(relative: string): string {
  return fs.readFileSync(path.join(__dirname, "../../..", relative), "utf8");
}

/** Code only, minus imports — a comment or import path is not a ranking rule. */
function rankingCode(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/^\s*(import|export)\s[^;]*?from\s*["'][^"']+["'];?\s*$/gm, " ")
    .replace(/^\s*import\s+["'][^"']+["'];?\s*$/gm, " ");
}

/**
 * Literals that could be a path rule. Prose and template strings are excluded:
 * a rule is always a single unbroken token like `apps/live`.
 */
function pathLikeLiterals(source: string): string[] {
  const found: string[] = [];
  const literal = /"([^"\n]*)"|'([^'\n]*)'|\/((?:[^/\\\n]|\\.)+)\/[gimsuy]*/g;
  for (const match of source.matchAll(literal)) {
    const value = match[1] ?? match[2] ?? match[3] ?? "";
    // Relative module specifiers (including dynamic `import()`) are not path rules.
    if (/\s/.test(value) || value.includes("${") || /^\.\.?\//.test(value)) {
      continue;
    }
    if (value.includes("/")) {
      found.push(value);
    }
  }
  return found;
}

function regexLiterals(source: string): string[] {
  return [...source.matchAll(/\/((?:[^/\\\n]|\\.)+)\/[gimsuy]*/g)].map((match) => match[1]);
}

function words(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((word) => word.length > 1);
}

test("no ranking module encodes a specific repository's layout", () => {
  const offences: string[] = [];
  for (const relative of RANKING_MODULES) {
    for (const value of pathLikeLiterals(rankingCode(readRepo(relative)))) {
      const unknown = words(value).filter((word) => !UNIVERSAL_PATH_WORDS.has(word));
      if (unknown.length > 0) {
        offences.push(`${relative}: ${JSON.stringify(value)} → ${unknown.join(", ")}`);
      }
    }
  }
  assert.deepEqual(offences, [], `Repo-specific path rules:\n${offences.join("\n")}`);
});

test("the noise module's whole vocabulary is universal infrastructure", () => {
  const offences: string[] = [];
  for (const body of regexLiterals(rankingCode(readRepo(NOISE_MODULE)))) {
    for (const word of words(body)) {
      if (!UNIVERSAL_PATH_WORDS.has(word)) {
        offences.push(`${JSON.stringify(body)} → ${word}`);
      }
    }
  }
  assert.deepEqual(offences, [], `Non-universal terms in ${NOISE_MODULE}:\n${offences.join("\n")}`);
});

test("no product, framework, or vendor name in ranking code", () => {
  const offences: string[] = [];
  for (const relative of RANKING_MODULES) {
    const source = rankingCode(readRepo(relative)).toLowerCase();
    for (const name of NEVER_NAMED) {
      if (source.includes(name)) {
        offences.push(`${relative} names "${name}"`);
      }
    }
  }
  assert.deepEqual(offences, [], `Ranking code names specific products:\n${offences.join("\n")}`);
});

test("noise classification lives in one module, not copied per caller", () => {
  const owner = readRepo(NOISE_MODULE);
  assert.match(owner, /export function isBarrelPath/);
  assert.match(owner, /export function isGeneratedOrVendorPath/);
  assert.match(owner, /export function isTestPath/);

  for (const relative of ["src/chat/CoopChatSession.ts", "src/indexing/lightningSearch.ts"]) {
    assert.doesNotMatch(
      readRepo(relative),
      /function isNoisyMentionPath\(/,
      `${relative} has its own copy of the noise rules`
    );
  }
});

console.log(`\nnoRepoSpecificRules: ${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  process.exit(1);
}
