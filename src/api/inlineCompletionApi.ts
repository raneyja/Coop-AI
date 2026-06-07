import type { ServerResponse } from "node:http";
import { createRequestId, ModelRouter } from "./ModelRouter";
import type { LlmServerConfig } from "./llmServerConfig";
import { loadLlmServerConfig } from "./llmServerConfig";
import type { LlmProvider } from "./zeroRetentionConfig";
import type { ChatOrgPlan } from "./types";
import { systemPromptForUseCase } from "../prompts/systemPrompts";

export type V1InlineCompletionBody = {
  message: string;
  languageId?: string;
  file?: string;
  provider?: LlmProvider;
  model?: string;
  temperature?: number;
  maxTokens?: number;
};

const INLINE_SYSTEM = `${systemPromptForUseCase("inline_completion")}

RULES:
- Match indentation and style of surrounding code
- Complete ONE logical statement (not multiple)
- If uncertain, return JUST the most likely completion
- Never explain, never add comments, just code
- Respect language syntax and conventions
- If completion would be trivial (auto-semicolon), return empty
- Return ONLY the completion text. No markdown, no explanations.`;

export async function handleInlineCompletionRequest(
  body: unknown,
  response: ServerResponse,
  router: ModelRouter,
  config: LlmServerConfig = loadLlmServerConfig(),
  org: { orgId: string; plan: ChatOrgPlan }
): Promise<void> {
  const record = asRecord(body);
  const message = typeof record.message === "string" ? record.message : "";
  if (!message.trim()) {
    writeJson(response, 400, { error: "invalid_request", message: "message is required" });
    return;
  }

  const provider = readProvider(record.provider, config.defaultProvider);
  const model =
    typeof record.model === "string" && record.model
      ? record.model
      : defaultInlineModelFor(provider);
  const maxTokens = typeof record.maxTokens === "number" ? Math.min(record.maxTokens, 128) : 96;
  const temperature = typeof record.temperature === "number" ? record.temperature : 0.15;
  const requestId = createRequestId();

  const started = Date.now();
  try {
    const result = await router.completeInline(
      {
        requestId,
        orgId: org.orgId,
        plan: org.plan,
        message,
        history: [],
        context: {
          file: typeof record.file === "string" ? record.file : undefined,
          languageId: typeof record.languageId === "string" ? record.languageId : undefined
        },
        useCase: "inline_completion",
        allowUnapprovedProvider: config.allowUnapprovedProvider,
        modelConfig: {
          provider,
          model,
          temperature,
          maxTokens
        }
      },
      INLINE_SYSTEM
    );

    writeJson(response, 200, {
      text: result.text,
      alternatives: [],
      model: result.model,
      provider: result.provider,
      latencyMs: Date.now() - started,
      usage: result.usage
    });
  } catch (error) {
    writeJson(response, 502, {
      error: "provider_failure",
      message: error instanceof Error ? error.message : "Inline completion failed."
    });
  }
}

function readProvider(value: unknown, fallback: LlmProvider): LlmProvider {
  if (value === "openai" || value === "anthropic" || value === "deepseek" || value === "gemini") {
    return value;
  }
  return fallback;
}

function defaultInlineModelFor(provider: LlmProvider): string {
  switch (provider) {
    case "openai":
      return "gpt-4o-mini";
    case "anthropic":
      return "claude-haiku-4-5-20251001";
    case "deepseek":
      return "deepseek-chat";
    case "gemini":
      return "gemini-2.5-flash";
  }
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}
