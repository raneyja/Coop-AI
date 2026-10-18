import { buildChatContinuation, isNativeContinuationEligible, normalizeChatRequestBody } from "./chatContinuation";
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { SourceTurnDenied, ordinaryContinuationHash, ordinaryPlanPrompt, sourceTurnActorBinding, type SourceTurnAuthority, type TurnAdmission } from "../server/sourceTurnAuthority";
import {parseAgentToolPlan} from "./agent/parseAgentToolPlan";
import { ModelRouter } from "./ModelRouter";
import type { LlmServerConfig } from "./llmServerConfig";
import { loadLlmServerConfig } from "./llmServerConfig";
import type { LlmProvider } from "./zeroRetentionConfig";
import { DEFAULT_MODEL_BY_PROVIDER } from "../config/llmModels";
import { resolveHonoredChatModel, SOURCE_VERIFICATION_MAX_TOKENS } from "../config/featureModelAssignments";
import { resolveChatOutputMaxTokens } from "../config/chatOutputBudget";
import { handleInlineCompletionRequest, defaultInlineModelFor } from "./inlineCompletionApi";
import type { ChatOrgPlan, UseCase, V1ChatRequestBody, StreamChunk } from "./types";
import {
  requireAuth,
  requireOrgPlan,
  resolveAuthContext,
  resolveOrgPlanFromDb
} from "../server/authMiddleware";
import type { OrgStore } from "../server/orgStore";
import { AuditLogger, auditActor } from "../server/audit/auditLogger";
import type { UsageTracker } from "../server/usageTracker";
import type { UserStore } from "../server/users/userStore";
import { loadServerConfig, type ServerConfig } from "../server/serverConfig";
import { captureException } from "../server/observability/errorReporter";
import { resolveHttpRequestId } from "../server/observability/requestId";
import {
  createPlanQuotaService,
  estimateChatRequestTokens,
  PlanQuotaExceededError,
  PlanQuotaUnavailableError,
  type PlanQuotaService,
  writePlanQuotaExceededResponse,
  writePlanQuotaUnavailableResponse
} from "../server/planQuota";
import { countsAsFreeQuotaMessage } from "../server/freeAllowance";
import type { UsageTier } from "../server/usageTiers";
import { isValidPaperclipDataUrl, isAcceptedPaperclipMimeType, isVisionWeightedPaperclipAttachment } from "../chat/paperclipAttachments";

import type { GraphQueryApi } from "./graphQuery";
import type { InlineGraphFileSnippetFetcher } from "./inlineGraphContext";

export type ChatApiDeps = {
  router?: ModelRouter;
  config?: LlmServerConfig;
  orgStore?: OrgStore;
  serverConfig?: ServerConfig;
  auditLogger?: AuditLogger;
  usageTracker?: UsageTracker;
  userStore?: UserStore;
  planQuota?: PlanQuotaService;
  graphQuery?: GraphQueryApi;
  fetchFileSnippet?: InlineGraphFileSnippetFetcher;
  sourceTurnAuthority?: Pick<SourceTurnAuthority, "admit" | "complete" | "close"> & Partial<Pick<SourceTurnAuthority, "settle" | "markDispatched">>;
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
  usageTier?: UsageTier | null;
  createdAt?: Date;
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
  const requestStarted = performance.now();
  const config = deps.config ?? loadLlmServerConfig();
  const serverConfig = deps.serverConfig ?? loadServerConfig();

  if (parsed.pathname === "/v1/completions/inline" && parsed.method === "POST") {
    const org = await resolveChatOrg(parsed.headers, deps, serverConfig, response);
    if (!org) {
      return true;
    }
    const planQuota = resolvePlanQuota(deps);
    const inlineBody = asRecord(parsed.body);
    const maxTokens =
      typeof inlineBody.maxTokens === "number" ? Math.min(inlineBody.maxTokens, 200) : 96;
    const provider = readProvider(inlineBody.provider, config.defaultProvider);
    const model =
      typeof inlineBody.model === "string" && inlineBody.model
        ? inlineBody.model
        : defaultInlineModelFor(provider);
    const inlineMessage =
      typeof inlineBody.message === "string"
        ? inlineBody.message
        : typeof (inlineBody.segments as { prefix?: string } | undefined)?.prefix === "string"
          ? (inlineBody.segments as { prefix: string }).prefix
          : "";
    try {
      // Ghost fetch must not consume paid monthly usage. Free already skips allowance.
      // Accept path bills via completion.accepted (see usageEventsApi).
      await planQuota.check(
        org.orgId,
        org.plan,
        estimateChatRequestTokens({
          message: inlineMessage,
          maxTokens,
          provider,
          model
        }),
        undefined,
        {
          usageTier: org.usageTier,
          userId: org.userId,
          selection: "auto",
          provider,
          model,
          forceAutoBucket: true,
          periodAnchor: org.createdAt
        },
        { skipFreeAllowance: true, skipPaidCap: true }
      );
    } catch (error) {
      if (error instanceof PlanQuotaExceededError) {
        writePlanQuotaExceededResponse(response, error);
        return true;
      }
      if (error instanceof PlanQuotaUnavailableError) {
        writePlanQuotaUnavailableResponse(response, error);
        return true;
      }
      throw error;
    }
    const router = createChatRouter(deps);
    try {
      await handleInlineCompletionRequest(
        parsed.body,
        response,
        router,
        config,
        {
          ...org,
          planQuota
        },
        rawRequest,
        { graphQuery: deps.graphQuery, fetchFileSnippet: deps.fetchFileSnippet }
      );
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

  if (!["/v1/chat", "/v1/chat/source-turn/close"].includes(parsed.pathname) || parsed.method !== "POST") {
    return false;
  }

  const org = await resolveChatOrg(parsed.headers, deps, serverConfig, response);
  if (!org) {
    return true;
  }

  const syntheticOrg = org.orgId === "dev" || org.orgId === "legacy";
  const authority = syntheticOrg ? undefined : deps.sourceTurnAuthority;
  const actorBinding = sourceTurnActorBinding(org.orgId, org.principal, parsed.headers.authorization);
  if (parsed.pathname === "/v1/chat/source-turn/close") {
    const id = asRecord(parsed.body).quotaTurnId;
    if (typeof id !== "string" || !id.trim() || id.length > 160) {
      writeJson(response, 400, {error: "invalid_request"}); return true;
    }
    if (!authority) { writeJson(response, 503, {error: "source_authority_unavailable"}); return true; }
    await authority.close(org.orgId, actorBinding, id.trim());
    writeJson(response, 200, {ok: true}); return true;
  }

  const body = asRecord(parsed.body) as V1ChatRequestBody;
  const message = typeof body.message === "string" ? body.message : "";
  const attachments = Array.isArray(body.attachments) ? body.attachments.filter(isPaperclipAttachment) : [];
  if (!message.trim() && attachments.length === 0) {
    writeJson(response, 400, { error: "invalid_request", message: "message or attachments required" });
    return true;
  }

  const planQuota = resolvePlanQuota(deps);
  const sourceVerificationModel = body.sourceClaimReview === true || body.sourceEvidenceRepair === true;
  const planning = body.ordinaryTurn?.phase === "plan";
  const maxTokens = planning ? 600 : sourceVerificationModel ? SOURCE_VERIFICATION_MAX_TOKENS : resolveChatOutputMaxTokens(
    typeof body.maxTokens === "number" ? body.maxTokens : undefined
  );
  const history = Array.isArray(body.history) ? body.history.filter(isHistoryMessage) : [];
  const visionAttachmentCount = countVisionWeightedAttachments(attachments);
  const visionWeighted =
    visionAttachmentCount > 0 ||
    history.some((entry) => countVisionWeightedAttachments(entry.attachments) > 0);
  const useCase = readUseCase(body.useCase);
  if ((body.sourceClaimReview !== undefined && typeof body.sourceClaimReview !== "boolean")
    || (body.sourceEvidenceSynthesis !== undefined && typeof body.sourceEvidenceSynthesis !== "boolean")
    || (body.sourceEvidenceRepair !== undefined && typeof body.sourceEvidenceRepair !== "boolean")
    || (body.sourceClaimReview === true && body.sourceEvidenceSynthesis === true)
    || (body.sourceEvidenceRepair === true && (body.sourceEvidenceSynthesis !== true || body.sourceClaimReview === true))) {
    writeJson(response, 400, { error: "invalid_request", message: "Invalid private source phase flags" });
    return true;
  }
  if ((body.sourceClaimReview === true || body.sourceEvidenceSynthesis === true)
    && !["blast_radius", "knowledge_gaps", "comprehension", "decision_archaeology", "ownership"].includes(useCase)) {
    writeJson(response, 400, { error: "invalid_request", message: "Source claim review requires a source quick action" });
    return true;
  }
  // The private phase has exactly one input envelope. Never admit additional
  // history, media or legacy context alongside the bytes whose digest is bound.
  if ((body.sourceClaimReview === true || body.sourceEvidenceSynthesis === true)
    && ((body.history !== undefined && (!Array.isArray(body.history) || body.history.length > 0))
      || (body.attachments !== undefined && (!Array.isArray(body.attachments) || body.attachments.length > 0))
      || Object.keys(asRecord(body.context)).some(key => !["owner","repo","branch","file"].includes(key)))) {
    writeJson(response, 400, {error: "invalid_request", message: "Private source phases accept only their frozen evidence envelope."}); return true;
  }
  const clientProvider = readProvider(body.provider, config.defaultProvider);
  const clientModel = typeof body.model === "string" && body.model ? body.model : undefined;
  const honored = resolveHonoredChatModel({
    allowUnapprovedProvider: config.allowUnapprovedProvider,
    plan: org.plan,
    useCase,
    clientProvider,
    clientModel,
    sourceClaimReview: body.sourceClaimReview === true,
    sourceEvidenceRepair: body.sourceEvidenceRepair === true
  });
  const provider = honored.provider;
  const model = honored.model;
  const selection = honored.selection;
  const honoredRoute = {provider,model,maxTokens,temperature:planning ? 0 : typeof body.temperature === "number" ? body.temperature : 0.5};
  const admittedBody = normalizeChatRequestBody({...body,history,attachments:attachments.length ? attachments : undefined});
  const abortController = new AbortController();
  bindAbort(rawRequest, response, abortController);
  const requestId = resolveHttpRequestId(parsed.headers);
  let admittedTurn: TurnAdmission;
  const checkTurn = (quota: PlanQuotaService, id: string, continuation: boolean, now = new Date()) => quota.check(
    org.orgId, org.plan, estimateChatRequestTokens({message,history,maxTokens,imageAttachmentCount: visionAttachmentCount,provider,model}),
    now, {usageTier: org.usageTier,userId: org.userId,selection,provider,model,
      quotaTurnId: id,internalSourceCall: continuation,periodAnchor: org.createdAt});
  try {
    if (!authority && (body.sourceClaimReview === true || body.sourceEvidenceSynthesis === true || (!syntheticOrg && body.ordinaryTurn !== undefined))) {
      writeJson(response, 503, {error: "source_authority_unavailable"}); return true;
    }
    if (authority) admittedTurn = await authority.admit({orgId: org.orgId,actorBinding,body:admittedBody,honoredRoute,
      quota: planQuota,billingContext:{plan:org.plan,entry:{eventType:"chat.message",provider,model,selection,userId:org.userId,principal:org.principal,
        usageTier:org.usageTier,useCase,visionWeighted,
        countsAsMessage:countsAsFreeQuotaMessage(useCase),metadata:{requestId,
          ...(body.sourceClaimReview===true?{sourceClaimReview:true}:{}),...(body.sourceEvidenceRepair===true?{sourceEvidenceRepair:true}:{}),
          ...(body.sessionMode?{sessionMode:body.sessionMode}:{}),...(body.fileSource?{fileSource:body.fileSource}:{})}}},signal: abortController.signal,billingSubject: planQuota.cappedSubject(org.orgId,org.plan,org),check: checkTurn});
    else { admittedTurn = {id: randomUUID(),source: false}; await checkTurn(planQuota,admittedTurn.id,false); }
  } catch (error) {
    if (error instanceof SourceTurnDenied || error instanceof SyntaxError) {
      writeJson(response, 409, {error: "source_turn_unavailable",message: "Start a new source turn; this phase does not match an active turn."}); return true;
    }
    if (error instanceof PlanQuotaExceededError) {
      writePlanQuotaExceededResponse(response, error);
      return true;
    }
    if (error instanceof PlanQuotaUnavailableError) {
      writePlanQuotaUnavailableResponse(response, error);
      return true;
    }
    throw error;
  }

  const router = createChatRouter(deps);
  const billingCallId = admittedTurn.callId ?? randomUUID();

  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "x-request-id": requestId
  });

  const timing = body.responseTiming;
  const timingEnabled = timing && typeof timing.traceId === "string" && typeof timing.callId === "string"
    && /^[a-zA-Z0-9_-]{1,128}$/.test(timing.traceId) && /^[a-zA-Z0-9_-]{1,160}$/.test(timing.callId);
  const emitTiming = (event: string) => {
    if (timingEnabled && !response.destroyed) {
      try { writeSse(response, { type: "response-timing",
        traceId: timing.traceId, callId: timing.callId, requestId, event,
        elapsedMs: Math.max(0, performance.now() - requestStarted) }); }
      catch { /* Optional diagnostics must not interrupt provider processing. */ }
    }
  };
  emitTiming("accepted");
    let usageTokens: { inputTokens: number; outputTokens: number } | undefined;
    let recordedUsage = false;
    let usageWriteFailed = false;
    let firstDelta = false;
    let modelFailed = false;
    let planContent = "";
    let answerContent = "";
    let terminal: Extract<StreamChunk, {type: "done"}> | undefined;
    let streamErrorSent = false;
    const recordUsage = async (usage: Parameters<typeof recordV1ChatUsageTokens>[3]) => {
      const record = (quota: PlanQuotaService) => recordV1ChatUsageTokens(quota,org,{provider,model,selection},usage);
      if (authority?.settle) await authority.settle(admittedTurn,planQuota,!modelFailed && !abortController.signal.aborted,record,
        admittedBody.ordinaryTurn?.phase === "answer" && terminal && !modelFailed
          && isNativeContinuationEligible(terminal.finishReason,answerContent)
          ? ordinaryContinuationHash(buildChatContinuation(admittedBody,answerContent),honoredRoute) : undefined);
      else await record(planQuota);
    };

    try {
      emitTiming("model-start");
      for await (const chunk of router.stream(
        {
          requestId,
          onProviderDispatch: () => authority?.markDispatched?.(admittedTurn) ?? Promise.resolve(),
          orgId: org.orgId,
          plan: org.plan,
          message: planning ? ordinaryPlanPrompt(body) : body.message,
          ordinaryPlan: planning,
          history,
          context: admittedBody.context,
          attachments: attachments.length ? attachments : undefined,
          useCase,
          allowUnapprovedProvider: config.allowUnapprovedProvider,
          enableThinking: !planning && (sourceVerificationModel || body.enableThinking === true),
          sourceClaimReview: body.sourceClaimReview === true,
          sourceEvidenceSynthesis: body.sourceEvidenceSynthesis === true,
          sourceEvidenceRepair: body.sourceEvidenceRepair === true,
          sessionMode: body.sessionMode,
          modelConfig: {
            provider,
            model,
            temperature: planning ? 0 : typeof body.temperature === "number" ? body.temperature : 0.5,
            maxTokens
          }
        },
        abortController.signal
      )) {
        if (chunk.type === "done") {
          if (terminal) throw new Error("Provider returned more than one terminal result.");
          terminal = chunk;
          if (chunk.finishReason === "error" || chunk.finishReason === "cancelled") modelFailed = true;
          if (chunk.usage.provenance === "provider-final"
            && [chunk.usage.inputTokens, chunk.usage.outputTokens].every(value => Number.isSafeInteger(value) && value >= 0)) {
            usageTokens = {inputTokens: chunk.usage.inputTokens, outputTokens: chunk.usage.outputTokens};
          }
          // Drain the generator before settlement/public terminal output: a
          // following error must close the grant, never leave it ready.
          continue;
        }
        if (terminal && chunk.type !== "error") throw new Error("Provider returned content after its terminal result.");
        if (!planning && chunk.type === "delta") answerContent += chunk.text;
        if (planning && chunk.type === "delta") {planContent += chunk.text; continue;}
        if (planning && chunk.type === "thinking") continue;
        if (chunk.type === "delta" && !firstDelta && chunk.text.trim()) {
          firstDelta = true; emitTiming("first-delta");
        }
        if (chunk.type === "error") {modelFailed = true; streamErrorSent = true;}
        writeSse(response, chunk);
        if (chunk.type === "error") break;
      }
      let canonicalPlan: string | undefined;
      if (planning && terminal && !modelFailed) {
        const input = JSON.parse(message) as Parameters<typeof parseAgentToolPlan>[1];
        const plan = parseAgentToolPlan(planContent, input);
        let strict: unknown; try {strict = JSON.parse(planContent);} catch {strict = undefined;}
        if (!strict || plan.kind === "invalid" || Object.keys(strict).some(key => !["done", "tool", "args"].includes(key))) {
          modelFailed = true;
        } else canonicalPlan = JSON.stringify(plan.kind === "done" ? {done: true} : {tool: plan.tool, args: plan.args});
      }
      if (terminal && !usageTokens && !syntheticOrg) modelFailed = true;
      if (usageTokens) {
        try {
          await recordUsage({inputTokens: usageTokens.inputTokens, outputTokens: usageTokens.outputTokens,
            requestId, billingCallId, visionWeighted, sessionMode: body.sessionMode, fileSource: body.fileSource,
            useCase, quotaTurnId: admittedTurn.id, sourceClaimReview: body.sourceClaimReview === true,
            sourceEvidenceRepair: body.sourceEvidenceRepair === true});
          recordedUsage = true;
        } catch (error) {usageWriteFailed = true; throw error;}
      }
      if (modelFailed && !streamErrorSent) {
        streamErrorSent = true;
        writeSse(response, {type: "error", message: terminal && !usageTokens
          ? "Provider final token usage is unavailable; this request requires metering reconciliation."
          : "The provider did not complete this answer successfully."});
      }
      if (terminal && !modelFailed && !abortController.signal.aborted) {
        if (canonicalPlan) writeSse(response, {type: "delta", text: canonicalPlan});
        writeSse(response, terminal);
      }
      emitTiming(abortController.signal.aborted ? "canceled" : modelFailed ? "failed" : recordedUsage ? "completed" : "incomplete");
    } catch (error) {
    modelFailed = true;
    emitTiming(abortController.signal.aborted ? "canceled" : "failed");
    captureException(error, {
      service: "api",
      orgId: org.orgId,
      requestId,
      route: "/v1/chat"
    });
    writeSse(response, {
      type: "error",
      message: error instanceof Error ? error.message : "Chat stream failed.",
      requestId
    });
  }

  try {
  await deps.auditLogger?.record({
    orgId: org.orgId,
    userId: org.userId,
    principal: org.principal,
    action: "chat.completion",
    metadata: { provider, model, requestId }
  });
  if (usageTokens && !recordedUsage && !usageWriteFailed) {
    await recordUsage({
      inputTokens: usageTokens.inputTokens,
      outputTokens: usageTokens.outputTokens,
      requestId,
      billingCallId,
      visionWeighted,
      sessionMode: body.sessionMode,
      fileSource: body.fileSource,
      useCase,
      quotaTurnId: admittedTurn.id,
      sourceClaimReview: body.sourceClaimReview === true,
      sourceEvidenceRepair: body.sourceEvidenceRepair === true
    });
  }

  } finally {
    try { if (!recordedUsage || !authority?.settle) await authority?.complete(admittedTurn, recordedUsage && !modelFailed && !abortController.signal.aborted); }
    finally { response.end(); }
  }
  return true;
}

export function llmHealthPayload(router: ModelRouter): Record<string, unknown> {
  return {
    mockMode: router.isMockMode(),
    configuredProviders: router.getConfiguredProviders()
  };
}

/**
 * Record a finished `/v1/chat` stream on the usage bar.
 * `eventType` is always `chat.message` so quota pools see it. Do not invent tokens
 * when the stream never returned usage. Do not set `forceAutoBucket` here —
 * `intent_suggest` bills Auto because `resolveHonoredChatModel` returns
 * `selection: "auto"` (picker does not apply).
 */
export async function recordV1ChatUsageTokens(
  planQuota: PlanQuotaService,
  org: Pick<ChatOrgContext, "orgId" | "plan" | "userId" | "principal" | "usageTier">,
  honored: { provider: LlmProvider; model: string; selection: string },
  usage: {
    inputTokens: number;
    outputTokens: number;
    requestId?: string;
    billingCallId?: string;
    visionWeighted?: boolean;
    sessionMode?: "file-assistant" | "indexed-repo";
    fileSource?: "workspace" | "git" | "remote" | "external";
    useCase?: UseCase;
    quotaTurnId?: string;
    sourceClaimReview?: boolean;
    sourceEvidenceRepair?: boolean;
  }
): Promise<void> {
  await planQuota.recordTokens(org.orgId, org.plan, {
    eventType: "chat.message",
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    provider: honored.provider,
    model: honored.model,
    userId: org.userId,
    principal: org.principal,
    metadata: {
      requestId: usage.requestId,
      ...(usage.billingCallId ? {billingCallId: usage.billingCallId} : {}),
      ...(usage.sourceClaimReview === true ? { sourceClaimReview: true } : {}),
      ...(usage.sourceEvidenceRepair === true ? { sourceEvidenceRepair: true } : {}),
      ...(usage.sessionMode ? { sessionMode: usage.sessionMode } : {}),
      ...(usage.fileSource ? { fileSource: usage.fileSource } : {})
    },
    visionWeighted: usage.visionWeighted,
    selection: honored.selection,
    usageTier: org.usageTier,
    useCase: usage.useCase,
    quotaTurnId: usage.quotaTurnId,
    countsAsMessage: countsAsFreeQuotaMessage(usage.useCase)
  });
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
  const stored = auth.orgId !== "legacy" ? await deps.orgStore?.getOrganization(auth.orgId) : undefined;
  let usageTier = stored?.usageTier;
  if (actor.userId && deps.userStore) {
    const user = await deps.userStore.getUser(actor.userId);
    usageTier = user?.usageTier ?? stored?.usageTier;
  }
  return {
    orgId: auth.orgId,
    plan,
    userId: actor.userId,
    principal: actor.principal,
    usageTier,
    createdAt: stored?.createdAt
  };
}

function writeSse(response: ServerResponse, payload: unknown): void {
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function bindAbort(request: IncomingMessage | undefined, response: ServerResponse, controller: AbortController): void {
  // IncomingMessage.close means the request body completed, not that its
  // streamed response disconnected. Observe the actual response/socket too.
  request?.on("aborted", () => controller.abort());
  response.on?.("close", () => { if (!response.writableEnded) controller.abort(); });
  if (request?.aborted || response.destroyed) controller.abort();
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
  return Array.isArray(entry.attachments) && entry.attachments.every(isPaperclipAttachment);
}

function isPaperclipAttachment(value: unknown): value is { id: string; name: string; mimeType: string; dataUrl: string } {
  if (typeof value !== "object" || !value) {
    return false;
  }
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === "string" &&
    typeof entry.name === "string" &&
    typeof entry.mimeType === "string" &&
    typeof entry.dataUrl === "string" &&
    isValidPaperclipDataUrl(entry.dataUrl) &&
    isAcceptedPaperclipMimeType(entry.mimeType, entry.name)
  );
}

function countVisionWeightedAttachments(attachments: unknown[] | undefined): number {
  if (!Array.isArray(attachments)) {
    return 0;
  }
  return attachments.filter(
    (attachment): attachment is { id: string; name: string; mimeType: string; dataUrl: string } =>
      isPaperclipAttachment(attachment) && isVisionWeightedPaperclipAttachment(attachment)
  ).length;
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

export function readUseCase(value: unknown): UseCase {
  const allowed: UseCase[] = [
    "comprehension",
    "decision_archaeology",
    "ownership",
    "blast_radius",
    "knowledge_gaps",
    "integration",
    "intent_job",
    "chat",
    "code_edit",
    "inline_completion",
    "intent_suggest",
    "evidence_preview",
    "pr_summary"
  ];
  if (typeof value === "string" && (allowed as string[]).includes(value)) {
    return value as UseCase;
  }
  return "chat";
}

function defaultModelFor(provider: LlmProvider): string {
  return DEFAULT_MODEL_BY_PROVIDER[provider];
}

function resolvePlanQuota(deps: ChatApiDeps): PlanQuotaService {
  return deps.planQuota ?? createPlanQuotaService(deps.usageTracker);
}
