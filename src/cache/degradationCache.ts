import { cacheRetentionMs, type DegradationConfig } from "../config/degradationConfig";

export type CacheStatus = "fresh" | "warm" | "stale" | "very_stale";
export type CacheLayerName = "hot" | "warm" | "cold";

export type CachedResult<T = unknown> = {
  key: string;
  data: T;
  timestamp: number;
  provider?: string;
  feature?: string;
  metadata?: Record<string, unknown>;
};

export type DegradedResult<T = unknown> = {
  data: T;
  cached: true;
  cacheAge: string;
  cacheStatus: CacheStatus;
  message: string;
  refreshButton: boolean;
  sourceLayer: CacheLayerName;
};

export type CacheLayer<T = unknown> = {
  name: CacheLayerName;
  maxAgeMs: number;
  get: (key: string) => Promise<CachedResult<T> | undefined> | CachedResult<T> | undefined;
  set: (key: string, value: CachedResult<T>) => Promise<void> | void;
  delete?: (key: string) => Promise<void> | void;
  clear?: () => Promise<void> | void;
};

export type DegradationCacheOptions = {
  config: DegradationConfig;
  warmLayer?: CacheLayer;
  coldLayer?: CacheLayer;
  now?: () => number;
};

export interface DegradationCache {
  get<T = unknown>(key: string): Promise<DegradedResult<T> | undefined>;
  getRaw<T = unknown>(key: string): Promise<CachedResult<T> | undefined>;
  set<T = unknown>(key: string, data: T, metadata?: Omit<CachedResult<T>, "key" | "data" | "timestamp">): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}

export class MemoryCacheLayer<T = unknown> implements CacheLayer<T> {
  private readonly entries = new Map<string, CachedResult<T>>();

  public constructor(
    public readonly name: CacheLayerName,
    public readonly maxAgeMs: number
  ) {}

  public get(key: string): CachedResult<T> | undefined {
    const entry = this.entries.get(key);
    return entry ? cloneCached(entry) : undefined;
  }

  public set(key: string, value: CachedResult<T>): void {
    this.entries.set(key, cloneCached(value));
  }

  public delete(key: string): void {
    this.entries.delete(key);
  }

  public clear(): void {
    this.entries.clear();
  }
}

export class LayeredDegradationCache implements DegradationCache {
  private readonly hotLayer: CacheLayer;
  private readonly warmLayer: CacheLayer;
  private readonly coldLayer: CacheLayer;
  private readonly now: () => number;

  public constructor(options: DegradationCacheOptions) {
    const retention = cacheRetentionMs(options.config);
    this.hotLayer = new MemoryCacheLayer("hot", Math.max(retention.fresh, 5 * 60 * 1000));
    this.warmLayer = options.warmLayer ?? new MemoryCacheLayer("warm", Math.max(retention.warm, 60 * 60 * 1000));
    this.coldLayer = options.coldLayer ?? new MemoryCacheLayer("cold", Math.max(retention.stale, 24 * 60 * 60 * 1000));
    this.now = options.now ?? (() => Date.now());
  }

  public async get<T = unknown>(key: string): Promise<DegradedResult<T> | undefined> {
    const found = await this.lookup<T>(key);
    if (!found) {
      return undefined;
    }
    const cacheStatus = getCacheStatus(found.entry, this.now());
    return {
      data: found.entry.data,
      cached: true,
      cacheAge: formatCacheAge(found.entry.timestamp, this.now()),
      cacheStatus,
      message: buildCacheMessage(found.entry, cacheStatus, this.now()),
      refreshButton: cacheStatus !== "very_stale",
      sourceLayer: found.layer.name
    };
  }

  public async getRaw<T = unknown>(key: string): Promise<CachedResult<T> | undefined> {
    return (await this.lookup<T>(key))?.entry;
  }

  public async set<T = unknown>(
    key: string,
    data: T,
    metadata: Omit<CachedResult<T>, "key" | "data" | "timestamp"> = {}
  ): Promise<void> {
    const entry: CachedResult<T> = {
      ...metadata,
      key,
      data,
      timestamp: this.now()
    };
    await Promise.all([
      this.hotLayer.set(key, entry),
      this.warmLayer.set(key, entry),
      this.coldLayer.set(key, entry)
    ]);
  }

  public async delete(key: string): Promise<void> {
    await Promise.all([
      this.hotLayer.delete?.(key),
      this.warmLayer.delete?.(key),
      this.coldLayer.delete?.(key)
    ]);
  }

  public async clear(): Promise<void> {
    await Promise.all([
      this.hotLayer.clear?.(),
      this.warmLayer.clear?.(),
      this.coldLayer.clear?.()
    ]);
  }

  private async lookup<T>(key: string): Promise<{ entry: CachedResult<T>; layer: CacheLayer } | undefined> {
    for (const layer of [this.hotLayer, this.warmLayer, this.coldLayer]) {
      const entry = await layer.get(key);
      if (!entry || isExpired(entry, layer.maxAgeMs, this.now())) {
        continue;
      }
      return { entry: entry as CachedResult<T>, layer };
    }
    return undefined;
  }
}

export function getCacheStatus(cached: Pick<CachedResult, "timestamp">, now = Date.now()): CacheStatus {
  const age = now - cached.timestamp;
  if (age < 5 * 60 * 1000) {
    return "fresh";
  }
  if (age < 60 * 60 * 1000) {
    return "warm";
  }
  if (age < 24 * 60 * 60 * 1000) {
    return "stale";
  }
  return "very_stale";
}

export function formatCacheAge(timestamp: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) {
    return "less than a minute old";
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? "" : "s"} old`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} hour${hours === 1 ? "" : "s"} old`;
  }
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} old`;
}

export function degradationCacheKey(feature: string, parts: Array<string | number | undefined>): string {
  return [feature, ...parts.map((part) => String(part ?? "none").replace(/\s+/g, "_"))].join(":");
}

function buildCacheMessage(entry: CachedResult, status: CacheStatus, now: number): string {
  const provider = entry.provider ?? "Integration";
  const age = formatCacheAge(entry.timestamp, now);
  const prefix = status === "very_stale" ? "Cached data is very old." : `${provider} is temporarily unavailable.`;
  return `${prefix} Showing cached data from ${age}.`;
}

function isExpired(entry: CachedResult, maxAgeMs: number, now: number): boolean {
  return now - entry.timestamp > maxAgeMs;
}

function cloneCached<T>(entry: CachedResult<T>): CachedResult<T> {
  return {
    ...entry,
    metadata: entry.metadata ? { ...entry.metadata } : undefined
  };
}
