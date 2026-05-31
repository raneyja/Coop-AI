import type { OwnershipGraphEngine } from "./ownershipGraph";

let registeredEngine: OwnershipGraphEngine | undefined;

export function registerOwnershipGraphEngine(engine: OwnershipGraphEngine): void {
  registeredEngine = engine;
}

export function getOwnershipGraphEngine(): OwnershipGraphEngine | undefined {
  return registeredEngine;
}
