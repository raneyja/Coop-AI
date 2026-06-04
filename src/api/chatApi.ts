import type { IncomingMessage, ServerResponse } from "node:http";
import { createRequestId, ModelRouter } from "./ModelRouter";
import type { LlmServerConfig } from "./llmServerConfig";
import { loadLlmServerConfig } from "./llmServerConfig";
import type { LlmProvider } from "./zeroRetentionConfig";
import { handleInlineCompletionRequest } from "./inlineCompletionApi";
import type { ChatOrgPlan, UseCase, V1ChatRequestBody } from "./types";
import {
  requireAuth,
  requireOrgPlan,
  resolveAuthContext,
  resolveOrgPlanFromDb
} from "../server/authMiddleware";
import type { OrgStore } from "../server/orgStore";
import { AuditLogger, auditActor } from "../server/audit/auditLogger";
import type { UserStore } from "../server/users/userStore";
import { loadServerConfig, type ServerConfig } from "../server/serverConfig";

export type ChatApiDeps = {
  router?: ModelRouter;
  config?: LlmServerConfig;
  orgStore?: OrgStore;
  serverConfig?: ServerConfig;
  auditLogger?: AuditLogger;
  userStore?: UserStore;
};

type ParsedChatRequest = {
  method: string;
  pathname: string;
  headers: Record<string, string | undefined>;
  body: unknown;
};

type ChatOrgContext = {
  orgId: string;
  plan: ChatOrgPlan;
  userId?: string;
  principal: string;
};

export function createChatRouter(deps: ChatApiDeps = {}): ModelRouter {
  return deps.router ?? new ModelRouter({ config: deps.config ?? loadLlmServerConfig() });
}

export async function handleChatApiRequest(
  parsed: ParsedChatRequest,
  response: ServerResponse,
  deps: ChatApiDeps = {},
  rawRequest?: IncomingMessage
): Promise<boolean> {
  const config = deps.config ?? loadLlmServerConfig();
  const serverConfig = deps.serverConfig ?? loadServerConfig();

  if (parsed.pathname === "/v1/completions/inline" && parsed.method === "POST") {
    const org = await resolveChatOrg(parsed.headers, deps, serverConfig, response);
    if (!org) {
      return true;
    }
    const router = createChatRouter(deps);
    try {
      await handleInlineCompletionRequest(parsed.body, response, router, config, org);
    } finally {
      await deps.auditLogger?.record({
        orgId: org.orgId,
        userId: org.userId,
        principal: org.principal,
        action: "completion.inline"
      });
    }
    return true;
  }

  if (parsed.pathname !== "/v1/chat" || parsed.method !== "POST") {
    return false;
  }

  const org = await resolveChatOrg(parsed.headers, deps, serverConfig, response);
  if (!org) {
    return true;
  }

  const body = asRecord(parsed.body) as V1ChatRequestBody;
  const message = typeof body.message === "string" ? body.message : "";
  const attachments = Array.isArray(body.attachments) ? body.attachments.filter(isImageAttachment) : [];
  if (!message.trim() && attachments.length === 0) {
    writeJson(response, 400, { error: "invalid_request", message: "message or attachments required" });
    return true;
  }

  const router = createChatRouter(deps);
  const provider = readProvider(body.provider, config.defaultProvider);
  const model = typeof body.model === "string" && body.model ? body.model : defaultModelFor(provider);
  const requestId = createRequestId();

  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive"
  });

  const abortController = new AbortController();
  bindAbort(rawRequest, abortController);

  try {
    for await (const chunk of router.stream(
      {
        requestId,
        orgId: org.orgId,
        plan: org.plan,
        message: body.message,
        history: Array.isArray(body.history) ? body.history.filter(isHistoryMessage) : [],
        context: body.context,
        attachments: attachments.length ? attachments : undefined,
        useCase: readUseCase(body.useCase),
        allowUnapprovedProvider: config.allowUnapprovedProvider,
        modelConfig: {
          provider,
          model,
          temperature: typeof body.temperature === "number" ? body.temperature : 0.5,
          maxTokens: typeof body.maxTokens === "number" ? body.maxTokens : 2000
        }
      },
      abortController.signal
    )) {
      writeSse(response, chunk);
      if (chunk.type === "error") {
        break;
      }
    }
  } catch (error) {
    writeSse(response, {
      type: "error",
      message: error instanceof Error ? error.message : "Chat stream failed."
    });
  }

  await deps.auditLogger?.record({
    orgId: org.orgId,
    userId: org.userId,
    principal: org.principal,
    action: "chat.completion",
    metadata: { provider, model, requestId }
  });

  response.end();
  return true;
}

export function llmHealthPayload(router: ModelRouter): Record<string, unknown> {
  return {
    mockMode: router.isMockMode(),
    configuredProviders: router.getConfiguredProviders()
  };
}

async function resolveChatOrg(
  headers: Record<string, string | undefined>,
  deps: ChatApiDeps,
  serverConfig: ServerConfig,
  response: ServerResponse
): Promise<ChatOrgContext | undefined> {
  const auth = await resolveAuthContext(
    headers,
    deps.orgStore,
    serverConfig.legacyApiToken,
    serverConfig.requireApiAuth,
    deps.userStore
  );

  if (!requireAuth(auth, serverConfig.requireApiAuth)) {
    writeJson(response, 401, { error: "unauthorized" });
    return undefined;
  }

  if (!auth) {
    return { orgId: "dev", plan: "free", principal: "dev" };
  }

  if (!(await requireOrgPlan(deps.orgStore, auth, response, "free", "pro", "enterprise"))) {
    return undefined;
  }

  const plan = (await resolveOrgPlanFromDb(deps.orgStore, auth)) ?? auth.plan;
  const actor = auditActor(auth);
  return { orgId: auth.orgId, plan, userId: actor.userId, principal: actor.principal };
}

function writeSse(response: ServerResponse, payload: unknown): void {
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function bindAbort(request: IncomingMessage | undefined, controller: AbortController): void {
  request?.on("close", () => controller.abort());
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function isHistoryMessage(
  value: unknown
): value is { role: "user" | "assistant"; content: string; attachments?: Array<{ id: string; name: string; mimeType: string; dataUrl: string }> } {
  if (typeof value !== "object" || !value) {
    return false;
  }
  const entry = value as Record<string, unknown>;
  if ((entry.role !== "user" && entry.role !== "assistant") || typeof entry.content !== "string") {
    return false;
  }
  if (entry.attachments === undefined) {
    return true;
  }
  return Array.isArray(entry.attachments) && entry.attachments.every(isImageAttachment);
}

function isImageAttachment(value: unknown): value is { id: string; name: string; mimeType: string; dataUrl: string } {
  if (typeof value !== "object" || !value) {
    return false;
  }
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === "string" &&
    typeof entry.name === "string" &&
    typeof entry.mimeType === "string" &&
    typeof entry.dataUrl === "string" &&
    entry.dataUrl.startsWith("data:image/")
  );
}

function readProvider(value: unknown, fallback: LlmProvider): LlmProvider {
  if (value === "openai" || value === "anthropic" || value === "deepseek" || value === "gemini") {
    return value;
  }
  return fallback;
}

function readUseCase(value: unknown): UseCase {
  const allowed: UseCase[] = [
    "comprehension",
    "decision_archaeology",
    "ownership",
    "blast_radius",
    "knowledge_gaps",
    "chat",
    "inline_completion"
  ];
  if (typeof value === "string" && (allowed as string[]).includes(value)) {
    return value as UseCase;
  }
  return "chat";
}

function defaultModelFor(provider: LlmProvider): string {
  switch (provider) {
    case "openai":
      return "gpt-4o-mini";
    case "anthropic":
      return "claude-3-5-sonnet-20241022";
    case "deepseek":
      return "deepseek-chat";
    case "gemini":
      return "gemini-1.5-flash";
  }
}
