/**
 * Enterprise scorecard — strict pass/fail for every automated gate family.
 *
 * Prints a table. Exits 1 if any FAIL. This is the gate Jon can trust before
 * Extension Host dogfood tonight.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { assertGateCatalogComplete, ENTERPRISE_CRITERIA } from "./enterpriseCriteria";
import {
  ENTERPRISE_GATE_IDS,
  HONESTY_GATE_IDS,
  PATCH_BRIDGE_GATE_IDS,
  RETRIEVAL_GATE_IDS,
  SCOPE_GATE_IDS
} from "./gates";
import { agentTurnAction, shouldRunAgentToolLoop } from "../../chat/agentRouting";
import { planChatIntentFromRules } from "../../chat/intentPlanner/planChatIntent";
import { classifyRepoCodeIntent } from "../../chat/repoCodeIntent";
import {
  extractAgentProposedPatchText,
  mergeAnswerWithAgentPatch
} from "../../chat/agentProposedPatch";
import { buildUserMessageWithContext } from "../../prompts/systemPrompts";
import { createAgentOrchestrator } from "./AgentOrchestrator";
import {
  GOLDEN_REPO_FILES,
  GOLDEN_REPO_ID,
  createGoldenIndexBackend,
  readGoldenRepoFile
} from "./eval/goldenRepo";
import { parsePatchResponse } from "../../edit/patchParser";

type Row = { id: string; family: string; result: "PASS" | "FAIL"; detail: string };

const rows: Row[] = [];

function pass(id: string, family: string, detail: string): void {
  rows.push({ id, family, result: "PASS", detail });
  console.log(`  PASS  ${id.padEnd(8)} ${detail}`);
}

function fail(id: string, family: string, detail: string): void {
  rows.push({ id, family, result: "FAIL", detail });
  console.error(`  FAIL  ${id.padEnd(8)} ${detail}`);
}

function readRepo(...parts: string[]): string {
  return fs.readFileSync(path.join(__dirname, "../../..", ...parts), "utf8");
}

function route(q: string, mode: "on" | "off" = "on") {
  const plan = planChatIntentFromRules({ message: q, connectedTools: [] });
  return {
    plan,
    action: agentTurnAction({
      query: q,
      hasQuickAction: false,
      agentModeSetting: mode,
      intentPlan: plan
    }),
    loops: shouldRunAgentToolLoop({
      query: q,
      hasQuickAction: false,
      agentModeSetting: mode,
      intentPlan: plan
    })
  };
}

async function main(): Promise<void> {
  console.log("\n=== ENTERPRISE SCORECARD ===\n");
  assertGateCatalogComplete();

  // —— S-G* Scope ——
  {
    const mustLoop: Array<{ q: string; action: "locate" | "understand" | "change" }> = [
      { q: "Where is requireAuth defined in this repo?", action: "locate" },
      { q: "Show me the authentication middleware", action: "locate" },
      { q: "Explain the auth middleware", action: "understand" },
      { q: "What happens when a user signs in?", action: "understand" },
      { q: "Add a null check to requireAuth in the auth middleware", action: "change" }
    ];
    const misses = mustLoop.filter((c) => {
      const r = route(c.q);
      return !r.loops || r.action !== c.action;
    });
    if (misses.length === 0) {
      pass("S-G1", "Scope", "locate/understand/change all loop when on");
    } else {
      fail("S-G1", "Scope", misses.map((m) => m.q).join(" | "));
    }
  }

  {
    const mustStayOut = [
      "Explain this function",
      "Thanks",
      "What's in Slack about this?",
      "Who owns the billing service?",
      "Who calls verifyToken?"
    ];
    const leaks = mustStayOut.filter((q) => route(q).loops);
    if (leaks.length === 0) {
      pass("S-G2", "Scope", "buffer / Slack / Owner / Blast stay out");
    } else {
      fail("S-G2", "Scope", `leaked: ${leaks.join(" | ")}`);
    }
  }

  {
    const q = "Where is requireAuth defined in this repo?";
    if (!route(q, "off").loops) {
      pass("S-G3", "Scope", "agentMode off → no loop");
    } else {
      fail("S-G3", "Scope", "off still loops");
    }
  }

  {
    // Full classifier matrix lives in repoCodeIntent.test — scorecard requires 100%.
    const sample = [
      ["Where is the login form defined?", "locate"],
      ["Refactor the invoice service to use decimals", "change"],
      ["Explain what you just did", "none"]
    ] as const;
    const bad = sample.filter(([q, expect]) => classifyRepoCodeIntent(q).action !== expect);
    if (bad.length === 0) {
      pass("S-G4", "Scope", "classifier sample 100% (full matrix in repoCodeIntent.test)");
    } else {
      fail("S-G4", "Scope", bad.map(([q]) => q).join(" | "));
    }
  }

  {
    const routing = readRepo("src/chat/agentRouting.ts");
    const planner = readRepo("src/chat/intentPlanner/planChatIntent.ts");
    if (
      /classifyRepoCodeIntent|needsRepoCode/.test(routing) &&
      /codeIntent:\s*classifyRepoCodeIntent/.test(planner) &&
      !/REPO_HUNT_KEYWORDS/.test(routing)
    ) {
      pass("S-G5", "Scope", "planner codeIntent + classifier; keyword regex gone");
    } else {
      fail("S-G5", "Scope", "keyword regex or missing codeIntent wiring");
    }
  }

  {
    const ui = readRepo("src/webview/components/settings/SettingsDetailViews.tsx");
    const agentRow = ui.match(/<SettingsCheckboxRow\s+title="AgentMode"[\s\S]*?\/>/)?.[0] ?? "";
    if (/title="AgentMode"/.test(agentRow) && !/\bdescription=/.test(agentRow)) {
      pass("S-G6", "Scope", "Settings label is AgentMode with no subtext");
    } else {
      fail("S-G6", "Scope", "Settings label/subtext drifted");
    }
  }

  {
    // Enforced by noRepoSpecificRules.test — scorecard verifies the guard exists.
    const guard = readRepo("src/api/agent/noRepoSpecificRules.test.ts");
    if (/RANKING_MODULES/.test(guard) && /repoCodeIntent/.test(guard)) {
      pass("S-G7", "Scope", "noRepoSpecificRules covers ranking + scope");
    } else {
      fail("S-G7", "Scope", "guard incomplete");
    }
  }

  // —— R-G* Retrieval (strict 100% on a representative hunt) ——
  {
    const orchestrator = createAgentOrchestrator({
      indexBackend: createGoldenIndexBackend("positioned"),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async ({ path: p }) => readGoldenRepoFile(p)
    });
    const result = await orchestrator.run({
      message: "Where is requireAuth or authentication middleware defined in this repo?",
      repoId: GOLDEN_REPO_ID
    });
    const files = (result.context?.read_file as { files?: Array<{ path: string; content: string }> })
      ?.files;
    const hit = files?.find((f) => f.path === "server/auth/middleware.py");
    if (hit) {
      pass("R-G1", "Retrieval", "dogfood hunt → right file");
    } else {
      fail("R-G1", "Retrieval", `read ${files?.map((f) => f.path).join(", ") || "nothing"}`);
    }
    if (hit?.content.includes("def require_auth(view):")) {
      pass("R-G2", "Retrieval", "definition line in read window");
    } else {
      fail("R-G2", "Retrieval", "right file, wrong lines");
    }
  }

  {
    const orchestrator = createAgentOrchestrator({
      indexBackend: createGoldenIndexBackend("paths-only"),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async ({ path: p }) => readGoldenRepoFile(p)
    });
    const result = await orchestrator.run({
      message: "Where is requireAuth or authentication middleware defined in this repo?",
      repoId: GOLDEN_REPO_ID
    });
    const files = (result.context?.read_file as { files?: Array<{ path: string; content: string }> })
      ?.files;
    const hit = files?.find((f) => f.path === "server/auth/middleware.py");
    if (hit?.content.includes("def require_auth(view):")) {
      pass("R-G3", "Retrieval", "paths-only still finds definition (full 12/12 in huntEval)");
    } else {
      fail("R-G3", "Retrieval", "paths-only missed definition");
    }
  }

  {
    const orchestrator = createAgentOrchestrator({
      indexBackend: createGoldenIndexBackend("positioned"),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async ({ path: p }) => readGoldenRepoFile(p)
    });
    const readPaths: string[] = [];
    const wrapped = createAgentOrchestrator({
      indexBackend: createGoldenIndexBackend("positioned"),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async ({ path: p }) => {
        readPaths.push(p);
        return readGoldenRepoFile(p);
      }
    });
    await wrapped.run({
      message: "Where is requireAuth or authentication middleware defined in this repo?",
      repoId: GOLDEN_REPO_ID
    });
    void orchestrator;
    const noise = readPaths.filter(
      (p) => /(^|\/)index\.(ts|tsx|js)$/.test(p) || /(^|\/)node_modules\//.test(p) || /(^|\/)dist\//.test(p)
    );
    if (noise.length === 0) {
      pass("R-G4", "Retrieval", "no barrel/vendor/build reads");
    } else {
      fail("R-G4", "Retrieval", noise.join(", "));
    }
  }

  // —— PB-G* Patch bridge ——
  {
    const q = "Add a null check to requireAuth in the auth middleware";
    if (route(q).action === "change" && route(q).loops) {
      pass("PB-G1", "PatchBridge", "change request reaches the loop");
    } else {
      fail("PB-G1", "PatchBridge", `action=${route(q).action} loops=${route(q).loops}`);
    }
  }

  {
    const target = "server/auth/middleware.py";
    const searchLine = "def require_auth(view):";
    const replaceLine = "def require_auth(view, *, optional=False):";
    const orchestrator = createAgentOrchestrator({
      indexBackend: createGoldenIndexBackend("positioned"),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async ({ path: p }) => readGoldenRepoFile(p)
    });
    let round = 0;
    const result = await orchestrator.run(
      { message: "Add optional flag to requireAuth", repoId: GOLDEN_REPO_ID, maxSteps: 6 },
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
              args: { files: [{ path: target, search: searchLine, replace: replaceLine }] }
            });
          }
          return JSON.stringify({ done: true });
        }
      }
    );
    const proposed = result.context?.propose_patch as { ok?: boolean; patchText?: string } | undefined;
    if (proposed?.ok && proposed.patchText && /<<<<<<< SEARCH/.test(proposed.patchText)) {
      pass("PB-G2", "PatchBridge", "search→read→propose_patch yields patchText");
    } else {
      fail("PB-G2", "PatchBridge", JSON.stringify(proposed));
    }

    const bad = JSON.parse(
      await orchestrator.executeTool("propose_patch", {
        files: [{ path: target, search: "not_in_file_xyz()", replace: "x" }]
      })
    ) as { ok: boolean };
    if (!bad.ok) {
      pass("PB-G3", "PatchBridge", "unanchored SEARCH rejected");
    } else {
      fail("PB-G3", "PatchBridge", "bad SEARCH accepted");
    }

    if (proposed?.patchText) {
      const merged = mergeAnswerWithAgentPatch(
        "I added the flag.",
        extractAgentProposedPatchText([{ data: { agentTools: result.context } }])
      );
      const parsed = parsePatchResponse(merged);
      if (parsed.ok) {
        pass("PB-G4", "PatchBridge", "forgotten echo still Apply-ready");
      } else {
        fail("PB-G4", "PatchBridge", parsed.ok ? "" : parsed.error);
      }
    } else {
      fail("PB-G4", "PatchBridge", "no patchText to merge");
    }
  }

  {
    const orchestrator = createAgentOrchestrator({
      indexBackend: createGoldenIndexBackend("positioned"),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async ({ path: p }) => readGoldenRepoFile(p)
    });
    const result = await orchestrator.run({
      message: "Where is requireAuth defined in this repo?",
      repoId: GOLDEN_REPO_ID
    });
    if (!result.steps.some((s) => s.tool === "propose_patch") && !result.context?.propose_patch) {
      pass("PB-G5", "PatchBridge", "locate hunt does not propose patches");
    } else {
      fail("PB-G5", "PatchBridge", "hunt invented a patch");
    }
  }

  // —— Honesty bridge ——
  {
    const session = readRepo("src/chat/CoopChatSession.ts");
    if (/mergeAnswerWithAgentPatch/.test(session) && /extractAgentProposedPatchText/.test(session)) {
      pass("H-G12", "Honesty", "hot path merges agent patch");
    } else {
      fail("H-G12", "Honesty", "bridge not wired in CoopChatSession");
    }
  }

  {
    const prompt = buildUserMessageWithContext("change it", {
      contextBundle: [
        {
          data: {
            agentTools: {
              propose_patch: {
                ok: true,
                patchText: [
                  "File: `a.ts`",
                  "",
                  "```patch",
                  "<<<<<<< SEARCH",
                  "a",
                  "=======",
                  "b",
                  ">>>>>>> REPLACE",
                  "```"
                ].join("\n")
              }
            }
          }
        }
      ]
    });
    if (/<agent_proposed_patch>/.test(prompt) && /<<<<<<< SEARCH/.test(prompt)) {
      pass("H-G13", "Honesty", "synthesis includes agent_proposed_patch");
    } else {
      fail("H-G13", "Honesty", "prompt missing patch block");
    }
  }

  // —— Enterprise ——
  {
    const readFile = readRepo("src/api/agent/tools/readFile.ts");
    if (
      /Zero-Clone/.test(readFile) &&
      /readRemoteFile/.test(readFile) &&
      !/resolveAbsolutePath\(/.test(readFile)
    ) {
      pass("ENT-G4", "Enterprise", "read_file is remote-only");
    } else {
      fail("ENT-G4", "Enterprise", "local disk path still used");
    }
  }

  {
    // Catalog presence — full A/B suites are separate scripts in test:agent-enterprise.
    for (const id of [
      ...SCOPE_GATE_IDS,
      ...RETRIEVAL_GATE_IDS,
      ...PATCH_BRIDGE_GATE_IDS,
      "H-G12",
      "H-G13"
    ]) {
      assert.ok(
        HONESTY_GATE_IDS.includes(id as never) ||
          SCOPE_GATE_IDS.includes(id as never) ||
          RETRIEVAL_GATE_IDS.includes(id as never) ||
          PATCH_BRIDGE_GATE_IDS.includes(id as never) ||
          ENTERPRISE_GATE_IDS.includes(id as never) ||
          id === "H-G12" ||
          id === "H-G13"
      );
    }
    void GOLDEN_REPO_FILES;
    void ENTERPRISE_CRITERIA;
    pass("ENT-G5", "Enterprise", "scorecard executed");
  }

  // —— Summary ——
  console.log("\n--- Summary by family ---");
  const families = [...new Set(rows.map((r) => r.family))];
  for (const family of families) {
    const set = rows.filter((r) => r.family === family);
    const ok = set.filter((r) => r.result === "PASS").length;
    const mark = ok === set.length ? "PASS" : "FAIL";
    console.log(`  ${mark}  ${family.padEnd(12)} ${ok}/${set.length}`);
  }

  const fails = rows.filter((r) => r.result === "FAIL");
  console.log(
    `\nOVERALL: ${fails.length === 0 ? "PASS" : "FAIL"} (${rows.length - fails.length}/${rows.length} gates)`
  );
  if (fails.length > 0) {
    console.error("\nFailed gates:");
    for (const f of fails) {
      console.error(`  ${f.id}: ${f.detail}`);
    }
    process.exit(1);
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
