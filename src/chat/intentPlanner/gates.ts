/**
 * Pass/fail gate definitions for Chat Intent Planner phases.
 * Each gate is a named criterion; phase gate tests assert all PASS.
 */
export type GateVerdict = "PASS" | "FAIL";

export type GateResult = {
  id: string;
  phase: 1 | 2 | 3;
  title: string;
  verdict: GateVerdict;
  detail?: string;
};

export function gatePass(
  phase: 1 | 2 | 3,
  id: string,
  title: string,
  detail?: string
): GateResult {
  return { id, phase, title, verdict: "PASS", detail };
}

export function gateFail(
  phase: 1 | 2 | 3,
  id: string,
  title: string,
  detail: string
): GateResult {
  return { id, phase, title, verdict: "FAIL", detail };
}

export function assertAllGatesPass(results: GateResult[], phaseLabel: string): void {
  const failed = results.filter((r) => r.verdict === "FAIL");
  if (failed.length > 0) {
    const lines = failed.map((f) => `- [${f.id}] ${f.title}: ${f.detail ?? "failed"}`);
    throw new Error(`${phaseLabel} gates FAILED:\n${lines.join("\n")}`);
  }
}

/** Human-readable criteria — mirrored by phase*.gates.test.ts */
export const PHASE1_GATE_CRITERIA = [
  {
    id: "P1-G1",
    title: "Named tool in plain chat → tools allowlist includes that provider"
  },
  {
    id: "P1-G2",
    title: "Unnamed local explain ask → empty tools (no over-fetch)"
  },
  {
    id: "P1-G3",
    title: "Named tools stay planned even when disconnected"
  },
  {
    id: "P1-G4",
    title: "requestAllowsIntegrationFetch honors fetchIntegrations allowlist"
  },
  {
    id: "P1-G5",
    title: "Multi-tool synthesis prompt includes all planned tool sections"
  },
  {
    id: "P1-G6",
    title: "Single-route integrationProvider is NOT set when 2+ tools planned"
  }
] as const;

export const PHASE2_GATE_CRITERIA = [
  {
    id: "P2-G1",
    title: "Blast-shaped ask + open file → workflow blast-radius, execution silent"
  },
  {
    id: "P2-G2",
    title: "Compound Blast + Jira → workflow + tools together"
  },
  {
    id: "P2-G3",
    title: "Medium-confidence workflow without tools → confirm (suggest-chips)"
  },
  {
    id: "P2-G4",
    title: "Model plan parser accepts compound workflow+tools JSON"
  },
  {
    id: "P2-G5",
    title: "resolveChatIntentExecution maps silent → run-workflow path"
  },
  {
    id: "P2-G6",
    title: "Fail-open: invalid model JSON does not force a workflow"
  }
] as const;

export const PHASE3_GATE_CRITERIA = [
  {
    id: "P3-G1",
    title: "Status line names workflow + tools (Checking change impact + Jira)"
  },
  {
    id: "P3-G2",
    title: "Activity messages include workflow + each tool label"
  },
  {
    id: "P3-G3",
    title: "Trust preamble wraps status for synthesis context"
  },
  {
    id: "P3-G4",
    title: "mode none → no status / no activity (silence)"
  }
] as const;
