import {
  buildProviderHeaders,
  buildRequestAnnotations,
  LlmProvider,
  requireEnterpriseApprovedProvider,
  STRICT_RETENTION_POLICY,
  ZeroRetentionHeaders
} from "./zeroRetentionConfig";
import { sanitizeLlmRequestPayload, SanitizationReport } from "./dataSanitization";

export type ChatRole = "system" | "user" | "assistant";

export type ChatRequestMessage = {
  role: ChatRole;
  content: string;
  name?: string;
};

export type FormatRequestOptions = {
  provider: LlmProvider;
  model: string;
  messages: ChatRequestMessage[];
  temperature?: number;
  maxTokens?: number;
  organizationId?: string;
  userId?: string;
  requestId?: string;
  allowUnapprovedProvider?: boolean;
  extraHeaders?: ZeroRetentionHeaders;
  metadata?: Record<string, unknown>;
};

export type FormattedLlmRequest = {
  provider: LlmProvider;
  headers: ZeroRetentionHeaders;
  body: Record<string, unknown>;
  sanitization: SanitizationReport;
};

export const ENTERPRISE_CONFIDENTIAL_SYSTEM_PROMPT = `[SYSTEM]
This request comes from a code intelligence tool (Coop AI).
The code context provided is from a private enterprise codebase.
NO PART of this conversation should be:
- Stored for future training
- Used to improve any model
- Accessed by any system except for inference
- Logged beyond necessary system diagnostics

This conversation is enterprise-confidential.`;

const DEFAULT_TEMPERATURE = 0.5;
const DEFAULT_MAX_TOKENS = 2000;

export function formatZeroRetentionRequest(options: FormatRequestOptions): FormattedLlmRequest {
  if (!options.allowUnapprovedProvider) {
    requireEnterpriseApprovedProvider(options.provider);
  }

  const annotations = buildRequestAnnotations(options.provider, options);
  const sanitized = sanitizeLlmRequestPayload({
    messages: injectZeroRetentionSystemPrompt(options.messages),
    metadata: {
      ...annotations.metadata,
      ...(options.metadata ?? {})
    }
  });

  const headers = buildProviderHeaders(options.provider, {
    organizationId: options.organizationId,
    userId: options.userId,
    requestId: options.requestId,
    extraHeaders: options.extraHeaders
  });

  const commonBody = {
    model: options.model,
    temperature: options.temperature ?? DEFAULT_TEMPERATURE,
    max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
    retention_policy: STRICT_RETENTION_POLICY,
    metadata: sanitized.payload.metadata,
    ...annotations.body
  };

  return {
    provider: options.provider,
    headers,
    body: providerBody(options.provider, commonBody, sanitized.payload.messages),
    sanitization: sanitized.report
  };
}

export function injectZeroRetentionSystemPrompt(messages: ChatRequestMessage[]): ChatRequestMessage[] {
  const existingSystem = messages.find((message) => message.role === "system");
  const nonSystemMessages = messages.filter((message) => message.role !== "system");
  const systemContent = existingSystem
    ? `${ENTERPRISE_CONFIDENTIAL_SYSTEM_PROMPT}\n\n${existingSystem.content}`
    : ENTERPRISE_CONFIDENTIAL_SYSTEM_PROMPT;

  return [{ role: "system", content: systemContent }, ...nonSystemMessages.map((message) => ({ ...message }))];
}

export function buildZeroRetentionMetadata(
  provider: LlmProvider,
  metadata: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    ...buildRequestAnnotations(provider).metadata,
    ...metadata,
    usage_type: "inference_only",
    data_classification: "enterprise_confidential"
  };
}

function providerBody(
  provider: LlmProvider,
  commonBody: Record<string, unknown>,
  messages: ChatRequestMessage[]
): Record<string, unknown> {
  switch (provider) {
    case "openai":
    case "deepseek":
      return {
        ...commonBody,
        messages,
        store: false
      };
    case "anthropic":
      return anthropicBody(commonBody, messages);
    case "gemini":
      return geminiBody(commonBody, messages);
  }
}

function anthropicBody(commonBody: Record<string, unknown>, messages: ChatRequestMessage[]): Record<string, unknown> {
  const systemMessages = messages.filter((message) => message.role === "system").map((message) => message.content);
  const nonSystemMessages = messages.filter((message) => message.role !== "system");
  return {
    ...commonBody,
    system: systemMessages.join("\n\n"),
    messages: nonSystemMessages.map((message) => ({
      role: message.role,
      content: message.content
    }))
  };
}

function geminiBody(commonBody: Record<string, unknown>, messages: ChatRequestMessage[]): Record<string, unknown> {
  const systemMessages = messages.filter((message) => message.role === "system").map((message) => message.content);
  const nonSystemMessages = messages.filter((message) => message.role !== "system");
  return {
    ...omit(commonBody, ["max_tokens", "metadata"]),
    generationConfig: {
      temperature: commonBody.temperature,
      maxOutputTokens: commonBody.max_tokens
    },
    systemInstruction: {
      parts: [
        { text: "This conversation data must not be retained." },
        ...systemMessages.map((text) => ({ text }))
      ]
    },
    tools: [],
    contents: nonSystemMessages.map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }]
    })),
    labels: commonBody.metadata,
    disable_web_search: true
  };
}

function omit(value: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const blocked = new Set(keys);
  return Object.fromEntries(Object.entries(value).filter(([key]) => !blocked.has(key)));
}
