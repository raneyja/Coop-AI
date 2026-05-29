import type { LlmProvider } from "./zeroRetentionConfig";

export type LlmServerConfig = {
  defaultProvider: LlmProvider;
  mockMode: boolean;
  allowUnapprovedProvider: boolean;
  apiToken?: string;
  apiKeys: Partial<Record<LlmProvider, string>>;
};

export function loadLlmServerConfig(env: NodeJS.ProcessEnv = process.env): LlmServerConfig {
  const defaultProvider = readProvider(env.COOP_LLM_DEFAULT_PROVIDER, "anthropic");
  return {
    defaultProvider,
    mockMode: readBoolean(env.COOP_LLM_MOCK, false),
    allowUnapprovedProvider: readBoolean(env.COOP_LLM_ALLOW_UNAPPROVED, false),
    apiToken: env.COOP_JOBS_API_TOKEN ?? env.COOP_API_TOKEN,
    apiKeys: {
      openai: env.OPENAI_API_KEY,
      anthropic: env.ANTHROPIC_API_KEY,
      deepseek: env.DEEPSEEK_API_KEY,
      gemini: env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY
    }
  };
}

export function configuredProviders(config: LlmServerConfig): LlmProvider[] {
  if (config.mockMode) {
    return ["anthropic", "openai", "gemini", "deepseek"];
  }
  return (["anthropic", "openai", "gemini", "deepseek"] as LlmProvider[]).filter((provider) =>
    Boolean(config.apiKeys[provider]?.trim())
  );
}

export function resolveProviderApiKey(config: LlmServerConfig, provider: LlmProvider): string | undefined {
  return config.apiKeys[provider]?.trim() || undefined;
}

function readProvider(value: string | undefined, fallback: LlmProvider): LlmProvider {
  if (value === "openai" || value === "anthropic" || value === "deepseek" || value === "gemini") {
    return value;
  }
  return fallback;
}

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  return value === "1" || value.toLowerCase() === "true";
}
