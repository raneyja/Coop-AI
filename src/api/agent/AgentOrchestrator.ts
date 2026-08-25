import {
  AGENT_JOB_WALL_MS,
  AGENT_MAX_FILES_READ,
  AGENT_MAX_TOOL_ROUNDS
} from "../../config/agentJobBudget";
import type { IntegrationChatProvider } from "../../chat/types";
import type {
  AgentConversationMessage,
  AgentPlanTurnFn,
  AgentSessionContext,
  AgentSessionRequest,
  AgentSessionResult,
  AgentStep,
  AgentStreamAnswerFn,
  AgentToolName
} from "./agentTypes";
import type { AgentToolContext } from "./agentToolContext";
import { parseAgentToolPlan } from "./parseAgentToolPlan";
import {
  fallbackAgentSearchQueries,
  namedSymbolKeys,
  pickSearchHitsToRead,
  pickSymbolHitsToRead,
  pickTopSearchHit,
  queryHasNamedSymbol,
  queryRoleHints,
  rankSearchHits,
  sanitizeAgentSearchQuery,
  shouldSkipEvidencePath,
  textMentionsNamedSymbol,
  textMentionsQueryRoles
} from "./searchQuery";
import { createAgentToolRegistry } from "./tools/registry";
import { handleIntegrationSearch } from "./tools/integrationSearch";
import {
  agentToolForIntegrationProvider,
  isAgentIntegrationTool
} from "./integrationTools";
import { isRepoStructureQuery } from "../../workspace/repoFactIntent";
import { isFeatureAddAsk } from "../../context/existingCapabilityGrounding";

export { pickTopSearchHit };

const DEFAULT_MAX_STEPS = AGENT_MAX_TOOL_ROUNDS;
const READ_LINE_PADDING = 25;
/** Each retry is another round trip — the gather budget is shared with the answer. */
const MAX_SEARCH_ATTEMPTS = 3;
/** Read budget when the index returned a hit with no line number. */
const UNPOSITIONED_READ_LINES = 120;
const INDEX_HUNT_MISS =
  "I could not find an indexed file that matches that symbol or role (tried casing aliases). I will not guess a path. Confirm the name, or open the file and use /edit.";
/** Cap mid-loop integration calls so the model cannot spray. */
const MAX_INTEGRATION_TOOL_CALLS = 3;

type SearchHit = {
  fileName: string;
  lineNumber: number;
  score?: number;
  content?: string;
};

type SymbolHit = {
  file: string;
  line: number;
  symbol?: string;
  displayName?: string;
  kind?: string;
};

type SearchPayload = {
  error?: string;
  hits?: SearchHit[];
  symbols?: SymbolHit[];
};

type ReadFilePayload = {
  path?: string;
  files?: Array<{ path: string; content: string }>;
  error?: string;
};

/**
 * Window around a match. When the index gave no position, read the opening of the
 * file instead of pretending the match is on line 1 — a fabricated window silently
 * feeds the model the wrong lines and it answers from them.
 */
function readLineWindow(lineNumber: number): { startLine: number; endLine: number } {
  if (!Number.isInteger(lineNumber) || lineNumber < 1) {
    return { startLine: 1, endLine: UNPOSITIONED_READ_LINES };
  }
  return {
    startLine: Math.max(1, lineNumber - READ_LINE_PADDING),
    endLine: lineNumber + READ_LINE_PADDING
  };
}

export type AgentRunOptions = {
  onStep?: (step: AgentStep, steps: AgentStep[]) => void;
  /** When set, the same model conversation chooses tools. Missing/invalid first plan → deterministic fallback. */
  planTurn?: AgentPlanTurnFn;
  /** Same conversation, after tools: stream the user-visible answer. */
  streamAnswer?: AgentStreamAnswerFn;
  signal?: AbortSignal;
  startedAt?: number;
  wallMs?: number;
  /** Planner allowlist — mid-loop may only call these integration tools. */
  allowedIntegrations?: IntegrationChatProvider[];
  /** Live integration search for allowlisted mid-loop tools. */
  searchIntegration?: (options: {
    provider: IntegrationChatProvider;
    query: string;
  }) => Promise<Record<string, unknown>>;
};

/**
 * Agent tool loop for locate / understand / change.
 *
 * Live path: one model conversation (`planTurn`) chooses tools, sees results,
 * then `streamAnswer` writes the user-visible answer. There is no user toggle.
 * Allowlisted integrations may be called mid-loop when discovered.
 * Deterministic search→read is only the no-planTurn fallback (tests / fail-open).
 */
export class AgentOrchestrator {
  private readonly registry;
  private runAllowedIntegrations: IntegrationChatProvider[] = [];
  private runSearchIntegration?: AgentRunOptions["searchIntegration"];

  public constructor(private readonly ctx: AgentToolContext) {
    this.registry = createAgentToolRegistry(ctx);
  }

  public async executeTool(tool: AgentToolName, args: Record<string, unknown>): Promise<string> {
    if (isAgentIntegrationTool(tool)) {
      return handleIntegrationSearch(
        {
          ...this.ctx,
          allowedIntegrations: this.runAllowedIntegrations,
          searchIntegration: this.runSearchIntegration ?? this.ctx.searchIntegration
        },
        tool,
        args
      );
    }
    const handler = this.registry[tool];
    if (!handler) {
      throw new Error(`Tool not implemented: ${tool}`);
    }
    return handler(args);
  }

  public async run(
    request: AgentSessionRequest,
    options?: AgentRunOptions
  ): Promise<AgentSessionResult> {
    const maxSteps = Math.min(request.maxSteps ?? DEFAULT_MAX_STEPS, AGENT_MAX_TOOL_ROUNDS);
    const repoId = request.repoId?.trim();
    const query = request.message.trim();
    if (!repoId || !query || maxSteps < 1) {
      return { steps: [], context: undefined };
    }
    if (options?.signal?.aborted) {
      return { steps: [], context: undefined };
    }

    this.runAllowedIntegrations = options?.allowedIntegrations ?? [];
    this.runSearchIntegration = options?.searchIntegration;
    try {
      const action = request.action ?? "none";
      const openFile = request.openFile?.trim();
      if (options?.planTurn) {
        return await this.runOwnedLoop(repoId, query, maxSteps, action, options, openFile);
      }
      return await this.runDeterministic(repoId, query, maxSteps, options, openFile);
    } finally {
      this.runAllowedIntegrations = [];
      this.runSearchIntegration = undefined;
    }
  }

  /**
   * One conversation: tool JSON → execute → feed result back → stream answer.
   * Wrong-file reads cannot `{done:true}` — another search/read is required first.
   */
  private async runOwnedLoop(
    repoId: string,
    query: string,
    maxSteps: number,
    action: NonNullable<AgentSessionRequest["action"]>,
    options: AgentRunOptions,
    openFile?: string
  ): Promise<AgentSessionResult> {
    const planTurn = options.planTurn as AgentPlanTurnFn;
    const steps: AgentStep[] = [];
    const context: AgentSessionContext = {};
    const conversation: AgentConversationMessage[] = [{ role: "user", content: query }];
    const emit = (step: AgentStep) => {
      steps.push(step);
      options.onStep?.(step, [...steps]);
    };
    const startedAt = options.startedAt ?? Date.now();
    const wallMs = options.wallMs ?? AGENT_JOB_WALL_MS;
    let filesRead = 0;
    let integrationCalls = 0;
    let lastToolResult: string | undefined;
    let matchingRead = false;
    const allowedIntegrations = options.allowedIntegrations ?? [];
    const seeded = await this.seedOpenFileReadIfFeatureAdd(
      repoId,
      query,
      openFile,
      emit,
      context,
      conversation
    );
    if (seeded.ok) {
      matchingRead = true;
      filesRead = 1;
      lastToolResult = seeded.raw;
    }

    const canAnswerNow = (): boolean => {
      if (queryHasNamedSymbol(query) || queryRoleHints(query).length > 0) {
        return matchingRead;
      }
      return steps.length > 0;
    };

    for (let round = 0; round < maxSteps; round++) {
      if (options.signal?.aborted) {
        break;
      }
      if (Date.now() - startedAt > wallMs) {
        break;
      }

      let raw: string;
      try {
        raw = await planTurn({
          message: query,
          repoId,
          round,
          priorSteps: [...steps],
          lastToolResult,
          conversation: [...conversation],
          allowedIntegrations
        });
      } catch {
        if (steps.length === 0) {
          const fallback = await this.runDeterministic(repoId, query, maxSteps, options, openFile);
          return this.finishWithAnswer(
            fallback,
            query,
            repoId,
            action,
            options,
            undefined,
            Boolean(
              (fallback.context?.read_file as { files?: unknown[] } | undefined)?.files?.length
            )
          );
        }
        break;
      }

      const plan = parseAgentToolPlan(raw, { allowedIntegrations });
      if (plan.kind === "invalid") {
        if (steps.length === 0) {
          const fallback = await this.runDeterministic(repoId, query, maxSteps, options, openFile);
          return this.finishWithAnswer(
            fallback,
            query,
            repoId,
            action,
            options,
            undefined,
            Boolean(
              (fallback.context?.read_file as { files?: unknown[] } | undefined)?.files?.length
            )
          );
        }
        if (canAnswerNow() && looksLikeProseAnswer(raw)) {
          return this.finishWithAnswer(
            { steps, context, answer: raw.trim() },
            query,
            repoId,
            action,
            options,
            conversation,
            true
          );
        }
        lastToolResult = JSON.stringify({
          error: canAnswerNow()
            ? 'Reply {"done":true} so the next turn can answer the user, or call another repo tool.'
            : "Reply with a tool JSON call. You have not read a file that mentions the named symbol or role — do not answer yet."
        });
        conversation.push({ role: "assistant", content: raw.slice(0, 2000) });
        conversation.push({ role: "user", content: lastToolResult });
        continue;
      }

      if (plan.kind === "done") {
        if (!canAnswerNow()) {
          lastToolResult = JSON.stringify({
            error:
              "Do not finish yet. You have not read a file whose body mentions the named symbol or the role the user named (e.g. middleware). Call search_code or read_file on a different path — do not answer from a related UI, test, or form."
          });
          conversation.push({ role: "assistant", content: '{"done":true}' });
          conversation.push({ role: "user", content: lastToolResult });
          continue;
        }
        break;
      }

      if (plan.tool === "propose_patch") {
        if (action !== "change") {
          lastToolResult = JSON.stringify({
            error: "propose_patch is only allowed on change asks. Search/read, then {\"done\":true}."
          });
          continue;
        }
        if ((queryHasNamedSymbol(query) || queryRoleHints(query).length > 0) && !matchingRead) {
          lastToolResult = JSON.stringify({
            error:
              "Do not propose_patch until you have read a file that mentions the named symbol or role. Search/read again."
          });
          conversation.push({
            role: "assistant",
            content: JSON.stringify({ tool: plan.tool, args: plan.args })
          });
          conversation.push({ role: "user", content: lastToolResult });
          continue;
        }
      }

      if (plan.tool === "read_file") {
        if (filesRead >= AGENT_MAX_FILES_READ) {
          break;
        }
        filesRead += 1;
      }
      if (isAgentIntegrationTool(plan.tool)) {
        if (integrationCalls >= MAX_INTEGRATION_TOOL_CALLS) {
          break;
        }
        integrationCalls += 1;
      }

      const args = this.prepareToolArgs(plan.tool, plan.args, repoId, query);
      let rawResult: string;
      try {
        rawResult = await this.executeTool(plan.tool, args);
      } catch {
        break;
      }

      if (plan.tool === "read_file") {
        const judged = this.judgeReadResult(rawResult, query, args);
        rawResult = judged.raw;
        if (judged.matchesSymbol) {
          matchingRead = true;
          this.mergeContext(context, plan.tool, rawResult);
        } else {
          // Keep the miss in the conversation so the model searches again;
          // do not treat it as definition evidence.
          this.mergeContext(context, plan.tool, rawResult);
        }
      } else {
        rawResult =
          plan.tool === "search_code" ? this.decorateToolResult(plan.tool, rawResult, query) : rawResult;
        this.mergeContext(context, plan.tool, rawResult);
      }

      lastToolResult = rawResult;
      conversation.push({
        role: "assistant",
        content: JSON.stringify({ tool: plan.tool, args: plan.args })
      });
      conversation.push({ role: "user", content: lastToolResult });
      emit({
        index: steps.length,
        tool: plan.tool,
        summary: this.summarize(plan.tool, args, query),
        completed: true
      });

      if (plan.tool === "search_code") {
        const parsed = JSON.parse(lastToolResult) as SearchPayload & { preferredHits?: SearchHit[] };
        if (!parsed.preferredHits?.length) {
          const used = typeof args.query === "string" ? args.query : "";
          const found = await this.searchUntilReadableHits(
            repoId,
            query,
            emit,
            context,
            new Set([used])
          );
          if (found) {
            lastToolResult = JSON.stringify(context.search_code ?? parsed);
            conversation[conversation.length - 1] = { role: "user", content: lastToolResult };
          }
        }
      }
      if (plan.tool === "propose_patch") {
        const proposed = JSON.parse(rawResult) as { ok?: boolean };
        if (proposed.ok) {
          break;
        }
      }
    }

    return this.finishWithAnswer(
      { steps, context },
      query,
      repoId,
      action,
      options,
      conversation,
      matchingRead
    );
  }

  /**
   * If the model hunted but never called allowlisted Slack/Jira, fetch them
   * with a focused query so compound asks still get both halves.
   */
  private async fillAllowlistedIntegrations(
    query: string,
    result: AgentSessionResult,
    options: AgentRunOptions,
    conversation?: AgentConversationMessage[]
  ): Promise<AgentConversationMessage[] | undefined> {
    if (!this.runSearchIntegration || this.runAllowedIntegrations.length === 0) {
      return conversation;
    }
    const context: AgentSessionContext = { ...(result.context ?? {}) };
    const steps = [...result.steps];
    const messages = conversation ? [...conversation] : undefined;
    const focused =
      namedSymbolKeys(query)[0] ?? sanitizeAgentSearchQuery(query, query);
    let calls = steps.filter((step) => isAgentIntegrationTool(step.tool)).length;
    for (const provider of this.runAllowedIntegrations) {
      if (calls >= MAX_INTEGRATION_TOOL_CALLS) {
        break;
      }
      const tool = agentToolForIntegrationProvider(provider);
      if (!tool || context[tool]) {
        continue;
      }
      let rawResult: string;
      try {
        rawResult = await this.executeTool(tool, { query: focused });
      } catch {
        continue;
      }
      calls += 1;
      this.mergeContext(context, tool, rawResult);
      const step = {
        index: steps.length,
        tool,
        summary: this.summarize(tool, { query: focused }, query),
        completed: true
      };
      steps.push(step);
      options.onStep?.(step, [...steps]);
      if (messages) {
        messages.push({
          role: "assistant",
          content: JSON.stringify({ tool, args: { query: focused } })
        });
        messages.push({ role: "user", content: rawResult });
      }
    }
    result.context = context;
    result.steps = steps;
    return messages ?? conversation;
  }

  private async finishWithAnswer(
    result: AgentSessionResult,
    query: string,
    repoId: string,
    action: NonNullable<AgentSessionRequest["action"]>,
    options: AgentRunOptions,
    conversation?: AgentConversationMessage[],
    matchingRead = false
  ): Promise<AgentSessionResult> {
    const history =
      conversation && conversation.length > 0
        ? conversation
        : this.conversationFromContext(query, result);
    const filledHistory = await this.fillAllowlistedIntegrations(
      query,
      result,
      options,
      history
    );
    const needsGrounding =
      queryHasNamedSymbol(query) || queryRoleHints(query).length > 0;
    const hasIntegrationHits = this.contextHasIntegrationHits(result.context);
    if (needsGrounding && !matchingRead && hasIntegrationHits && filledHistory) {
      filledHistory.push({
        role: "user",
        content:
          "You did not read a file that mentions the named symbol. Do not invent a path. Summarize Slack/Jira/docs results honestly, and say the definition was not found in the index."
      });
    }
    if (needsGrounding && !matchingRead && !hasIntegrationHits) {
      const hadSuccessfulRead = readFileContextHasBody(result.context);
      if (!(isFeatureAddAsk(query) && hadSuccessfulRead)) {
        return {
          ...result,
          answer: INDEX_HUNT_MISS,
          context: result.steps.length ? result.context : undefined
        };
      }
    }
    if (!options.streamAnswer) {
      return { ...result, context: result.steps.length ? result.context : undefined };
    }
    if (options.signal?.aborted) {
      return { ...result, context: result.steps.length ? result.context : undefined };
    }
    if (result.answer?.trim()) {
      return { ...result, context: result.steps.length ? result.context : undefined };
    }
    try {
      const answer = await options.streamAnswer({
        message: query,
        repoId,
        conversation: filledHistory ?? history,
        action
      });
      return {
        ...result,
        answer,
        context: result.steps.length ? result.context : undefined
      };
    } catch {
      return { ...result, context: result.steps.length ? result.context : undefined };
    }
  }

  private conversationFromContext(
    query: string,
    result: AgentSessionResult
  ): AgentConversationMessage[] {
    const messages: AgentConversationMessage[] = [{ role: "user", content: query }];
    for (const step of result.steps) {
      messages.push({ role: "assistant", content: JSON.stringify({ tool: step.tool }) });
      const payload = isAgentIntegrationTool(step.tool)
        ? result.context?.[step.tool]
        : step.tool === "search_code"
          ? result.context?.search_code
          : step.tool === "read_file"
            ? result.context?.read_file
            : step.tool === "list_directory"
              ? result.context?.list_directory
              : step.tool === "propose_patch"
                ? result.context?.propose_patch
                : result.context?.git_blame;
      messages.push({
        role: "user",
        content: payload ? JSON.stringify(payload) : step.summary
      });
    }
    return messages;
  }

  private contextHasIntegrationHits(context: AgentSessionContext | undefined): boolean {
    if (!context) {
      return false;
    }
    for (const tool of [
      "search_slack",
      "search_jira",
      "search_teams",
      "search_notion",
      "search_confluence",
      "search_google_docs"
    ] as const) {
      const payload = context[tool];
      if (!payload) {
        continue;
      }
      for (const key of ["messages", "issues", "pages", "documents"] as const) {
        const value = payload[key];
        if (Array.isArray(value) && value.length > 0) {
          return true;
        }
      }
    }
    return false;
  }

  private async seedOpenFileReadIfFeatureAdd(
    repoId: string,
    query: string,
    openFile: string | undefined,
    emit: (step: AgentStep) => void,
    context: AgentSessionContext,
    conversation?: AgentConversationMessage[]
  ): Promise<{ ok: boolean; raw?: string }> {
    const filePath = openFile?.trim();
    if (!filePath || !isFeatureAddAsk(query)) {
      return { ok: false };
    }
    try {
      const rawResult = await this.executeTool("read_file", { path: filePath, repoId });
      if (!readFilePayloadHasBody(rawResult)) {
        return { ok: false };
      }
      this.mergeContext(context, "read_file", rawResult);
      conversation?.push({
        role: "assistant",
        content: JSON.stringify({ tool: "read_file", args: { path: filePath } })
      });
      conversation?.push({ role: "user", content: rawResult });
      emit({
        index: 0,
        tool: "read_file",
        summary: `read_file: ${filePath}`,
        completed: true
      });
      return { ok: true, raw: rawResult };
    } catch {
      return { ok: false };
    }
  }

  private judgeReadResult(
    raw: string,
    query: string,
    args: Record<string, unknown>
  ): { raw: string; matchesSymbol: boolean } {
    const needsNamed = queryHasNamedSymbol(query);
    const needsRole = !needsNamed && queryRoleHints(query).length > 0;
    if (!needsNamed && !needsRole) {
      return { raw, matchesSymbol: true };
    }
    try {
      const parsed = JSON.parse(raw) as ReadFilePayload;
      const path = typeof args.path === "string" ? args.path : parsed.path ?? "";
      const body = (parsed.files ?? []).map((file) => `${file.path}\n${file.content}`).join("\n");
      const blob = `${path}\n${body}`;
      if (isFeatureAddAsk(query) && readFilePayloadHasBody(raw)) {
        return { raw, matchesSymbol: true };
      }
      const matches = needsNamed
        ? textMentionsNamedSymbol(blob, query)
        : textMentionsQueryRoles(blob, query);
      if (matches) {
        return { raw, matchesSymbol: true };
      }
      return {
        raw: JSON.stringify({
          ...parsed,
          skipNote: needsNamed
            ? "This file does not mention the named symbol. Search or read a different path before answering. Do not treat this as the definition."
            : "This file does not mention the role the user named (e.g. middleware). Search or read a different path — do not treat websocket/session auth as HTTP middleware."
        }),
        matchesSymbol: false
      };
    } catch {
      return { raw, matchesSymbol: false };
    }
  }

  private async runDeterministic(
    repoId: string,
    query: string,
    maxSteps: number,
    options?: AgentRunOptions,
    openFile?: string
  ): Promise<AgentSessionResult> {
    const steps: AgentStep[] = [];
    const context: AgentSessionContext = {};
    const emit = (step: AgentStep) => {
      steps.push(step);
      options?.onStep?.(step, [...steps]);
    };

    const seeded = await this.seedOpenFileReadIfFeatureAdd(
      repoId,
      query,
      openFile,
      emit,
      context
    );
    if (seeded.ok) {
      return { steps, context };
    }

    if (isRepoStructureQuery(query) && this.registry.list_directory) {
      const listRaw = await this.executeTool("list_directory", { path: "", repoId });
      const listParsed = JSON.parse(listRaw) as Record<string, unknown>;
      context.list_directory = listParsed;
      emit({
        index: steps.length,
        tool: "list_directory",
        summary: "list_directory: /",
        completed: true
      });
      return { steps, context };
    }

    const found = await this.searchUntilReadableHits(repoId, query, emit, context);
    if (!found || steps.length >= maxSteps) {
      return { steps, context };
    }

    // Try preferred hits until the file body actually mentions the named symbol.
    // Otherwise we read AuthRoot because the path contains "auth".
    for (const hit of found.toRead) {
      if (!hit.fileName || steps.length >= maxSteps) {
        break;
      }
      if (shouldSkipEvidencePath(hit.fileName, query)) {
        emit({
          index: steps.length,
          tool: "read_file",
          summary: `read_file skipped (noise path): ${hit.fileName}`,
          completed: true
        });
        continue;
      }
      const { startLine, endLine } = readLineWindow(hit.lineNumber);
      const readRaw = await this.executeTool("read_file", {
        path: hit.fileName,
        repoId,
        startLine,
        endLine
      });
      const readParsed = JSON.parse(readRaw) as ReadFilePayload;
      const body = (readParsed.files ?? [])
        .map((file) => `${file.path}\n${file.content}`)
        .join("\n");
      const blob = `${hit.fileName}\n${hit.content ?? ""}\n${body}`;
      const namedOk = !queryHasNamedSymbol(query) || textMentionsNamedSymbol(blob, query);
      const roleOk =
        queryHasNamedSymbol(query) ||
        queryRoleHints(query).length === 0 ||
        textMentionsQueryRoles(blob, query);
      if (!namedOk || !roleOk) {
        emit({
          index: steps.length,
          tool: "read_file",
          summary: `read_file skipped (no symbol match): ${hit.fileName}`,
          completed: true
        });
        continue;
      }
      context.read_file = readParsed as Record<string, unknown>;
      emit({
        index: steps.length,
        tool: "read_file",
        summary: `read_file: ${hit.fileName}`,
        completed: true
      });
      return { steps, context };
    }

    if (context.search_code && typeof context.search_code === "object") {
      context.search_code = {
        ...context.search_code,
        skipNote:
          "Index hits did not contain the named symbol in file bodies. Do not invent a definition path or patch a related UI file."
      };
    }
    return { steps, context };
  }

  private async searchUntilReadableHits(
    repoId: string,
    query: string,
    emit: (step: AgentStep) => void,
    context: AgentSessionContext,
    skipQueries: Set<string> = new Set()
  ): Promise<{ toRead: SearchHit[] } | undefined> {
    const queries = fallbackAgentSearchQueries(query)
      .filter((candidate) => !skipQueries.has(candidate))
      .slice(0, MAX_SEARCH_ATTEMPTS);
    let stepIndex = 0;
    const tried: string[] = [];
    let lastError: string | undefined;
    for (const searchQuery of queries) {
      tried.push(searchQuery);
      const searchRaw = await this.executeTool("search_code", { query: searchQuery, repoId });
      const decorated = this.decorateToolResult("search_code", searchRaw, query);
      this.mergeContext(context, "search_code", decorated);
      emit({
        index: stepIndex,
        tool: "search_code",
        summary: `search_code: ${truncateSummary(searchQuery)}`,
        completed: true
      });
      stepIndex += 1;
      const parsed = JSON.parse(decorated) as SearchPayload & {
        preferredHits?: SearchHit[];
        error?: string;
      };
      if (parsed.error) {
        lastError = parsed.error;
      }
      const toRead = parsed.preferredHits ?? [];
      if (toRead.length > 0) {
        return { toRead };
      }
    }
    if (context.search_code && typeof context.search_code === "object") {
      context.search_code = {
        ...context.search_code,
        exhaustedQueries: tried,
        skipNote: lastError
          ? `search_code failed: ${lastError}. Do not claim the symbol is missing from the repo — say the index search failed.`
          : `Tried ${tried.map((q) => JSON.stringify(q)).join(", ")} with no readable hits. Say the index returned no usable matches for those terms — do not invent file paths.`
      };
    }
    return undefined;
  }

  private prepareToolArgs(
    tool: AgentToolName,
    planArgs: Record<string, unknown>,
    repoId: string,
    userMessage: string
  ): Record<string, unknown> {
    const args: Record<string, unknown> = { ...planArgs, repoId };
    if (tool === "search_code") {
      const raw = typeof args.query === "string" ? args.query : "";
      args.query = sanitizeAgentSearchQuery(raw, userMessage);
    }
    return args;
  }

  private decorateToolResult(tool: AgentToolName, raw: string, userMessage: string): string {
    if (tool !== "search_code") {
      return raw;
    }
    try {
      const parsed = JSON.parse(raw) as SearchPayload & Record<string, unknown>;
      if (!parsed.hits?.length && !parsed.symbols?.length) {
        return raw;
      }
      // A symbol is a declaration site with a real line; a text hit is only a
      // mention. For "where is X defined", read the declaration first.
      const definitions = pickSymbolHitsToRead(parsed.symbols ?? [], 2, userMessage);
      const textHits = pickSearchHitsToRead(rankSearchHits(parsed.hits ?? [], userMessage), 8, userMessage);

      const preferred: SearchHit[] = [];
      for (const hit of [...definitions.map(symbolToHit), ...textHits]) {
        if (!preferred.some((seen) => seen.fileName === hit.fileName)) {
          preferred.push(hit);
        }
      }
      parsed.preferredHits = preferred.slice(0, 5);
      // Drop near-miss symbols/hits from model context — otherwise synthesis
      // invents patches for test_all_endpoints_require_authentication.
      parsed.symbols = definitions;
      parsed.hits = textHits;
      parsed.skipNote = preferred.length
        ? definitions.length
          ? "preferredHits starts with declaration sites from the symbol index — read those lines, not the top of the file."
          : "Read the ranked hits below. Barrel index.ts, build output, and vendored code are already filtered out."
        : "Every hit was a barrel, build output, vendored file, or a near-miss name (e.g. require_authentication ≠ requireAuth). Search again with a different term — do not invent a path from noise.";
      return JSON.stringify(parsed);
    } catch {
      return raw;
    }
  }

  private mergeContext(context: AgentSessionContext, tool: AgentToolName, raw: string): void {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      parsed = { error: "invalid tool JSON" };
    }
    if (tool === "read_file") {
      const prev = context.read_file as ReadFilePayload | undefined;
      const next = parsed as ReadFilePayload;
      const files = [...(prev?.files ?? []), ...(next.files ?? [])];
      context.read_file = { ...next, files };
      return;
    }
    if (tool === "search_code") {
      context.search_code = parsed;
      return;
    }
    if (tool === "list_directory") {
      context.list_directory = parsed;
      return;
    }
    if (tool === "propose_patch") {
      context.propose_patch = parsed;
      return;
    }
    if (isAgentIntegrationTool(tool)) {
      context[tool] = parsed;
      return;
    }
    context.git_blame = parsed;
  }

  private summarize(tool: AgentToolName, args: Record<string, unknown>, query: string): string {
    if (tool === "search_code") {
      const q = typeof args.query === "string" ? args.query : query;
      return `search_code: ${truncateSummary(q)}`;
    }
    if (tool === "read_file") {
      const path = typeof args.path === "string" ? args.path : "";
      return `read_file: ${path}`;
    }
    if (tool === "list_directory") {
      const path = typeof args.path === "string" && args.path ? args.path : "/";
      return `list_directory: ${path}`;
    }
    if (tool === "propose_patch") {
      const files = Array.isArray(args.files) ? args.files.length : 0;
      return files > 0 ? `propose_patch: ${files} file${files === 1 ? "" : "s"}` : "propose_patch";
    }
    if (isAgentIntegrationTool(tool)) {
      const q = typeof args.query === "string" ? args.query : query;
      return `${tool}: ${truncateSummary(q)}`;
    }
    const path = typeof args.path === "string" ? args.path : "";
    return `git_blame: ${path}`;
  }
}

function looksLikeProseAnswer(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return false;
  }
  return trimmed.length > 40 && /[.!?\n]/.test(trimmed);
}

function readFilePayloadHasBody(raw: string): boolean {
  try {
    const parsed = JSON.parse(raw) as ReadFilePayload;
    if (parsed.error) {
      return false;
    }
    return (parsed.files ?? []).some((file) => Boolean(file.content?.trim()));
  } catch {
    return false;
  }
}

function readFileContextHasBody(context: AgentSessionContext | undefined): boolean {
  const files = (context?.read_file as ReadFilePayload | undefined)?.files;
  return Boolean(files?.some((file) => Boolean(file.content?.trim())));
}

function symbolToHit(symbol: SymbolHit): SearchHit {
  return { fileName: symbol.file, lineNumber: symbol.line, score: 1 };
}

function truncateSummary(text: string, max = 80): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function createAgentOrchestrator(ctx: AgentToolContext): AgentOrchestrator {
  return new AgentOrchestrator(ctx);
}
