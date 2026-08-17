/**
 * Enterprise pass/fail criteria — one rule per gate ID.
 *
 * Automated tests must enforce these. A green suite with a soft assertion that
 * does not match the Fail column is still a FAIL for ship.
 */
import {
  ENTERPRISE_GATE_IDS,
  HONESTY_GATE_IDS,
  JOIN_GATE_IDS,
  PATCH_BRIDGE_GATE_IDS,
  PHASE_A_GATE_IDS,
  PHASE_B_GATE_IDS,
  PHASE_C_GATE_IDS,
  PHASE_D_GATE_IDS,
  PHASE_E_GATE_IDS,
  RETRIEVAL_GATE_IDS,
  SCOPE_GATE_IDS,
  UX_FREEZE_GATE_IDS
} from "./gates";

export type GateCriterion = {
  id: string;
  family: string;
  pass: string;
  fail: string;
  /** How we prove it without Extension Host. */
  evidence: "automated" | "source" | "manual";
};

export const ENTERPRISE_CRITERIA: GateCriterion[] = [
  // —— Scope ——
  {
    id: "S-G1",
    family: "Scope",
    pass: "Locate / understand / change questions always run the agent (no user toggle)",
    fail: "Only keyword-hunt wording loops; show-me / explain-the-X / change asks fall through",
    evidence: "automated"
  },
  {
    id: "S-G2",
    family: "Scope",
    pass: "Explain this function / Thanks / Slack-only / Owner / Blast stay out of the loop",
    fail: "Buffer explains or integrations start Searched/Read",
    evidence: "automated"
  },
  {
    id: "S-G3",
    family: "Scope",
    pass: "No AgentMode Settings control; hunts always loop",
    fail: "User-facing on/off still exists, or hunts require a toggle",
    evidence: "automated"
  },
  {
    id: "S-G4",
    family: "Scope",
    pass: "Routing eval ≥ 100% on the labeled matrix (no soft ~ marks)",
    fail: "Any labeled case misroutes",
    evidence: "automated"
  },
  {
    id: "S-G5",
    family: "Scope",
    pass: "Intent planner attaches codeIntent; routing uses planner + classifier (not a second keyword list)",
    fail: "Keyword regex still decides the loop",
    evidence: "source"
  },
  {
    id: "S-G6",
    family: "Scope",
    pass: "Settings has no AgentMode checkbox",
    fail: "AgentMode toggle still shown",
    evidence: "source"
  },
  {
    id: "S-G7",
    family: "Scope",
    pass: "No repo-/framework-specific path rules in ranking or scope code",
    fail: "Hardcoded product folders or frameworks in retrieval",
    evidence: "automated"
  },
  {
    id: "S-G8",
    family: "Scope",
    pass: "Compound hunt + Slack/Jira: agent loops; allowlisted mid-loop search_* tools; Slack-only stays out",
    fail: "Hunt+Slack drops the loop, or mid-loop can call tools off the allowlist",
    evidence: "automated"
  },

  // —— Retrieval ——
  {
    id: "R-G1",
    family: "Retrieval",
    pass: "Golden hunt: right file 100% with positioned index",
    fail: "Any miss on file choice",
    evidence: "automated"
  },
  {
    id: "R-G2",
    family: "Retrieval",
    pass: "Golden hunt: definition line in read window 100% (positioned)",
    fail: "Right file, wrong lines (2026-08-13 failure mode)",
    evidence: "automated"
  },
  {
    id: "R-G3",
    family: "Retrieval",
    pass: "Golden hunt: right file + definition 100% with paths-only index",
    fail: "Paths-only regime regresses below 100%",
    evidence: "automated"
  },
  {
    id: "R-G4",
    family: "Retrieval",
    pass: "Never reads barrels / vendor / build output as evidence",
    fail: "Noise paths appear in readPaths",
    evidence: "automated"
  },

  // —— Patch bridge ——
  {
    id: "PB-G1",
    family: "PatchBridge",
    pass: "Change requests reach agentTurnAction === change",
    fail: "Change asks stay on old chat",
    evidence: "automated"
  },
  {
    id: "PB-G2",
    family: "PatchBridge",
    pass: "search → read → propose_patch produces ok patchText with SEARCH/REPLACE",
    fail: "propose_patch unreachable or returns ok:false on valid hunk",
    evidence: "automated"
  },
  {
    id: "PB-G3",
    family: "PatchBridge",
    pass: "Unanchored SEARCH rejected; Apply matcher is the only match definition",
    fail: "Bad SEARCH reaches the user, or validator stricter than Apply",
    evidence: "automated"
  },
  {
    id: "PB-G4",
    family: "PatchBridge",
    pass: "Agent patchText merges into answer when model forgets to echo it",
    fail: "Patch only in agentTools; no Apply card",
    evidence: "automated"
  },
  {
    id: "PB-G5",
    family: "PatchBridge",
    pass: "Locate/understand never call propose_patch",
    fail: "Hunts invent edits",
    evidence: "automated"
  },

  // —— Honesty (product claims) ——
  {
    id: "H-G12",
    family: "Honesty",
    pass: "CoopChatSession merges agentProposedPatch before handlePatchComplete",
    fail: "Bridge helpers exist but are never called on the hot path",
    evidence: "source"
  },
  {
    id: "H-G13",
    family: "Honesty",
    pass: "Synthesis prompt includes <agent_proposed_patch> when present",
    fail: "Model never sees the validated patch",
    evidence: "automated"
  },
  {
    id: "H-G14",
    family: "Honesty",
    pass: "Hunt + Slack/Jira still runs the agent loop (named integration does not steal locate)",
    fail: "integrationProvider skips the hunt so the answer invents a path or dumps tickets",
    evidence: "source"
  },

  // —— Join (automated subset) ——
  {
    id: "J-G1",
    family: "Join",
    pass: "Apply session can enable Create PR; patch:create-pr handled",
    fail: "Create PR only works on fixtures",
    evidence: "source"
  },
  {
    id: "J-G3",
    family: "Join",
    pass: "npm run test:agent-ship and test:agent-ship:pressure exist and are wired",
    fail: "Scripts missing",
    evidence: "source"
  },
  {
    id: "J-G4",
    family: "Join",
    pass: "Quick actions never enter the agent tool loop",
    fail: "Trace/Owner feel like agent jobs",
    evidence: "automated"
  },
  {
    id: "J-G6",
    family: "Join",
    pass: "Defaults: Agent hunts always on (no toggle); NES off",
    fail: "AgentMode setting still exists, or NES on by default",
    evidence: "source"
  },

  // —— Enterprise roll-up ——
  {
    id: "ENT-G1",
    family: "Enterprise",
    pass: "test:agent-ship:a + b green",
    fail: "Any A/B gate red",
    evidence: "automated"
  },
  {
    id: "ENT-G2",
    family: "Enterprise",
    pass: "npm run lint green (same as CI)",
    fail: "Typecheck red",
    evidence: "automated"
  },
  {
    id: "ENT-G3",
    family: "Enterprise",
    pass: "Scope + Retrieval + PatchBridge gates all Pass at 100%",
    fail: "Any soft miss on core agent value",
    evidence: "automated"
  },
  {
    id: "ENT-G4",
    family: "Enterprise",
    pass: "Zero-Clone: agent read_file never prefers workspace disk",
    fail: "Local clone used for Use-repo intelligence",
    evidence: "source"
  },
  {
    id: "ENT-G5",
    family: "Enterprise",
    pass: "Enterprise scorecard printed with zero FAIL rows for automated gates",
    fail: "Scorecard incomplete or any FAIL",
    evidence: "automated"
  }
];

export function criteriaById(id: string): GateCriterion | undefined {
  return ENTERPRISE_CRITERIA.find((c) => c.id === id);
}

/** Every ID we claim to track must appear in gates.ts exports. */
export function assertGateCatalogComplete(): void {
  const known = new Set<string>([
    ...PHASE_A_GATE_IDS,
    ...PHASE_B_GATE_IDS,
    ...PHASE_C_GATE_IDS,
    ...PHASE_D_GATE_IDS,
    ...PHASE_E_GATE_IDS,
    ...JOIN_GATE_IDS,
    ...HONESTY_GATE_IDS,
    ...UX_FREEZE_GATE_IDS,
    ...SCOPE_GATE_IDS,
    ...RETRIEVAL_GATE_IDS,
    ...PATCH_BRIDGE_GATE_IDS,
    ...ENTERPRISE_GATE_IDS
  ]);
  for (const c of ENTERPRISE_CRITERIA) {
    if (!known.has(c.id) && !c.id.startsWith("H-G1") && !c.id.startsWith("J-G")) {
      // H-G12/13 and J-* are in HONESTY/JOIN; ENT/S/R/PB must be in their arrays.
      if (
        c.id.startsWith("S-") ||
        c.id.startsWith("R-") ||
        c.id.startsWith("PB-") ||
        c.id.startsWith("ENT-")
      ) {
        if (!known.has(c.id)) {
          throw new Error(`Criterion ${c.id} missing from gates.ts catalog`);
        }
      }
    }
  }
  for (const id of [...SCOPE_GATE_IDS, ...RETRIEVAL_GATE_IDS, ...PATCH_BRIDGE_GATE_IDS, ...ENTERPRISE_GATE_IDS]) {
    if (!ENTERPRISE_CRITERIA.some((c) => c.id === id)) {
      throw new Error(`Gate ${id} has no Pass/Fail criterion`);
    }
  }
}
