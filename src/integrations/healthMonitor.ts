import type { DegradationConfig } from "../config/degradationConfig";

export type IntegrationProvider =
  | "github"
  | "gitlab"
  | "bitbucket"
  | "slack"
  | "jira"
  | "teams"
  | "google-docs"
  | "confluence"
  | "notion";

export type IntegrationStatus = "healthy" | "degraded" | "offline";
export type RecoveryStrategy = "retry" | "cache" | "skip";

export interface IntegrationHealth {
  provider: IntegrationProvider;
  status: IntegrationStatus;
  lastCheck: Date;
  error?: string;
  recoveryStrategy: RecoveryStrategy;
  latency?: number;
  errorRate?: number;
  checks?: number;
}

export type HealthCheckResult = {
  ok: boolean;
  degraded?: boolean;
  latency?: number;
  error?: string;
};

export type IntegrationHealthAdapter = {
  provider: IntegrationProvider;
  healthCheck: (provider: IntegrationProvider) => Promise<HealthCheckResult>;
};

export type IntegrationHealthStore = {
  update: (health: IntegrationHealth) => Promise<void> | void;
  get: (provider: IntegrationProvider) => Promise<IntegrationHealth | undefined> | IntegrationHealth | undefined;
  getAll: () => Promise<IntegrationHealth[]> | IntegrationHealth[];
};

export type HealthMonitorOptions = {
  config: DegradationConfig;
  adapters?: Partial<Record<IntegrationProvider, IntegrationHealthAdapter>>;
  store?: IntegrationHealthStore;
  providers?: IntegrationProvider[];
  now?: () => Date;
};

type HealthSample = {
  ok: boolean;
  latency: number;
  checkedAt: Date;
};

const SAMPLE_LIMIT = 100;

export const ALL_INTEGRATION_PROVIDERS: IntegrationProvider[] = [
  "github",
  "gitlab",
  "bitbucket",
  "slack",
  "jira",
  "teams",
  "google-docs",
  "confluence",
  "notion"
];

export class MemoryHealthStore implements IntegrationHealthStore {
  private readonly values = new Map<IntegrationProvider, IntegrationHealth>();

  public update(health: IntegrationHealth): void {
    this.values.set(health.provider, cloneHealth(health));
  }

  public get(provider: IntegrationProvider): IntegrationHealth | undefined {
    const health = this.values.get(provider);
    return health ? cloneHealth(health) : undefined;
  }

  public getAll(): IntegrationHealth[] {
    return [...this.values.values()].map(cloneHealth);
  }
}

export class HealthMonitor {
  private readonly adapters: Partial<Record<IntegrationProvider, IntegrationHealthAdapter>>;
  private readonly providers: IntegrationProvider[];
  private readonly store: IntegrationHealthStore;
  private readonly samples = new Map<IntegrationProvider, HealthSample[]>();
  private readonly now: () => Date;

  public constructor(private options: HealthMonitorOptions) {
    this.adapters = options.adapters ?? {};
    this.providers = options.providers ?? ALL_INTEGRATION_PROVIDERS;
    this.store = options.store ?? new MemoryHealthStore();
    this.now = options.now ?? (() => new Date());
    this.seed();
  }

  public async get(provider: IntegrationProvider): Promise<IntegrationHealth> {
    return (await this.store.get(provider)) ?? this.defaultHealth(provider);
  }

  public async getAll(): Promise<IntegrationHealth[]> {
    const values = await this.store.getAll();
    const byProvider = new Map(values.map((health) => [health.provider, health]));
    return this.providers.map((provider) => cloneHealth(byProvider.get(provider) ?? this.defaultHealth(provider)));
  }

  public async updateHealth(provider: IntegrationProvider): Promise<IntegrationHealth> {
    const adapter = this.adapters[provider] ?? createStaticHealthAdapter(provider);
    const started = Date.now();
    try {
      const response = await adapter.healthCheck(provider);
      const latency = response.latency ?? Date.now() - started;
      this.recordSample(provider, { ok: response.ok && !response.degraded, latency, checkedAt: this.now() });
      const errorRate = this.errorRate(provider);
      const status = classifyStatus(errorRate, response, latency);
      const health: IntegrationHealth = {
        provider,
        status,
        lastCheck: this.now(),
        error: response.error,
        recoveryStrategy: strategyForStatus(status),
        latency,
        errorRate,
        checks: this.samples.get(provider)?.length ?? 0
      };
      await this.store.update(health);
      return cloneHealth(health);
    } catch (error) {
      this.recordSample(provider, { ok: false, latency: Date.now() - started, checkedAt: this.now() });
      const health: IntegrationHealth = {
        provider,
        status: "offline",
        lastCheck: this.now(),
        error: error instanceof Error ? error.message : "Health check failed.",
        recoveryStrategy: "cache",
        latency: Date.now() - started,
        errorRate: this.errorRate(provider),
        checks: this.samples.get(provider)?.length ?? 0
      };
      await this.store.update(health);
      return cloneHealth(health);
    }
  }

  private seed(): void {
    for (const provider of this.providers) {
      void this.store.update(this.defaultHealth(provider));
    }
  }

  private defaultHealth(provider: IntegrationProvider): IntegrationHealth {
    const status: IntegrationStatus = provider === "github" || provider === "gitlab" || provider === "slack"
      ? "degraded"
      : "offline";
    return {
      provider,
      status,
      lastCheck: this.now(),
      error: status === "offline" ? "Integration client is not configured yet." : "Awaiting first health check.",
      recoveryStrategy: strategyForStatus(status),
      errorRate: status === "offline" ? 1 : 0.05,
      checks: 0
    };
  }

  private recordSample(provider: IntegrationProvider, sample: HealthSample): void {
    const samples = this.samples.get(provider) ?? [];
    samples.push(sample);
    this.samples.set(provider, samples.slice(-SAMPLE_LIMIT));
  }

  private errorRate(provider: IntegrationProvider): number {
    const samples = this.samples.get(provider) ?? [];
    if (samples.length === 0) {
      return 0;
    }
    const failures = samples.filter((sample) => !sample.ok).length;
    return failures / samples.length;
  }
}

export function createStaticHealthAdapter(
  provider: IntegrationProvider,
  result?: Partial<HealthCheckResult>
): IntegrationHealthAdapter {
  return {
    provider,
    healthCheck: async () => ({
      ok: false,
      degraded: true,
      error: "Integration client is not configured yet.",
      ...result
    })
  };
}

export function healthArrayToRecord(
  health: IntegrationHealth[]
): Partial<Record<IntegrationProvider, IntegrationHealth>> {
  return Object.fromEntries(health.map((entry) => [entry.provider, cloneHealth(entry)]));
}

function classifyStatus(errorRate: number, response: HealthCheckResult, latency: number): IntegrationStatus {
  // Trust the latest successful probe — stale failure samples should not keep a
  // provider offline after the user connects GitHub in Settings.
  if (response.ok) {
    if (response.degraded || latency > 5_000) {
      return "degraded";
    }
    return "healthy";
  }
  if (errorRate >= 0.1) {
    return "offline";
  }
  return "offline";
}

function strategyForStatus(status: IntegrationStatus): RecoveryStrategy {
  if (status === "healthy") {
    return "retry";
  }
  if (status === "degraded") {
    return "cache";
  }
  return "cache";
}

function cloneHealth(health: IntegrationHealth): IntegrationHealth {
  return {
    ...health,
    lastCheck: new Date(health.lastCheck)
  };
}
