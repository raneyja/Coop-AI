import type { DecisionArchaeologyEngine } from "./decisionArchaeology";

let registeredEngine: DecisionArchaeologyEngine | undefined;

export function registerDecisionArchaeologyEngine(engine: DecisionArchaeologyEngine): void {
  registeredEngine = engine;
}

export function getDecisionArchaeologyEngine(): DecisionArchaeologyEngine | undefined {
  return registeredEngine;
}
