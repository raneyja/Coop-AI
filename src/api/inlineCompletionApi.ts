import type { IncomingMessage, ServerResponse } from "node:http";
import { createRequestId, ModelRouter } from "./ModelRouter";
import type { LlmServerConfig } from "./llmServerConfig";
import { loadLlmServerConfig } from "./llmServerConfig";
import type { LlmProvider } from "./zeroRetentionConfig";
import type { ChatOrgPlan } from "./types";
import { systemPromptForUseCase } from "../prompts/systemPrompts";
import type { PlanQuotaService } from "../server/planQuota";
import { defaultInlineModelForProvider } from "../config/inlineModelPresets";
import { selectFimProvider } from "./fimRouter";
import {
  fetchInlineGraphSlice,
  type InlineGraphContextDeps
} from "./inlineGraphContext";

export type InlineCompletionOrg = {
  orgId: string;
  plan: ChatOrgPlan;
  userId?: string;
  principal?: string;
  planQuota?: PlanQuotaService;
};

export type V1InlineCompletionBody = {
  message?: string;
  segments?: { prefix: string; suffix: string };
  stream?: boolean;
  repoId?: string;
  useGraphContext?: boolean;
  languageId?: string;
  file?: string;
  provider?: LlmProvider;
  model?: string;
  temperature?: number;
  maxTokens?: number;
};

const MAX_PREFIX_CHARS = 4_000;
const MAX_SUFFIX_CHARS = 2_000;
const DEFAULT_MAX_TOKENS = 96;
const MAX_INLINE_TOKENS = 200;

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
  org: InlineCompletionOrg,
  rawRequest?: IncomingMessage,
  graphDeps: InlineGraphContextDeps = {}
): Promise<void> {
  const parsed = parseInlineBody(body);
  if (!parsed.ok) {
    writeJson(response, 400, { error: "invalid_request", message: parsed.message });
    return;
  }

  const { record, segments } = parsed;
  let message = parsed.message;
  let graphContextHeader: string | undefined;

  if (
    record.useGraphContext === true &&
    typeof record.repoId === "string" &&
    typeof record.file === "string"
  ) {
    const slice = await fetchInlineGraphSlice(graphDeps, {
      repoId: record.repoId,
      file: record.file,
      plan: org.plan
    });
    if (slice.status === "ok") {
      message = `${message}\n\n${slice.block}`;
    } else if (slice.status === "degraded") {
      graphContextHeader = "degraded";
    }
  }

  const provider = readProvider(record.provider, config.defaultProvider);
  const route = selectFimProvider(config, {
    segments,
    requestedProvider: provider,
    requestedModel: typeof record.model === "string" ? record.model : undefined
  });
  const model =
    route.mode === "fim"
      ? route.model
      : typeof record.model === "string" && record.model
        ? record.model
        : defaultInlineModelFor(route.provider);
  const resolvedProvider = route.mode === "fim" ? route.provider : route.provider;
  const maxTokens =
    typeof record.maxTokens === "number"
      ? Math.min(record.maxTokens, MAX_INLINE_TOKENS)
      : DEFAULT_MAX_TOKENS;
  const temperature = typeof record.temperature === "number" ? record.temperature : 0.15;
  const requestId = createRequestId();
  const stream = record.stream === true;

  const completionRequest = {
    requestId,
    orgId: org.orgId,
    plan: org.plan,
    message,
    history: [] as [],
    context: {
      file: typeof record.file === "string" ? record.file : undefined,
      languageId: typeof record.languageId === "string" ? record.languageId : undefined,
      ...(typeof record.repoId === "string" ? { repo: record.repoId } : {})
    },
    segments,
    useCase: "inline_completion" as const,
    allowUnapprovedProvider: config.allowUnapprovedProvider,
    modelConfig: {
      provider: resolvedProvider,
      model,
      temperature,
      maxTokens
    }
  };

  const started = Date.now();
  const responseHeaders = graphContextHeader
    ? { "x-graph-context": graphContextHeader }
    : undefined;

  if (stream) {
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
      ...responseHeaders
    });

    const abortController = new AbortController();
    bindAbort(rawRequest, abortController);

    let usageTokens: { inputTokens: number; outputTokens: number } | undefined;

    try {
      for await (const chunk of router.streamInline(
        completionRequest,
        INLINE_SYSTEM,
        abortController.signal
      )) {
        writeSse(response, chunk);
        if (chunk.type === "done") {
          usageTokens = {
            inputTokens: chunk.usage.inputTokens,
            outputTokens: chunk.usage.outputTokens
          };
        }
        if (chunk.type === "error") {
          break;
        }
      }
    } catch (error) {
      writeSse(response, {
        type: "error",
        message: error instanceof Error ? error.message : "Inline stream failed."
      });
    }

    if (usageTokens) {
      await org.planQuota?.recordTokens(org.orgId, org.plan, {
        eventType: "completion.suggested",
        inputTokens: usageTokens.inputTokens,
        outputTokens: usageTokens.outputTokens,
        provider: resolvedProvider,
        model,
        userId: org.userId,
        principal: org.principal ?? "anonymous",
        metadata: { source: "inline", stream: true, fim: route.mode === "fim" }
      });
    }

    response.end();
    return;
  }

  try {
    const result = await router.completeInline(completionRequest, INLINE_SYSTEM);

    writeJson(
      response,
      200,
      {
        text: result.text,
        alternatives: [],
        model: result.model,
        provider: result.provider,
        latencyMs: Date.now() - started,
        usage: result.usage,
        fim: route.mode === "fim"
      },
      responseHeaders
    );

    await org.planQuota?.recordTokens(org.orgId, org.plan, {
      eventType: "completion.suggested",
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      provider: result.provider,
      model: result.model,
      userId: org.userId,
      principal: org.principal ?? "anonymous",
      metadata: { source: "inline", fim: route.mode === "fim" }
    });
  } catch (error) {
    writeJson(response, 502, {
      error: "provider_failure",
      message: error instanceof Error ? error.message : "Inline completion failed."
    });
  }
}

type ParsedInlineBody =
  | {
      ok: true;
      record: Record<string, unknown>;
      message: string;
      segments?: { prefix: string; suffix: string };
    }
  | { ok: false; message: string };

export function parseInlineBody(body: unknown): ParsedInlineBody {
  const record = asRecord(body);
  const message = typeof record.message === "string" ? record.message : "";
  const segments = parseSegments(record.segments);

  if (!message.trim() && !segments?.prefix.trim()) {
    return { ok: false, message: "message or segments.prefix is required" };
  }

  if (segments && segments.prefix.length > MAX_PREFIX_CHARS) {
    return { ok: false, message: `segments.prefix exceeds ${MAX_PREFIX_CHARS} characters` };
  }
  if (segments && segments.suffix.length > MAX_SUFFIX_CHARS) {
    return { ok: false, message: `segments.suffix exceeds ${MAX_SUFFIX_CHARS} characters` };
  }

  return { ok: true, record, message, segments };
}

function parseSegments(value: unknown): { prefix: string; suffix: string } | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const entry = value as Record<string, unknown>;
  if (typeof entry.prefix !== "string") {
    return undefined;
  }
  return {
    prefix: entry.prefix,
    suffix: typeof entry.suffix === "string" ? entry.suffix : ""
  };
}

function readProvider(value: unknown, fallback: LlmProvider): LlmProvider {
  if (
    value === "openai" ||
    value === "anthropic" ||
    value === "deepseek" ||
    value === "gemini" ||
    value === "mistral"
  ) {
    return value;
  }
  return fallback;
}

export function defaultInlineModelFor(provider: LlmProvider): string {
  return defaultInlineModelForProvider(provider);
}

function writeSse(response: ServerResponse, payload: unknown): void {
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function writeJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
  headers?: Record<string, string>
): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    ...headers
  });
  response.end(JSON.stringify(body));
}

function bindAbort(request: IncomingMessage | undefined, controller: AbortController): void {
  request?.on("close", () => controller.abort());
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}
