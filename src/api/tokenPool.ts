import type { RateLimitProvider, RateLimitState } from "./rateLimitTracker";

export type TokenPoolStrategy = "round-robin" | "least-used" | "per-repo";

export type TokenRecord = {
  id: string;
  token: string;
  provider: RateLimitProvider;
  limit: number;
  remaining: number;
  resetTime?: Date;
  disabled?: boolean;
  assignedRepos?: string[];
  lastUsedAt?: Date;
};

export type TokenPoolConfig = {
  provider: RateLimitProvider;
  strategy: TokenPoolStrategy;
  tokens: TokenRecord[];
};

export type TokenSelection = {
  token: string;
  record: Omit<TokenRecord, "token">;
};

export class TokenPool {
  private readonly pools = new Map<RateLimitProvider, TokenPoolConfig>();
  private readonly cursors = new Map<RateLimitProvider, number>();

  public constructor(configs: TokenPoolConfig[] = []) {
    for (const config of configs) {
      this.setPool(config);
    }
  }

  public setPool(config: TokenPoolConfig): void {
    this.pools.set(config.provider, {
      ...config,
      tokens: config.tokens.map((token) => ({ ...token, resetTime: cloneDate(token.resetTime) }))
    });
  }

  public addToken(provider: RateLimitProvider, token: Omit<TokenRecord, "provider">): void {
    const pool = this.pools.get(provider) ?? { provider, strategy: "round-robin" as const, tokens: [] };
    pool.tokens.push({ ...token, provider });
    this.pools.set(provider, pool);
  }

  public removeToken(provider: RateLimitProvider, tokenId: string): boolean {
    const pool = this.pools.get(provider);
    if (!pool) {
      return false;
    }
    const before = pool.tokens.length;
    pool.tokens = pool.tokens.filter((token) => token.id !== tokenId);
    return pool.tokens.length !== before;
  }

  public disableToken(provider: RateLimitProvider, tokenId: string, disabled = true): void {
    const token = this.findToken(provider, tokenId);
    if (token) {
      token.disabled = disabled;
    }
  }

  public select(provider: RateLimitProvider, repoId?: string): TokenSelection | undefined {
    const pool = this.pools.get(provider);
    if (!pool) {
      return undefined;
    }
    const eligible = pool.tokens.filter((token) => this.isEligible(token));
    if (eligible.length === 0) {
      return undefined;
    }

    const selected = this.selectToken(pool, eligible, repoId);
    selected.lastUsedAt = new Date();
    return {
      token: selected.token,
      record: sanitizeTokenRecord(selected)
    };
  }

  public updateRateLimit(provider: RateLimitProvider, tokenId: string, state: RateLimitState): void {
    const token = this.findToken(provider, tokenId);
    if (!token) {
      return;
    }
    token.limit = state.limit;
    token.remaining = state.remaining;
    token.resetTime = new Date(state.resetTime);
  }

  public assignRepo(provider: RateLimitProvider, tokenId: string, repoId: string): void {
    const token = this.findToken(provider, tokenId);
    if (!token) {
      return;
    }
    token.assignedRepos = [...new Set([...(token.assignedRepos ?? []), repoId])];
  }

  public list(provider?: RateLimitProvider): Array<Omit<TokenRecord, "token">> {
    const pools = provider ? compact([this.pools.get(provider)]) : [...this.pools.values()];
    return pools.flatMap((pool) => pool.tokens.map(sanitizeTokenRecord));
  }

  private selectToken(pool: TokenPoolConfig, eligible: TokenRecord[], repoId?: string): TokenRecord {
    if (pool.strategy === "per-repo" && repoId) {
      const assigned = eligible.find((token) => token.assignedRepos?.includes(repoId));
      if (assigned) {
        return assigned;
      }
    }
    if (pool.strategy === "least-used") {
      return [...eligible].sort((a, b) => b.remaining / b.limit - a.remaining / a.limit)[0];
    }
    const cursor = this.cursors.get(pool.provider) ?? 0;
    const selected = eligible[cursor % eligible.length];
    this.cursors.set(pool.provider, cursor + 1);
    return selected;
  }

  private isEligible(token: TokenRecord): boolean {
    if (token.disabled || token.remaining <= 0) {
      return false;
    }
    if (token.resetTime && token.remaining <= 0 && token.resetTime.getTime() > Date.now()) {
      return false;
    }
    return true;
  }

  private findToken(provider: RateLimitProvider, tokenId: string): TokenRecord | undefined {
    return this.pools.get(provider)?.tokens.find((token) => token.id === tokenId);
  }
}

function sanitizeTokenRecord(token: TokenRecord): Omit<TokenRecord, "token"> {
  const { token: _secret, ...safe } = token;
  return {
    ...safe,
    resetTime: cloneDate(safe.resetTime),
    lastUsedAt: cloneDate(safe.lastUsedAt),
    assignedRepos: safe.assignedRepos ? [...safe.assignedRepos] : undefined
  };
}

function cloneDate(date: Date | undefined): Date | undefined {
  return date ? new Date(date) : undefined;
}

function compact<T>(values: Array<T | undefined>): T[] {
  return values.filter((value): value is T => value !== undefined);
}
