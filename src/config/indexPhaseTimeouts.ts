/**
 * Split Deep-Index phase budgets. JOBS_MAX_DURATION_MS must cover the sum of
 * the critical path (clone → SCIP → Zoekt → embeddings) with headroom.
 */
export type IndexPhaseTimeouts = {
  cloneMs: number;
  scipMs: number;
  zoektMs: number;
  embedMs: number;
};

const DEFAULTS: IndexPhaseTimeouts = {
  cloneMs: 600_000,
  scipMs: 900_000,
  zoektMs: 600_000,
  embedMs: 600_000
};

export function readIndexPhaseTimeouts(env: NodeJS.ProcessEnv = process.env): IndexPhaseTimeouts {
  return {
    cloneMs: readNumber(env.INDEX_CLONE_TIMEOUT_MS, DEFAULTS.cloneMs),
    scipMs: readNumber(env.INDEX_SCIP_TIMEOUT_MS, DEFAULTS.scipMs),
    zoektMs: readNumber(env.INDEX_ZOEKT_TIMEOUT_MS, DEFAULTS.zoektMs),
    embedMs: readNumber(env.INDEX_EMBED_TIMEOUT_MS, DEFAULTS.embedMs)
  };
}

function readNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
