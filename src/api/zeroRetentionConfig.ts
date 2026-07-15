export type LlmProvider = "openai" | "anthropic" | "deepseek" | "gemini" | "mistral";

export type HeaderValue = string | boolean | number;

export type ZeroRetentionHeaders = Record<string, HeaderValue>;

export type RetentionPolicy = {
  store_conversation: false;
  use_for_training: false;
  use_for_fine_tuning: false;
  allow_logging: false;
};

export type ProviderCompliancePosture = {
  noTrainingOnApi: boolean;
  zeroRetentionEligible: boolean;
  needsDpa: boolean;
  requiresPaidTier?: boolean;
  requiresLegalReview?: boolean;
  verifiedDate: string;
  policyUrl: string;
  notes: string[];
};

export type ProviderEndpoint = {
  baseUrl: string;
  inferencePath: string;
  blockedPathFragments: string[];
};

export type ZeroRetentionProviderConfig = {
  provider: LlmProvider;
  displayName: string;
  endpoint: ProviderEndpoint;
  defaultHeaders: ZeroRetentionHeaders;
  requestMetadata: Record<string, unknown>;
  bodyAnnotations: Record<string, unknown>;
  compliance: ProviderCompliancePosture;
};

export type BuildHeaderOptions = {
  organizationId?: string;
  userId?: string;
  requestId?: string;
  extraHeaders?: ZeroRetentionHeaders;
};

export type RequestAnnotations = {
  metadata: Record<string, unknown>;
  body: Record<string, unknown>;
};

export const STANDARD_ZERO_RETENTION_HEADERS: ZeroRetentionHeaders = {
  "x-data-retention-policy": "none",
  "x-use-case": "code-completion-only",
  "x-enterprise-mode": true,
  "x-no-training": true,
  "x-no-logging": true
};

export const STRICT_RETENTION_POLICY: RetentionPolicy = {
  store_conversation: false,
  use_for_training: false,
  use_for_fine_tuning: false,
  allow_logging: false
};

const SHARED_METADATA: Record<string, unknown> = {
  usage_type: "inference_only",
  data_classification: "enterprise_confidential",
  retention_policy: "none",
  no_training: true,
  no_logging: true
};

const PROVIDER_CONFIGS: Record<LlmProvider, ZeroRetentionProviderConfig> = {
  openai: {
    provider: "openai",
    displayName: "OpenAI API",
    endpoint: {
      baseUrl: "https://api.openai.com",
      inferencePath: "/v1/chat/completions",
      blockedPathFragments: ["/fine_tuning", "/files", "/batches", "/evals", "/assistants", "/threads"]
    },
    defaultHeaders: {
      ...STANDARD_ZERO_RETENTION_HEADERS
    },
    requestMetadata: {
      ...SHARED_METADATA,
      provider_training_default: "api_data_not_used_for_training_by_default"
    },
    bodyAnnotations: {
      retention_policy: STRICT_RETENTION_POLICY,
      store: false
    },
    compliance: {
      noTrainingOnApi: true,
      zeroRetentionEligible: true,
      needsDpa: true,
      verifiedDate: "2026-05-28",
      policyUrl: "https://developers.openai.com/api/docs/guides/your-data",
      notes: [
        "Use standard inference endpoints only; do not call fine-tuning, files, batches, evals, assistants, or threads APIs for enterprise-confidential code context.",
        "OpenAI states API inputs and outputs are not used to train models by default unless the customer explicitly opts in.",
        "Default abuse-monitoring retention may still apply unless the account has approved zero data retention terms."
      ]
    }
  },
  anthropic: {
    provider: "anthropic",
    displayName: "Anthropic Claude API",
    endpoint: {
      baseUrl: "https://api.anthropic.com",
      inferencePath: "/v1/messages",
      blockedPathFragments: ["/files", "/batches", "/fine-tunes"]
    },
    defaultHeaders: {
      ...STANDARD_ZERO_RETENTION_HEADERS,
      "X-Data-Retention": "none",
      "X-Purpose": "inference"
    },
    requestMetadata: {
      ...SHARED_METADATA,
      provider_training_default: "commercial_api_data_not_used_for_training_by_default"
    },
    bodyAnnotations: {
      retention_policy: STRICT_RETENTION_POLICY
    },
    compliance: {
      noTrainingOnApi: true,
      zeroRetentionEligible: true,
      needsDpa: false,
      verifiedDate: "2026-05-28",
      policyUrl: "https://privacy.anthropic.com/en/articles/7996868-i-want-to-opt-out-of-my-prompts-and-results-being-used-for-training-models",
      notes: [
        "Use the standard Claude Messages API for inference.",
        "Anthropic states commercial inputs and outputs are not used for model training by default unless the customer explicitly opts in or provides feedback."
      ]
    }
  },
  deepseek: {
    provider: "deepseek",
    displayName: "DeepSeek API",
    endpoint: {
      baseUrl: "https://api.deepseek.com",
      inferencePath: "/chat/completions",
      blockedPathFragments: ["/fine_tuning", "/files", "/batches"]
    },
    defaultHeaders: {
      ...STANDARD_ZERO_RETENTION_HEADERS,
      "X-Data-Retention": "none",
      "X-Purpose": "inference"
    },
    requestMetadata: {
      ...SHARED_METADATA,
      provider_training_default: "requires_contract_review"
    },
    bodyAnnotations: {
      retention_policy: STRICT_RETENTION_POLICY
    },
    compliance: {
      noTrainingOnApi: false,
      zeroRetentionEligible: false,
      needsDpa: true,
      requiresLegalReview: true,
      verifiedDate: "2026-05-28",
      policyUrl: "https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html",
      notes: [
        "Public DeepSeek policy language should be reviewed with counsel before enterprise-confidential code is routed to DeepSeek.",
        "Treat DeepSeek as contract-review-required until a DPA or enterprise no-training commitment is in place.",
        "Prefer BYOK plus customer-approved account terms when this provider is enabled."
      ]
    }
  },
  mistral: {
    provider: "mistral",
    displayName: "Mistral Codestral API",
    endpoint: {
      baseUrl: "https://api.mistral.ai",
      inferencePath: "/v1/fim/completions",
      blockedPathFragments: ["/batch", "/files", "/fine_tunes"]
    },
    defaultHeaders: {
      ...STANDARD_ZERO_RETENTION_HEADERS,
      "X-Data-Retention": "none",
      "X-Purpose": "inference"
    },
    requestMetadata: {
      ...SHARED_METADATA,
      provider_training_default: "api_data_not_used_for_training_by_default"
    },
    bodyAnnotations: {
      retention_policy: STRICT_RETENTION_POLICY
    },
    compliance: {
      noTrainingOnApi: true,
      zeroRetentionEligible: true,
      needsDpa: true,
      verifiedDate: "2026-05-28",
      policyUrl: "https://docs.mistral.ai/getting-started/terms/",
      notes: [
        "Use Codestral FIM endpoint for inline completion only.",
        "Mistral states API data is not used for model training by default for eligible tiers."
      ]
    }
  },
  gemini: {
    provider: "gemini",
    displayName: "Google Gemini API",
    endpoint: {
      baseUrl: "https://generativelanguage.googleapis.com",
      inferencePath: "/v1beta/models/{model}:generateContent",
      blockedPathFragments: ["/cachedContents", "/tunedModels", "/files"]
    },
    defaultHeaders: {
      ...STANDARD_ZERO_RETENTION_HEADERS
    },
    requestMetadata: {
      ...SHARED_METADATA,
      provider_training_default: "paid_services_not_used_for_training",
      disable_web_search: true
    },
    bodyAnnotations: {
      disable_web_search: true,
      retention_policy: STRICT_RETENTION_POLICY,
      systemInstruction: {
        parts: [{ text: "This conversation data must not be retained." }]
      }
    },
    compliance: {
      noTrainingOnApi: true,
      zeroRetentionEligible: true,
      needsDpa: true,
      requiresPaidTier: true,
      verifiedDate: "2026-05-28",
      policyUrl: "https://ai.google.dev/gemini-api/docs/zdr",
      notes: [
        "Use paid Gemini API or Vertex AI terms for no-training commitments.",
        "Do not enable grounding with Google Search, context caching, Interactions API storage, or Live API session resumption for zero-retention workloads.",
        "Set store=false where supported and disable web search in CoopAI request construction."
      ]
    }
  }
};

export function getZeroRetentionConfig(provider: LlmProvider): ZeroRetentionProviderConfig {
  return cloneProviderConfig(PROVIDER_CONFIGS[provider]);
}

export function listZeroRetentionConfigs(): ZeroRetentionProviderConfig[] {
  return (Object.keys(PROVIDER_CONFIGS) as LlmProvider[]).map(getZeroRetentionConfig);
}

export function buildProviderHeaders(provider: LlmProvider, options: BuildHeaderOptions = {}): ZeroRetentionHeaders {
  const config = PROVIDER_CONFIGS[provider];
  const providerHeaders = providerSpecificHeaders(provider, options);
  const requestHeaders: ZeroRetentionHeaders = options.requestId ? { "x-request-id": options.requestId } : {};
  return {
    ...config.defaultHeaders,
    ...providerHeaders,
    ...requestHeaders,
    ...(options.extraHeaders ?? {})
  };
}

export function buildRequestAnnotations(provider: LlmProvider, options: BuildHeaderOptions = {}): RequestAnnotations {
  const config = PROVIDER_CONFIGS[provider];
  return {
    metadata: removeUndefined({
      ...config.requestMetadata,
      provider,
      organization_id: options.organizationId,
      user_id: options.userId,
      request_id: options.requestId
    }),
    body: deepClone(config.bodyAnnotations)
  };
}

export function assertStandardInferenceEndpoint(provider: LlmProvider, url: string): void {
  const { endpoint } = PROVIDER_CONFIGS[provider];
  const parsed = new URL(url, endpoint.baseUrl);
  const path = parsed.pathname;
  const blocked = endpoint.blockedPathFragments.find((fragment) => path.includes(fragment));
  if (blocked) {
    throw new Error(`Provider endpoint is not approved for zero-retention inference: ${provider} ${blocked}`);
  }
}

export function isProviderApprovedForEnterprise(provider: LlmProvider): boolean {
  const compliance = PROVIDER_CONFIGS[provider].compliance;
  return compliance.noTrainingOnApi && !compliance.requiresLegalReview;
}

export function requireEnterpriseApprovedProvider(provider: LlmProvider): void {
  if (!isProviderApprovedForEnterprise(provider)) {
    throw new Error(`Provider ${provider} requires compliance approval before enterprise code context can be sent.`);
  }
}

function providerSpecificHeaders(provider: LlmProvider, options: BuildHeaderOptions): ZeroRetentionHeaders {
  if (provider === "openai") {
    const headers: ZeroRetentionHeaders = {};
    if (options.organizationId) {
      headers["OpenAI-Organization"] = options.organizationId;
    }
    if (options.userId) {
      headers.User = options.userId;
    }
    return headers;
  }
  return {};
}

function removeUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

function cloneProviderConfig(config: ZeroRetentionProviderConfig): ZeroRetentionProviderConfig {
  return deepClone(config);
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
