/**
 * Pass/fail gate IDs for the agent ship loop (Wave 1+).
 * Phase tests assert these; see docs/agent-ship-loop-build-plan.md
 * and enterpriseCriteria.ts for the exact Pass / Fail rule per ID.
 */

export const PHASE_A_GATE_IDS = [
  "A-G0",
  "A-G1",
  "A-G2",
  "A-G3",
  "A-G4",
  "A-G5",
  "A-G6",
  "A-G7",
  "A-G8"
] as const;

export const PHASE_A_PRESSURE_IDS = [
  "A-P1",
  "A-P2",
  "A-P3",
  "A-P4",
  "A-P5",
  "A-P6",
  "A-P7",
  "A-P8",
  "A-P9",
  "A-P10",
  "A-P11",
  "A-P12",
  "A-P13",
  "A-P14"
] as const;

export const UX_FREEZE_GATE_IDS = [
  "UX-G1",
  "UX-G2",
  "UX-G3",
  "UX-G4",
  "UX-G5",
  "UX-G6",
  "UX-G7",
  "UX-G8",
  "UX-G9",
  "UX-G10",
  "UX-G11",
  "UX-G12"
] as const;

export const PHASE_B_GATE_IDS = ["B-G1", "B-G2", "B-G3", "B-G4", "B-G5", "B-G6", "B-G7"] as const;
export const PHASE_B_PRESSURE_IDS = ["B-P1", "B-P2", "B-P3", "B-P4", "B-P5", "B-P6"] as const;
export const PHASE_C_GATE_IDS = ["C-G1", "C-G2", "C-G3", "C-G4", "C-G5", "C-G6"] as const;
export const PHASE_D_GATE_IDS = ["D-G1", "D-G2", "D-G3", "D-G4", "D-G5", "D-G6"] as const;
export const PHASE_E_GATE_IDS = ["E-G1", "E-G2", "E-G3", "E-G4", "E-G5", "E-G6"] as const;
export const JOIN_GATE_IDS = [
  "J-G1",
  "J-G2",
  "J-G3",
  "J-G4",
  "J-G5",
  "J-G6",
  "J-G7",
  "J-G8"
] as const;

/**
 * “We built the agent” is a lie unless these pass.
 * Dogfood must be reachable from Coop Settings, persist, run the hunt, and
 * show Searched/Read — not only a vscode contributes.configuration key.
 */
export const HONESTY_GATE_IDS = [
  "H-G1",
  "H-G2",
  "H-G3",
  "H-G4",
  "H-G5",
  "H-G6",
  "H-G7",
  "H-G8",
  "H-G9",
  "H-G10",
  "H-G11",
  "H-G12",
  "H-G13",
  "H-G14"
] as const;

/**
 * Scope — what turns run the agent. Replaced the keyword regex.
 * Fail any of these and shipping “agent for repo questions” is a lie.
 */
export const SCOPE_GATE_IDS = [
  "S-G1",
  "S-G2",
  "S-G3",
  "S-G4",
  "S-G5",
  "S-G6",
  "S-G7",
  "S-G8"
] as const;

/**
 * Retrieval accuracy — golden-repo hunt eval. Threshold is 100%.
 */
export const RETRIEVAL_GATE_IDS = ["R-G1", "R-G2", "R-G3", "R-G4"] as const;

/**
 * Change → propose_patch → Apply card. Fail = change requests are unreachable.
 */
export const PATCH_BRIDGE_GATE_IDS = ["PB-G1", "PB-G2", "PB-G3", "PB-G4", "PB-G5"] as const;

/** Enterprise roll-up — must all Pass before Extension Host dogfood. */
export const ENTERPRISE_GATE_IDS = [
  "ENT-G1",
  "ENT-G2",
  "ENT-G3",
  "ENT-G4",
  "ENT-G5"
] as const;
