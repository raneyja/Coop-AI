import type { BlastRadiusAnalysisEngine } from "./blastRadiusAnalysis";

let registeredEngine: BlastRadiusAnalysisEngine | undefined;

export function registerBlastRadiusAnalysisEngine(engine: BlastRadiusAnalysisEngine): void {
  registeredEngine = engine;
}

export function getBlastRadiusAnalysisEngine(): BlastRadiusAnalysisEngine | undefined {
  return registeredEngine;
}
