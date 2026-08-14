/**
 * End-to-end agent scope eval — no Extension Host required.
 *
 * Covers the full chain that dogfood would exercise:
 *   1. intent planner + routing (what turn runs the loop)
 *   2. locate / understand hunts against the golden repo
 *   3. change request → search → read → propose_patch → Patch card text
 *   4. hunt questions never invent a patch
 *   5. local explain / Slack stay out of the loop
 */
import assert from "node:assert/strict";
import { createAgentOrchestrator } from "../AgentOrchestrator";
import {
  GOLDEN_REPO_FILES,
  GOLDEN_REPO_ID,
  createGoldenIndexBackend,
  readGoldenRepoFile
} from "./goldenRepo";
import { agentTurnAction, shouldRunAgentToolLoop } from "../../../chat/agentRouting";
import { planChatIntentFromRules } from "../../../chat/intentPlanner/planChatIntent";
import {
  extractAgentProposedPatchText,
  mergeAnswerWithAgentPatch
} from "../../../chat/agentProposedPatch";
import { parsePatchResponse } from "../../../edit/patchParser";
import { findAllSearchMatches } from "../../../edit/patchContent";

type RouteCase = {
  q: string;
  expectAction: "locate" | "understand" | "change" | "none";
  expectLoop: boolean;
  note?: string;
};

const ROUTE_CASES: RouteCase[] = [
  {
    q: "Where is requireAuth or authentication middleware defined in this repo?",
    expectAction: "locate",
    expectLoop: true
  },
  {
    q: "Show me the authentication middleware",
    expectAction: "locate",
    expectLoop: true
  },
  {
    q: "What happens when a user signs in?",
    expectAction: "understand",
    expectLoop: true
  },
  {
    q: "Explain the auth middleware",
    expectAction: "understand",
    expectLoop: true
  },
  {
    q: "How does session refresh work?",
    expectAction: "understand",
    expectLoop: true
  },
  {
    q: "Add a null check to requireAuth in the auth middleware",
    expectAction: "change",
    expectLoop: true
  },
  {
    q: "Refactor the invoice service to use decimals",
    expectAction: "change",
    expectLoop: true
  },
  {
    q: "Fix the bug where tokens expire early in the session service",
    expectAction: "change",
    expectLoop: true
  },
  {
    q: "Explain this function",
    expectAction: "none",
    expectLoop: false,
    note: "open buffer — planner mode plain"
  },
  {
    q: "Thanks",
    expectAction: "none",
    expectLoop: false
  },
  {
    q: "What's in Slack about this?",
    expectAction: "none",
    expectLoop: false,
    note: "named integration only"
  },
  {
    q: "Who owns the billing service?",
    expectAction: "none",
    expectLoop: false,
    note: "find-owner workflow wins"
  },
  {
    q: "Who calls verifyToken?",
    expectAction: "none",
    expectLoop: false,
    note: "blast-radius workflow wins"
  }
];

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

function routeFor(q: string) {
  const plan = planChatIntentFromRules({ message: q, connectedTools: [] });
  const action = agentTurnAction({
    query: q,
    hasQuickAction: false,
    agentModeSetting: "on",
    intentPlan: plan
  });
  const loops = shouldRunAgentToolLoop({
    query: q,
    hasQuickAction: false,
    agentModeSetting: "on",
    intentPlan: plan
  });
  return { plan, action, loops };
}

async function main(): Promise<void> {
  await test("planner + routing matrix matches product scope", () => {
    const misses: string[] = [];
    for (const c of ROUTE_CASES) {
      const { action, loops, plan } = routeFor(c.q);
      if (action !== c.expectAction || loops !== c.expectLoop) {
        misses.push(
          `${c.q}\n      expected action=${c.expectAction} loop=${c.expectLoop}` +
            ` got action=${action} loop=${loops} plan=${plan.mode}/${plan.workflow ?? "-"}` +
            (c.note ? ` (${c.note})` : "")
        );
      }
    }
    assert.equal(misses.length, 0, misses.join("\n"));
  });

  await test("agent off never loops even on a clear hunt", () => {
    const q = "Where is requireAuth defined in this repo?";
    assert.equal(
      shouldRunAgentToolLoop({
        query: q,
        hasQuickAction: false,
        agentModeSetting: "off",
        intentPlan: planChatIntentFromRules({ message: q, connectedTools: [] })
      }),
      false
    );
  });

  await test("locate hunt reads the definition line in the golden repo", async () => {
    const orchestrator = createAgentOrchestrator({
      indexBackend: createGoldenIndexBackend("positioned"),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async ({ path }) => readGoldenRepoFile(path)
    });
    const result = await orchestrator.run({
      message: "Where is requireAuth or authentication middleware defined in this repo?",
      repoId: GOLDEN_REPO_ID
    });
    const files = (result.context?.read_file as { files?: Array<{ path: string; content: string }> } | undefined)
      ?.files;
    assert.ok(files?.some((f) => f.path === "server/auth/middleware.py"));
    assert.ok(files?.some((f) => f.content.includes("def require_auth(view):")));
    assert.equal(result.context?.propose_patch, undefined);
  });

  await test("understand hunt reads auth middleware source", async () => {
    const orchestrator = createAgentOrchestrator({
      indexBackend: createGoldenIndexBackend("positioned"),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async ({ path }) => readGoldenRepoFile(path)
    });
    const result = await orchestrator.run({
      message: "Explain the auth middleware",
      repoId: GOLDEN_REPO_ID
    });
    const files = (result.context?.read_file as { files?: Array<{ path: string; content: string }> } | undefined)
      ?.files;
    assert.ok(files && files.length > 0, "understand must read at least one file");
    assert.ok(
      files.some(
        (f) =>
          f.path.includes("auth") ||
          f.content.includes("require_auth") ||
          f.content.includes("AuthenticationMiddleware")
      ),
      `expected auth-related read, got ${files.map((f) => f.path).join(", ")}`
    );
  });

  await test("change request: search → read → propose_patch → Apply-ready text", async () => {
    const target = "server/auth/middleware.py";
    const fileBody = GOLDEN_REPO_FILES[target]!;
    const searchLine = "def require_auth(view):";
    const replaceLine = "def require_auth(view, *, optional=False):";
    assert.ok(fileBody.includes(searchLine));

    const orchestrator = createAgentOrchestrator({
      indexBackend: createGoldenIndexBackend("positioned"),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async ({ path }) => readGoldenRepoFile(path)
    });

    let round = 0;
    const result = await orchestrator.run(
      {
        message: "Add an optional flag to requireAuth in the auth middleware",
        repoId: GOLDEN_REPO_ID,
        maxSteps: 6
      },
      {
        planTurn: async () => {
          round += 1;
          if (round === 1) {
            return JSON.stringify({ tool: "search_code", args: { query: "requireAuth" } });
          }
          if (round === 2) {
            return JSON.stringify({
              tool: "read_file",
              args: { path: target, startLine: 1, endLine: 400 }
            });
          }
          if (round === 3) {
            return JSON.stringify({
              tool: "propose_patch",
              args: {
                files: [{ path: target, search: searchLine, replace: replaceLine }]
              }
            });
          }
          return JSON.stringify({ done: true });
        }
      }
    );

    assert.ok(result.steps.some((s) => s.tool === "search_code"), "change must search first");
    assert.ok(result.steps.some((s) => s.tool === "read_file"), "change must read before patching");
    assert.ok(result.steps.some((s) => s.tool === "propose_patch"), "change must call propose_patch");

    const proposed = result.context?.propose_patch as
      | { ok?: boolean; patchText?: string; applied?: boolean }
      | undefined;
    assert.equal(proposed?.ok, true, JSON.stringify(proposed));
    assert.equal(proposed?.applied, false);
    assert.ok(proposed?.patchText && /<<<<<<< SEARCH/.test(proposed.patchText));
    assert.ok(findAllSearchMatches(fileBody, searchLine).length > 0);

    const bundle = [{ data: { agentTools: result.context } }];
    const extracted = extractAgentProposedPatchText(bundle);
    assert.equal(extracted, proposed?.patchText);

    const answerOnly = "I added an optional flag to require_auth.";
    const merged = mergeAnswerWithAgentPatch(answerOnly, extracted);
    const parsed = parsePatchResponse(merged);
    assert.equal(parsed.ok, true, parsed.ok ? "" : parsed.error);
    if (parsed.ok) {
      assert.equal(parsed.patches.files[0]?.relativePath, target);
    }
  });

  await test("propose_patch rejects SEARCH that is not in the golden file", async () => {
    const orchestrator = createAgentOrchestrator({
      indexBackend: createGoldenIndexBackend("positioned"),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async ({ path }) => readGoldenRepoFile(path)
    });
    const raw = await orchestrator.executeTool("propose_patch", {
      files: [
        {
          path: "server/auth/middleware.py",
          search: "def definitely_not_in_this_file():",
          replace: "def noop():"
        }
      ]
    });
    const parsed = JSON.parse(raw) as { ok: boolean; error?: string };
    assert.equal(parsed.ok, false);
    assert.match(parsed.error ?? "", /not found/i);
  });

  await test("locate hunt does not call propose_patch", async () => {
    const orchestrator = createAgentOrchestrator({
      indexBackend: createGoldenIndexBackend("positioned"),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async ({ path }) => readGoldenRepoFile(path)
    });
    const result = await orchestrator.run({
      message: "Where is requireAuth defined in this repo?",
      repoId: GOLDEN_REPO_ID
    });
    assert.ok(!result.steps.some((s) => s.tool === "propose_patch"));
    assert.equal(result.context?.propose_patch, undefined);
  });

  console.log(`\nagentScopeEval: ${passed}/${passed + failed} tests passed`);
  if (failed > 0) {
    console.error("FAIL S-G1..S-G4 / PB-G1..PB-G5 — see failures above");
    process.exit(1);
  }
  console.log("PASS S-G1 S-G2 S-G3 PB-G1 PB-G2 PB-G3 PB-G4 PB-G5 (scope + patch bridge eval)");
}

void main();
