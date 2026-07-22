#!/usr/bin/env node
/**
 * Prompt quality smoke — measures assembled prompt sizes + (optional) live latency.
 *
 * Default: in-process assembly only (no API keys required).
 * Live: set COOP_API_BASE + COOP_API_KEY to hit /v1/chat and /v1/completions/inline.
 *
 * Usage:
 *   npx tsx scripts/prompt-quality-smoke.mjs
 *   COOP_API_BASE=http://localhost:8787 COOP_API_KEY=… npx tsx scripts/prompt-quality-smoke.mjs
 */
import { performance } from "node:perf_hooks";

const {
  systemPromptForUseCase,
  buildUserMessageWithContext
} = await import("../src/prompts/systemPrompts.ts");
const { ENTERPRISE_CONFIDENTIAL_SYSTEM_PROMPT, injectZeroRetentionSystemPrompt } =
  await import("../src/api/requestFormatter.ts");
const { quickActionPromptParts } = await import("../src/prompts/quickActionPrompts.ts");
const { buildBlastRadiusSynthesisUserPrompt } = await import(
  "../src/prompts/blastRadiusSynthesis.ts"
);
const { buildDecisionSynthesisUserPrompt } = await import("../src/prompts/decisionSynthesis.ts");

const API_BASE = (process.env.COOP_API_BASE ?? "").replace(/\/$/, "");
const API_KEY = process.env.COOP_API_KEY ?? "";
const LIVE = Boolean(API_BASE && API_KEY);

function chars(s) {
  return s?.length ?? 0;
}

function estTokens(s) {
  // Rough English/code estimate (~4 chars/token). For relative comparisons only.
  return Math.round(chars(s) / 4);
}

function report(label, parts) {
  const total = parts.reduce((n, p) => n + chars(p.text), 0);
  console.log(`\n${label}`);
  for (const p of parts) {
    console.log(
      `  ${p.name.padEnd(28)} ${String(chars(p.text)).padStart(7)} chars  ~${String(estTokens(p.text)).padStart(5)} tok`
    );
  }
  console.log(
    `  ${"TOTAL".padEnd(28)} ${String(total).padStart(7)} chars  ~${String(estTokens("x".repeat(total))).padStart(5)} tok`
  );
  return total;
}

const ctx = {
  owner: "acme",
  repo: "payments",
  branch: "main",
  file: "src/billing/charge.ts",
  languageId: "typescript"
};

const sampleLocalFiles = [
  {
    path: "src/billing/charge.ts",
    content: "export function charge(amount: number) {\n  return amount * 100;\n}\n"
  }
];

const sampleBundle = [
  {
    type: "file_metadata",
    data: {
      jiraSearch: {
        match: "git",
        query: "charge",
        issues: [
          {
            key: "PAY-12",
            summary: "Charge currency fix",
            status: "Done",
            updated: "2026-01-01",
            issueType: "Bug",
            htmlUrl: "https://example.atlassian.net/browse/PAY-12"
          }
        ]
      },
      slackSearch: {
        query: "charge",
        messages: [{ channel: "eng", user: "ada", text: "we shipped the charge fix", ts: "1" }]
      },
      lightning: { scipAvailable: true, zoektAvailable: true, searchSource: "scip", language: "typescript" }
    }
  }
];

console.log("Coop AI — prompt quality smoke");
console.log(`Mode: ${LIVE ? `live (${API_BASE})` : "assembly-only (set COOP_API_BASE + COOP_API_KEY for live)"}`);

// --- Chat path ---
const chatSystemBase = systemPromptForUseCase("chat");
const chatSystem = injectZeroRetentionSystemPrompt([{ role: "system", content: chatSystemBase }])[0]
  .content;
const chatUser = buildUserMessageWithContext("Why does charge() multiply by 100?", {
  ...ctx,
  contextBundle: sampleBundle,
  projectInstructions: [{ path: "AGENTS.md", kind: "agents_md", content: "Prefer concise answers." }]
});
const chatTotal = report("Free chat (gpt-4o-mini path)", [
  { name: "enterprise preamble", text: ENTERPRISE_CONFIDENTIAL_SYSTEM_PROMPT },
  { name: "system (use-case)", text: chatSystemBase },
  { name: "system after inject", text: chatSystem },
  { name: "user + context", text: chatUser }
]);

if ((chatSystem.match(ENTERPRISE_CONFIDENTIAL_SYSTEM_PROMPT) || []).length !== 1) {
  console.error("FAIL: enterprise preamble should appear exactly once in injected system");
  process.exit(1);
}
console.log("  ✓ enterprise preamble appears exactly once after inject");

// --- Blast radius synthesis ---
const blastSystemBase = systemPromptForUseCase("blast_radius");
const blastTask = quickActionPromptParts("blast-radius", ctx).task;
const blastFallback = quickActionPromptParts("blast-radius", ctx).model;
const blastUser = buildBlastRadiusSynthesisUserPrompt({
  evidence: {
    file: ctx.file,
    codeDependents: [{ path: "src/api/checkout.ts", reason: "imports charge" }],
    topRiskSurfaces: [{ path: "src/api/checkout.ts", rank: 1, reason: "checkout path" }]
  },
  file: ctx.file,
  userQuestion: blastTask
});
report("Blast radius synthesis (claude-sonnet path)", [
  { name: "system (use-case)", text: blastSystemBase },
  { name: "task-only (A6)", text: blastTask },
  { name: "fallback .model (no synth)", text: blastFallback },
  { name: "synthesis user", text: blastUser }
]);

if (blastTask.split("\n").length > 2) {
  console.error("FAIL: blast task should be a short imperative, not the full model turn");
  process.exit(1);
}
if (blastUser.includes("Be direct and thorough; no preamble")) {
  console.error("FAIL: synthesis ## Task should not swallow DIRECTIVE from .model turn");
  process.exit(1);
}
console.log("  ✓ task-only string is short; synthesis does not embed DIRECTIVE");

// --- Decision synthesis task-only ---
const decisionTask = quickActionPromptParts("trace-decision", ctx).task;
const decisionUser = buildDecisionSynthesisUserPrompt({
  timeline: {
    file: ctx.file,
    completeness: "minimal",
    originalCommit: {
      sha: "abc123",
      author: "ada",
      date: "2025-01-01",
      message: "init charge"
    },
    alternatives: [],
    chronology: [],
    warnings: ["No linked pull request found for the introducing commit."]
  },
  file: ctx.file,
  userQuestion: decisionTask
});
if (decisionUser.includes("Be direct and thorough; no preamble")) {
  console.error("FAIL: decision synthesis still embeds DIRECTIVE");
  process.exit(1);
}
console.log("  ✓ decision synthesis uses task-only question");

// --- Inline system ---
const inlineSystem = systemPromptForUseCase("inline_completion");
const rulesBlocks = (inlineSystem.match(/^RULES:/gm) || []).length;
report("Inline completion system", [{ name: "INLINE system", text: inlineSystem }]);
if (rulesBlocks !== 1) {
  console.error(`FAIL: expected exactly 1 RULES block in inline system, found ${rulesBlocks}`);
  process.exit(1);
}
console.log("  ✓ inline system has a single RULES block (no INLINE_SYSTEM dup)");

// --- Local files authority ---
const localWrapped = buildUserMessageWithContext("Explain this", {
  ...ctx,
  contextBundle: [
    {
      type: "file_metadata",
      data: { localFiles: { files: sampleLocalFiles } }
    }
  ]
});
if (!localWrapped.includes("Answer ONLY from this code")) {
  console.error("FAIL: local_files block missing stronger authority line");
  process.exit(1);
}
console.log("  ✓ local_files uses stronger 2-line authority");

// --- Live latency (optional) ---
async function timed(label, fn) {
  const t0 = performance.now();
  const result = await fn();
  const ms = Math.round(performance.now() - t0);
  console.log(`  ${label}: ${ms} ms`);
  return { ms, result };
}

if (LIVE) {
  console.log("\nLive latency");
  const headers = {
    Authorization: `Bearer ${API_KEY}`,
    "Content-Type": "application/json"
  };

  await timed("GET /health", async () => {
    const res = await fetch(`${API_BASE}/health`);
    if (!res.ok) throw new Error(`health ${res.status}`);
    return res.json();
  });

  const chatLive = await timed("POST /v1/chat (short)", async () => {
    const res = await fetch(`${API_BASE}/v1/chat`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        message: "Reply with exactly: ok",
        useCase: "chat",
        history: [],
        context: ctx,
        stream: false
      })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? body.message ?? `HTTP ${res.status}`);
    return body;
  });

  const inlineLive = await timed("POST /v1/completions/inline", async () => {
    const res = await fetch(`${API_BASE}/v1/completions/inline`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        languageId: "typescript",
        file: "src/example.ts",
        message:
          "PREFIX:\nexport function add(a: number, b: number) {\n  return \n\nSUFFIX:\n;\n}\n\nTASK: Complete at the cursor. Return ONLY code.",
        segments: {
          prefix: "export function add(a: number, b: number) {\n  return ",
          suffix: ";\n}\n"
        },
        maxTokens: 32,
        stream: false
      })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = String(body.message ?? body.error ?? "");
      if (/no api key.*mistral/i.test(msg) || /mistral/i.test(msg)) {
        return { skipped: true, reason: msg };
      }
      throw new Error(body.error ?? body.message ?? `HTTP ${res.status}`);
    }
    return body;
  });

  if (inlineLive.result?.skipped) {
    console.warn(
      `  SKIP inline live: autocomplete assignment is Mistral but no MISTRAL_API_KEY is configured (${inlineLive.result.reason})`
    );
  } else if (inlineLive.ms > 3000) {
    console.warn(`  WARN: inline ${inlineLive.ms} ms exceeds soft smoke budget (3000 ms)`);
  } else {
    console.log("  ✓ inline within 3000 ms soft smoke budget");
  }
  if (chatLive.ms > 15000) {
    console.warn(`  WARN: chat ${chatLive.ms} ms is slow for a short reply`);
  } else {
    console.log("  ✓ short chat within 15s soft smoke budget");
  }
}

console.log("\nPrompt quality smoke: PASS");
console.log(`Chat assembled payload ~${estTokens("x".repeat(chatTotal))} tok (relative; not billed).`);
