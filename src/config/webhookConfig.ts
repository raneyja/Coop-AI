import type { TokenPoolConfig } from "../api/tokenPool";
import type { WebhookProvider } from "../webhooks/types";

export type ProviderWebhookConfig = {
  enabled: boolean;
  endpoint: string;
  secret?: string;
  signingSecret?: string;
  events: string[];
};

export type CacheConfig = {
  backend: "memory" | "redis" | "postgres" | "hybrid";
  ttl: number;
  maxRepos: number;
  connectionString?: string;
};

export type RateLimitConfig = {
  checkInterval: number;
  warnThreshold: number;
};

export type WebhookConfig = {
  port: number;
  publicBaseUrl: string;
  webhooks: {
    github: ProviderWebhookConfig;
    gitlab: ProviderWebhookConfig;
    slack: ProviderWebhookConfig;
  };
  cache: CacheConfig;
  rateLimit: RateLimitConfig;
  tokenPools: TokenPoolConfig[];
};

export function loadWebhookConfig(env: NodeJS.ProcessEnv = process.env): WebhookConfig {
  const publicBaseUrl = env.WEBHOOK_DOMAIN ?? env.COOP_WEBHOOK_BASE_URL ?? "http://localhost:8787";
  return {
    port: readNumber(env.PORT, 8787),
    publicBaseUrl,
    webhooks: {
      github: {
        enabled: readBoolean(env.GITHUB_WEBHOOK_ENABLED, true),
        endpoint: `${publicBaseUrl.replace(/\/$/, "")}/webhooks/github`,
        secret: env.GITHUB_WEBHOOK_SECRET,
        events: readCsv(env.GITHUB_WEBHOOK_EVENTS, ["push", "pull_request", "pull_request_review", "issues", "repository"])
      },
      gitlab: {
        enabled: readBoolean(env.GITLAB_WEBHOOK_ENABLED, true),
        endpoint: `${publicBaseUrl.replace(/\/$/, "")}/webhooks/gitlab`,
        secret: env.GITLAB_WEBHOOK_TOKEN,
        events: readCsv(env.GITLAB_WEBHOOK_EVENTS, ["push", "merge_request", "issue", "wiki"])
      },
      slack: {
        enabled: readBoolean(env.SLACK_WEBHOOK_ENABLED, true),
        endpoint: `${publicBaseUrl.replace(/\/$/, "")}/webhooks/slack`,
        signingSecret: env.SLACK_SIGNING_SECRET,
        events: readCsv(env.SLACK_WEBHOOK_EVENTS, ["message", "app_mention", "reaction"])
      }
    },
    cache: {
      backend: readCacheBackend(env.GRAPH_CACHE_BACKEND),
      ttl: readNumber(env.GRAPH_CACHE_TTL_SECONDS, 86_400),
      maxRepos: readNumber(env.GRAPH_CACHE_MAX_REPOS, 100),
      connectionString: env.DATABASE_URL ?? env.REDIS_URL
    },
    rateLimit: {
      checkInterval: readNumber(env.RATE_LIMIT_CHECK_INTERVAL_MS, 3_600_000),
      warnThreshold: readNumber(env.RATE_LIMIT_WARN_THRESHOLD, 0.2)
    },
    tokenPools: readTokenPools(env)
  };
}

export function requireWebhookSecret(
  config: WebhookConfig,
  provider: WebhookProvider
): string | undefined {
  if (provider === "github") {
    return config.webhooks.github.secret;
  }
  if (provider === "gitlab") {
    return config.webhooks.gitlab.secret;
  }
  return config.webhooks.slack.signingSecret;
}

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function readNumber(value: string | number | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readCsv(value: string | undefined, fallback: string[]): string[] {
  if (!value) {
    return fallback;
  }
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function readCacheBackend(value: string | undefined): CacheConfig["backend"] {
  if (value === "redis" || value === "postgres" || value === "hybrid") {
    return value;
  }
  return "memory";
}

function readTokenPools(env: NodeJS.ProcessEnv): TokenPoolConfig[] {
  const configs: TokenPoolConfig[] = [];
  const githubTokens = readCsv(env.GITHUB_TOKEN_POOL, []);
  if (githubTokens.length > 0) {
    configs.push({
      provider: "github",
      strategy: readStrategy(env.GITHUB_TOKEN_POOL_STRATEGY),
      tokens: githubTokens.map((token, index) => ({
        id: `github-${index + 1}`,
        provider: "github",
        token,
        limit: 5000,
        remaining: 5000
      }))
    });
  }
  const gitlabTokens = readCsv(env.GITLAB_TOKEN_POOL, []);
  if (gitlabTokens.length > 0) {
    configs.push({
      provider: "gitlab",
      strategy: readStrategy(env.GITLAB_TOKEN_POOL_STRATEGY),
      tokens: gitlabTokens.map((token, index) => ({
        id: `gitlab-${index + 1}`,
        provider: "gitlab",
        token,
        limit: 2000,
        remaining: 2000
      }))
    });
  }
  return configs;
}

function readStrategy(value: string | undefined): TokenPoolConfig["strategy"] {
  if (value === "least-used" || value === "per-repo") {
    return value;
  }
  return "round-robin";
}
