/**
 * Pass/fail gate IDs for the agent ship loop (Wave 1+).
 * Phase tests assert these; see docs/agent-ship-loop-build-plan.md.
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
