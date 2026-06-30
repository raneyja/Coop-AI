import type { AutocompleteTelemetryEvent } from "./types";

export type LatencyBreakdown = {
  assemblyMs: number;
  networkMs: number;
  parseMs: number;
  totalMs: number;
};

export type PerformanceSnapshot = {
  requestCount: number;
  acceptCount: number;
  rejectCount: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  lastLatencyMs: number;
  alertThresholdMs: number;
};

const LATENCY_ALERT_MS = 600;
const MAX_SAMPLES = 200;

export class AutocompletePerformanceMonitor {
  private readonly latencies: number[] = [];
  private requestCount = 0;
  private acceptCount = 0;
  private rejectCount = 0;
  private lastLatencyMs = 0;
  private readonly listeners: Array<(event: AutocompleteTelemetryEvent) => void> = [];

  public recordRequest(breakdown: LatencyBreakdown, languageId?: string): void {
    this.requestCount += 1;
    this.lastLatencyMs = breakdown.totalMs;
    this.pushLatency(breakdown.totalMs);
    this.emit({ kind: "request", latencyMs: breakdown.totalMs, languageId });
    if (breakdown.totalMs > LATENCY_ALERT_MS) {
      console.warn(
        `[CoopAI autocomplete] Latency ${breakdown.totalMs}ms exceeded ${LATENCY_ALERT_MS}ms (assembly=${breakdown.assemblyMs}, network=${breakdown.networkMs}, parse=${breakdown.parseMs})`
      );
    }
  }

  public recordAccept(languageId?: string): void {
    this.acceptCount += 1;
    this.emit({ kind: "accept", languageId });
  }

  public recordReject(reason: string, languageId?: string): void {
    this.rejectCount += 1;
    this.emit({ kind: "reject", reason, languageId });
  }

  public onEvent(listener: (event: AutocompleteTelemetryEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index >= 0) {
        this.listeners.splice(index, 1);
      }
    };
  }

  public getRollingP50(): number {
    return percentile([...this.latencies].sort((a, b) => a - b), 0.5);
  }

  public getRollingP95(): number {
    return percentile([...this.latencies].sort((a, b) => a - b), 0.95);
  }

  public snapshot(): PerformanceSnapshot {
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const p50 = percentile(sorted, 0.5);
    const p95 = percentile(sorted, 0.95);
    return {
      requestCount: this.requestCount,
      acceptCount: this.acceptCount,
      rejectCount: this.rejectCount,
      p50LatencyMs: p50,
      p95LatencyMs: p95,
      lastLatencyMs: this.lastLatencyMs,
      alertThresholdMs: LATENCY_ALERT_MS
    };
  }

  public recordShow(languageId?: string): void {
    this.emit({ kind: "show", languageId });
  }

  public acceptanceRate(): number {
    const total = this.acceptCount + this.rejectCount;
    if (total === 0) {
      return 0;
    }
    return this.acceptCount / total;
  }

  private pushLatency(ms: number): void {
    this.latencies.push(ms);
    if (this.latencies.length > MAX_SAMPLES) {
      this.latencies.shift();
    }
  }

  private emit(event: AutocompleteTelemetryEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

export function createLatencyTimer(): {
  markAssembly: () => void;
  markNetworkStart: () => void;
  markNetworkEnd: () => void;
  markParseEnd: () => void;
  finish: () => LatencyBreakdown;
} {
  const started = Date.now();
  let assemblyMs = 0;
  let networkMs = 0;
  let parseMs = 0;
  let networkStart = 0;

  return {
    markAssembly: () => {
      assemblyMs = Date.now() - started;
    },
    markNetworkStart: () => {
      networkStart = Date.now();
    },
    markNetworkEnd: () => {
      networkMs = Date.now() - networkStart;
    },
    markParseEnd: () => {
      parseMs = Date.now() - (networkStart ? networkStart + networkMs : started);
    },
    finish: () => ({
      assemblyMs,
      networkMs,
      parseMs,
      totalMs: Date.now() - started
    })
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[index] ?? 0;
}

/** In-memory cache: context hash → suggestion text */
export class CompletionCache {
  private readonly map = new Map<string, { text: string; alternatives: string[]; at: number }>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;

  public constructor(maxEntries = 64, ttlMs = 30_000) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
  }

  public get(hash: string): { text: string; alternatives: string[] } | undefined {
    const entry = this.map.get(hash);
    if (!entry) {
      return undefined;
    }
    if (Date.now() - entry.at > this.ttlMs) {
      this.map.delete(hash);
      return undefined;
    }
    return { text: entry.text, alternatives: entry.alternatives };
  }

  public set(hash: string, text: string, alternatives: string[] = []): void {
    if (this.map.size >= this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest) {
        this.map.delete(oldest);
      }
    }
    this.map.set(hash, { text, alternatives, at: Date.now() });
  }

  public clear(): void {
    this.map.clear();
  }
}
