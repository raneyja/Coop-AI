import {
  buildProviderHeaders,
  buildRequestAnnotations,
  LlmProvider,
  requireEnterpriseApprovedProvider,
  STRICT_RETENTION_POLICY,
  ZeroRetentionHeaders
} from "./zeroRetentionConfig";
import { sanitizeLlmRequestPayload, SanitizationReport } from "./dataSanitization";
import type { ChatImageAttachment } from "./types";
import {
  base64FromDataUrl,
  isMultimodalPaperclipAttachment,
  paperclipAttachmentKind
} from "../chat/paperclipAttachments";

export type ChatRole = "system" | "user" | "assistant";

export type ChatRequestMessage = {
  role: ChatRole;
  content: string;
  attachments?: ChatImageAttachment[];
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
This request comes from a code intelligence tool (CoopAI).
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
      return openAiBody(commonBody, messages);
    case "deepseek":
      // DeepSeek is OpenAI-compatible and uses the classic chat-completions params.
      return {
        model: commonBody.model,
        temperature: commonBody.temperature,
        max_tokens: commonBody.max_tokens,
        messages: messages.map((message) => ({
          role: message.role,
          content: formatOpenAiContent(message)
        })),
        store: false
      };
    case "anthropic":
      return anthropicBody(commonBody, messages);
    case "gemini":
      return geminiBody(commonBody, messages);
    case "mistral":
      throw new Error("Mistral provider supports FIM inline completion only, not chat formatting.");
  }
}

/**
 * OpenAI request body. GPT-5 and o-series ("reasoning") models reject `max_tokens`
 * (require `max_completion_tokens`) and only accept the default temperature, while the
 * gpt-4.x / gpt-3.5 family uses the classic params. Branch on the model accordingly.
 */
function openAiBody(commonBody: Record<string, unknown>, messages: ChatRequestMessage[]): Record<string, unknown> {
  const model = String(commonBody.model ?? "");
  const isReasoningModel = /^(gpt-5|o\d)/.test(model);
  const body: Record<string, unknown> = {
    model,
    messages: messages.map((message) => ({
      role: message.role,
      content: formatOpenAiContent(message)
    })),
    store: false
  };
  if (isReasoningModel) {
    body.max_completion_tokens = commonBody.max_tokens;
  } else {
    body.max_tokens = commonBody.max_tokens;
    body.temperature = commonBody.temperature;
  }
  return body;
}

function formatOpenAiContent(message: ChatRequestMessage): string | Array<Record<string, unknown>> {
  const multimodal = message.attachments?.filter(isMultimodalPaperclipAttachment) ?? [];
  const textContent = message.content.trim();
  if (!multimodal.length) {
    return textContent;
  }
  const parts: Array<Record<string, unknown>> = [
    { type: "text", text: textContent || "See attached file(s)." }
  ];
  for (const attachment of multimodal) {
    const kind = paperclipAttachmentKind(attachment.mimeType, attachment.name);
    if (kind === "image") {
      parts.push({
        type: "image_url",
        image_url: { url: attachment.dataUrl }
      });
      continue;
    }
    if (kind === "pdf") {
      parts.push({
        type: "file",
        file: {
          filename: attachment.name,
          file_data: attachment.dataUrl
        }
      });
    }
  }
  return parts;
}

function formatAnthropicContent(message: ChatRequestMessage): string | Array<Record<string, unknown>> {
  const multimodal = message.attachments?.filter(isMultimodalPaperclipAttachment) ?? [];
  const textContent = message.content.trim();
  if (!multimodal.length) {
    return textContent;
  }
  const parts: Array<Record<string, unknown>> = [];
  for (const attachment of multimodal) {
    const kind = paperclipAttachmentKind(attachment.mimeType, attachment.name);
    if (kind === "image") {
      parts.push({
        type: "image",
        source: {
          type: "base64",
          media_type: attachment.mimeType,
          data: base64FromDataUrl(attachment.dataUrl)
        }
      });
      continue;
    }
    if (kind === "pdf") {
      parts.push({
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: base64FromDataUrl(attachment.dataUrl)
        }
      });
    }
  }
  parts.push({ type: "text", text: textContent || "See attached file(s)." });
  return parts;
}

function formatGeminiParts(message: ChatRequestMessage): Array<Record<string, unknown>> {
  const multimodal = message.attachments?.filter(isMultimodalPaperclipAttachment) ?? [];
  const textContent = message.content.trim();
  const parts: Array<Record<string, unknown>> = [
    { text: textContent || (multimodal.length ? "See attached file(s)." : "") }
  ];
  for (const attachment of multimodal) {
    parts.push({
      inlineData: {
        mimeType: attachment.mimeType,
        data: base64FromDataUrl(attachment.dataUrl)
      }
    });
  }
  return parts;
}

function anthropicBody(commonBody: Record<string, unknown>, messages: ChatRequestMessage[]): Record<string, unknown> {
  const systemMessages = messages.filter((message) => message.role === "system").map((message) => message.content);
  const nonSystemMessages = messages.filter((message) => message.role !== "system");
  // Anthropic Messages API rejects unknown top-level fields (retention_policy, etc.) and
  // only allows metadata.user_id — not Coop's enterprise annotation keys.
  const body: Record<string, unknown> = {
    model: commonBody.model,
    max_tokens: commonBody.max_tokens,
    temperature: commonBody.temperature,
    system: systemMessages.join("\n\n"),
    messages: nonSystemMessages.map((message) => ({
      role: message.role,
      content: formatAnthropicContent(message)
    }))
  };
  const metadata = anthropicMetadata(commonBody.metadata);
  if (metadata) {
    body.metadata = metadata;
  }
  return body;
}

function anthropicMetadata(metadata: unknown): Record<string, unknown> | undefined {
  if (!metadata || typeof metadata !== "object") {
    return undefined;
  }
  const userId = (metadata as Record<string, unknown>).user_id;
  if (typeof userId !== "string" || !userId.trim()) {
    return undefined;
  }
  return { user_id: userId.trim() };
}

function geminiBody(commonBody: Record<string, unknown>, messages: ChatRequestMessage[]): Record<string, unknown> {
  const systemMessages = messages.filter((message) => message.role === "system").map((message) => message.content);
  const nonSystemMessages = messages.filter((message) => message.role !== "system");
  // generateContent only accepts a fixed set of top-level fields. Anything else
  // (model, temperature, retention_policy, labels, disable_web_search) is rejected,
  // so emit only valid fields. Omitting tools means no web-search grounding.
  return {
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
    contents: nonSystemMessages.map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: formatGeminiParts(message)
    }))
  };
}

