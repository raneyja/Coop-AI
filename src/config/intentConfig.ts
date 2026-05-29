export type IntentDebounceConfig = {
  quickActionClicked: number;
  manualChatSubmit: number;
  hotkeyTriggered: number;
  fileSwitched: number;
  selectionChange: number;
  editorOpened: number;
  keystroke: number;
  mouseHover: number;
};

export type IntentBatchingConfig = {
  enabled: boolean;
  window: number;
  maxRequests: number;
  executionStrategy: "parallel" | "sequential";
};

export type IntentRateLimitConfig = {
  expensiveThreshold: number;
  cheapThreshold: number;
  fallbackToCache: boolean;
};

export type IntentPrioritizationConfig = {
  enabled: boolean;
  useQueueSystem: boolean;
};

export type IntentConfig = {
  debounceRules: IntentDebounceConfig;
  batching: IntentBatchingConfig;
  rateLimitAware: IntentRateLimitConfig;
  prioritization: IntentPrioritizationConfig;
};

export const DEFAULT_INTENT_CONFIG: IntentConfig = {
  debounceRules: {
    quickActionClicked: 0,
    manualChatSubmit: 0,
    hotkeyTriggered: 0,
    fileSwitched: 500,
    selectionChange: 1000,
    editorOpened: 2000,
    keystroke: Number.POSITIVE_INFINITY,
    mouseHover: Number.POSITIVE_INFINITY
  },
  batching: {
    enabled: true,
    window: 500,
    maxRequests: 5,
    executionStrategy: "parallel"
  },
  rateLimitAware: {
    expensiveThreshold: 0.5,
    cheapThreshold: 0.1,
    fallbackToCache: true
  },
  prioritization: {
    enabled: true,
    useQueueSystem: true
  }
};

export type IntentConfigInput = Partial<{
  debounceRules: Partial<IntentDebounceConfig>;
  batching: Partial<IntentBatchingConfig>;
  rateLimitAware: Partial<IntentRateLimitConfig>;
  prioritization: Partial<IntentPrioritizationConfig>;
}>;

export function mergeIntentConfig(input: IntentConfigInput = {}): IntentConfig {
  return {
    debounceRules: {
      ...DEFAULT_INTENT_CONFIG.debounceRules,
      ...defined(input.debounceRules)
    },
    batching: {
      ...DEFAULT_INTENT_CONFIG.batching,
      ...defined(input.batching)
    },
    rateLimitAware: {
      ...DEFAULT_INTENT_CONFIG.rateLimitAware,
      ...defined(input.rateLimitAware)
    },
    prioritization: {
      ...DEFAULT_INTENT_CONFIG.prioritization,
      ...defined(input.prioritization)
    }
  };
}

function defined<T extends object>(input: T | undefined): Partial<T> {
  if (!input) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined)
  ) as Partial<T>;
}
