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
import { agentSearchSkipNote, parseAgentToolPlan } from "./parseAgentToolPlan";
import {
  fallbackAgentSearchQueries,
  extractAgentSearchQuery,
  extractNamedSourceFiles,
  identifierSearchAliases,
  pickSearchHitsToRead,
  pickSymbolHitsToRead,
  pickTopSearchHit,
  queryHasNamedSymbol,
  queryNamesSourceFile,
  queryRoleHints,
  rankSearchHits,
  sanitizeAgentSearchQuery,
  shouldSkipEvidencePath,
  filterWriteRejectFiles,
  isApiRejectAsk,
  contentLooksLikeAskedFieldReject,
  lineNumberOfWriteReject,
  textMentionsQueryRoles,
  readBodyHasCallerUse
} from "./searchQuery";
import { isFileCallerQuery } from "../../context/fileCallerIntent";
import {
  classifyLocateRead,
  locateReadCountsAsGrounding,
  pickGroundedExport,
  preferredHitsForLocate
} from "./locateEvidence";
import { createAgentToolRegistry } from "./tools/registry";
import { handleIntegrationSearch } from "./tools/integrationSearch";
import { stripReadLinePrefixes } from "./tools/readFile";
import { formatOpenedIntegrationEvidence, listOpenedIntegrationArtifacts, type OpenedVendorArtifact } from "./openedIntegrationEvidence";
import {
  agentToolForIntegrationProvider,
  isAgentIntegrationTool
} from "./integrationTools";
import { isRepoStructureQuery } from "../../workspace/repoFactIntent";
import { isFeatureAddAsk } from "../../context/existingCapabilityGrounding";
import {
  mergeIntegrationPayload,
  parseOpenIds,
  recordVendorToolCall,
  vendorDoneBlockReason,
  type VendorToolState
} from "./vendorLoop";

export { pickTopSearchHit };

const DEFAULT_MAX_STEPS = AGENT_MAX_TOOL_ROUNDS;
const READ_LINE_PADDING = 25;
/** Each retry is another round trip — the gather budget is shared with the answer. */
const MAX_SEARCH_ATTEMPTS = 8;
/** Field-reject hunts search access patterns after slogan misses. */
const MAX_API_REJECT_SEARCH_ATTEMPTS = 12;
/** Read budget when the index returned a hit with no line number. */
const UNPOSITIONED_READ_LINES = 120;
const INDEX_HUNT_MISS =
  "I couldn't find that in this repo. Try a more specific name, or open the file.";
/** On-call API reject — never reuse the named-function miss copy. */
const API_REJECT_HUNT_MISS =
  "I couldn't find where the API rejects that field. I won't guess a path. Try a more specific error string, or open the write path.";
/** Cap mid-loop integration calls so the model cannot spray. Search + Open + retry needs headroom. */
const MAX_INTEGRATION_TOOL_CALLS = 8;

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
  skipNote?: string;
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

function normalizeHuntPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "").toLowerCase();
}

function sameHuntPath(left: string, right: string): boolean {
  const a = normalizeHuntPath(left);
  const b = normalizeHuntPath(right);
  return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
}

function preferredLineForPath(
  search: Record<string, unknown> | undefined,
  path: string
): number {
  if (!path.trim() || !search) {
    return 0;
  }
  const symbols = Array.isArray(search.symbols) ? (search.symbols as SymbolHit[]) : [];
  for (const symbol of symbols) {
    if (sameHuntPath(symbol.file, path) && Number.isInteger(symbol.line) && symbol.line >= 1) {
      return symbol.line;
    }
  }
  const preferred = Array.isArray(search.preferredHits)
    ? (search.preferredHits as SearchHit[])
    : [];
  for (const hit of preferred) {
    if (sameHuntPath(hit.fileName, path) && Number.isInteger(hit.lineNumber) && hit.lineNumber >= 1) {
      return hit.lineNumber;
    }
  }
  const hits = Array.isArray(search.hits) ? (search.hits as SearchHit[]) : [];
  for (const hit of hits) {
    if (sameHuntPath(hit.fileName, path) && Number.isInteger(hit.lineNumber) && hit.lineNumber >= 1) {
      return hit.lineNumber;
    }
  }
  return 0;
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
  /** Connected integrations — the model may call these mid-loop. */
  allowedIntegrations?: IntegrationChatProvider[];
  /**
   * Planner-hinted tools to backfill if the model never called them.
   * Not the connected list — filling every connected vendor would spray.
   */
  fillIntegrations?: IntegrationChatProvider[];
  /** Per-vendor search string from decision/docs jobs — not the locate symbol. */
  fillQueries?: Partial<Record<IntegrationChatProvider, string>>;
  /** Live integration search for connected mid-loop tools. */
  searchIntegration?: (options: {
    provider: IntegrationChatProvider;
    query: string;
    openIds?: string[];
    priorHits?: Record<string, unknown>;
    signal?: AbortSignal;
  }) => Promise<Record<string, unknown>>;
  /** False on named-product / slash turns unless locate is also asked. */
  allowedRepoTools?: boolean;
  /** Cheap per-Open Interpret before the Talk track. */
  interpretOpens?: (artifacts: OpenedVendorArtifact[]) => Promise<string | undefined>;
};

/**
 * Agent tool loop for locate / understand / change.
 *
 * Live path: one model conversation (`planTurn`) chooses tools, sees results,
 * then `streamAnswer` writes the user-visible answer. There is no user toggle.
 * Connected integrations may be called mid-loop when discovered.
 * Deterministic search→read is only the no-planTurn fallback (tests / fail-open).
 */
export class AgentOrchestrator {
  private readonly registry;
  private runAllowedIntegrations: IntegrationChatProvider[] = [];
  private runSearchIntegration?: AgentRunOptions["searchIntegration"];
  private runSignal?: AbortSignal;
  private loopContext?: AgentSessionContext;
  private allowedRepoTools = true;

  public constructor(private readonly ctx: AgentToolContext) {
    this.registry = createAgentToolRegistry(ctx);
  }

  public async executeTool(tool: AgentToolName, args: Record<string, unknown>): Promise<string> {
    if (isAgentIntegrationTool(tool)) {
      return handleIntegrationSearch(
        {
          ...this.ctx,
          allowedIntegrations: this.runAllowedIntegrations,
          searchIntegration: this.runSearchIntegration ?? this.ctx.searchIntegration,
          priorIntegrationPayload: this.loopContext?.[tool],
          searchSignal: this.runSignal
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
    this.runSignal = options?.signal;
    this.allowedRepoTools = options?.allowedRepoTools !== false;
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
      this.runSignal = undefined;
      this.loopContext = undefined;
      this.allowedRepoTools = true;
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
    let callerRead = false;
    let groundedExport = queryHasNamedSymbol(query) ? extractAgentSearchQuery(query) : undefined;
    let implementationPath: string | undefined;
    const triedSearchQueries = new Set<string>();
    const wantsCallerRead = (): boolean =>
      isFileCallerQuery(query) && (queryHasNamedSymbol(query) || Boolean(groundedExport));
    const allowedIntegrations = options.allowedIntegrations ?? [];
    this.loopContext = context;
    const vendorState = new Map<AgentToolName, VendorToolState>();
    const allowedRepoTools = options.allowedRepoTools !== false;
    const seeded = allowedRepoTools
      ? await this.seedOpenFileReadIfFeatureAdd(
          repoId,
          query,
          openFile,
          emit,
          context,
          conversation
        )
      : { ok: false as const };
    if (seeded.ok) {
      matchingRead = true;
      filesRead = 1;
      lastToolResult = seeded.raw;
    } else if (allowedRepoTools) {
      const named = await this.seedNamedFileReads(
        repoId,
        query,
        emit,
        context,
        conversation
      );
      if (named.ok) {
        matchingRead = true;
        filesRead = 1;
        lastToolResult = named.raw;
      }
    }

    const vendorBlock = (): string | undefined =>
      vendorDoneBlockReason({
        query,
        steps,
        context,
        state: vendorState,
        allowedRepoTools
      });

    const canAnswerNow = (): boolean => {
      const block = vendorBlock();
      if (block) {
        return false;
      }
      if (!allowedRepoTools) {
        return steps.length > 0;
      }
      if (isApiRejectAsk(query)) {
        return contextHasWriteReject(context, query);
      }
      if (queryHasNamedSymbol(query) || queryRoleHints(query).length > 0) {
        if (wantsCallerRead()) {
          return matchingRead && callerRead;
        }
        return matchingRead;
      }
      if (wantsCallerRead()) {
        return matchingRead && callerRead;
      }
      return steps.length > 0;
    };

    if (isApiRejectAsk(query) && action !== "change") {
      const hunted = await this.huntWriteReject(repoId, query, emit, context, conversation);
      if (hunted) {
        matchingRead = true;
      }
      // Index already said yes or no. Do not start a second hunt of the same queries.
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

    const skipDeterministicFallback = !allowedRepoTools;

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
        if (steps.length === 0 && !skipDeterministicFallback) {
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

      const plan = parseAgentToolPlan(raw, { allowedIntegrations, allowedRepoTools });
      if (plan.kind === "invalid") {
        if (steps.length === 0 && !skipDeterministicFallback) {
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
        const block = vendorBlock();
        lastToolResult = JSON.stringify({
          error: block
            ? block
            : canAnswerNow()
              ? 'Reply {"done":true} so the next turn can answer the user, or call another allowed tool.'
              : allowedRepoTools
                ? "Reply with a tool JSON call. You have not read an implementation of the named symbol or role — do not answer yet."
                : "Reply with a vendor Search or Open JSON call."
        });
        conversation.push({ role: "assistant", content: raw.slice(0, 2000) });
        conversation.push({ role: "user", content: lastToolResult });
        continue;
      }

      if (plan.kind === "done") {
        const block = vendorBlock();
        if (block || !canAnswerNow()) {
          lastToolResult = JSON.stringify({
            error:
              block ??
              (allowedRepoTools
                ? "Do not finish yet. You have not read an implementation of the named symbol or role. Call search_code or read_file on a different path — do not answer from a mention, UI, test, or form."
                : "Do not finish yet. Search, then Open chosen ids (or retry Search once if empty).")
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
              "Do not propose_patch until you have read an implementation of the named symbol or role. Search/read again."
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

      const args = this.prepareToolArgs(plan.tool, plan.args, repoId, query, {
        callerSearch: matchingRead && wantsCallerRead() && !callerRead ? groundedExport : undefined
      });
      if (plan.tool === "read_file") {
        this.applyPreferredReadWindow(args, context);
        const path = typeof args.path === "string" ? args.path : "";
        if (shouldSkipEvidencePath(path, query)) {
          lastToolResult = JSON.stringify({
            path,
            skipNote:
              "Skipped a spec/catalog/client path. Search a serializer or view for validate or ValidationError."
          });
          conversation.push({
            role: "assistant",
            content: JSON.stringify({ tool: plan.tool, args: plan.args })
          });
          conversation.push({ role: "user", content: lastToolResult });
          emit({
            index: steps.length,
            tool: plan.tool,
            summary: `read_file skipped (noise path): ${path}`,
            completed: true
          });
          continue;
        }
      }
      let rawResult: string;
      try {
        rawResult = await this.executeTool(plan.tool, args);
      } catch {
        break;
      }
      if (isAgentIntegrationTool(plan.tool)) {
        recordVendorToolCall(vendorState, plan.tool, parseOpenIds(plan.args).length > 0);
      }

      if (plan.tool === "read_file") {
        let judged = this.judgeReadResult(rawResult, query, args);
        if (!judged.matchesSymbol) {
          const retried = await this.retryReadWithoutWindow(args, repoId, query);
          if (retried) {
            judged = retried;
            rawResult = retried.raw;
          }
        }
        rawResult = judged.raw;
        const path = typeof args.path === "string" ? args.path : "";
        if (isApiRejectAsk(query) && path) {
          const jumped = await this.loadWriteRejectWindow(repoId, path, query);
          if (jumped) {
            rawResult = jumped.raw;
            args.startLine = jumped.startLine;
            args.endLine = jumped.endLine;
            judged = { raw: jumped.raw, matchesSymbol: true };
          } else if (!contentLooksLikeAskedFieldReject(readFileBodies(rawResult), query, path)) {
            rawResult = JSON.stringify({
              path,
              skipNote:
                "This snippet does not write or reject the asked field. Search a serializer validate() or ValidationError."
            });
            judged = { raw: rawResult, matchesSymbol: false };
          }
        }
        if (judged.matchesSymbol) {
          matchingRead = true;
          if (!implementationPath && path) {
            implementationPath = path;
          }
          if (!groundedExport) {
            groundedExport = this.groundedExportFromRead(path, rawResult, query);
          }
          this.mergeContext(context, plan.tool, rawResult);
          if (isFileCallerQuery(query) && queryHasNamedSymbol(query) && !callerRead) {
            const expanded = await this.expandReadForCallers(
              repoId,
              query,
              args,
              rawResult,
              emit,
              context,
              conversation,
              groundedExport
            );
            rawResult = expanded.raw;
            if (expanded.callerRead) {
              callerRead = true;
            }
          }
        } else {
          // Keep the miss in the conversation so the model searches again;
          // do not treat it as definition evidence.
          this.mergeContext(context, plan.tool, rawResult);
        }
        if (isApiRejectAsk(query) && contextHasWriteReject(context, query)) {
          break;
        }
      } else {
        const rankQuery =
          plan.tool === "search_code" &&
          matchingRead &&
          wantsCallerRead() &&
          !callerRead &&
          groundedExport
            ? groundedExport
            : query;
        rawResult =
          plan.tool === "search_code" ? this.decorateToolResult(plan.tool, rawResult, rankQuery) : rawResult;
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
        let hits = parsed.preferredHits ?? [];
        const used = typeof args.query === "string" ? args.query : "";
        if (used) {
          triedSearchQueries.add(used);
        }
        if (!hits.length) {
          const found = await this.searchUntilReadableHits(
            repoId,
            query,
            emit,
            context,
            triedSearchQueries
          );
          if (found) {
            hits = found.toRead;
            lastToolResult = JSON.stringify(context.search_code ?? parsed);
            conversation[conversation.length - 1] = { role: "user", content: lastToolResult };
          }
        }
        const huntingCallers = matchingRead && wantsCallerRead() && !callerRead;
        const roleHints = queryRoleHints(query);
        const autoReadHits =
          huntingCallers
            ? hits
            : roleHints.length > 0
              ? hits.filter((hit) =>
                  textMentionsQueryRoles(`${hit.fileName}\n${hit.content ?? ""}`, query)
                )
              : hits;
        if (
          autoReadHits.length > 0 &&
          filesRead < AGENT_MAX_FILES_READ &&
          (!matchingRead || huntingCallers)
        ) {
          const seeded = await this.readFirstMatchingHit(
            repoId,
            query,
            autoReadHits,
            emit,
            context,
            conversation,
            undefined,
            huntingCallers,
            groundedExport,
            implementationPath
          );
          if (seeded.ok) {
            filesRead += 1;
            lastToolResult = seeded.raw;
            if (!matchingRead) {
              matchingRead = true;
              if (!implementationPath && seeded.path) {
                implementationPath = seeded.path;
              }
              if (!groundedExport) {
                groundedExport = this.groundedExportFromRead(
                  seeded.path ?? "",
                  seeded.raw ?? "",
                  query
                );
              }
            } else if (huntingCallers) {
              callerRead = true;
            }
            if (queryHasNamedSymbol(query) && isFileCallerQuery(query) && !callerRead) {
              const expanded = await this.expandReadForCallers(
                repoId,
                query,
                { path: seeded.path ?? "", repoId },
                seeded.raw ?? "",
                emit,
                context,
                conversation,
                groundedExport
              );
              lastToolResult = expanded.raw;
              if (expanded.callerRead) {
                callerRead = true;
              }
            }
            if (isApiRejectAsk(query) && contextHasWriteReject(context, query)) {
              break;
            }
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

    if (allowedRepoTools && filesRead < AGENT_MAX_FILES_READ) {
      if (!matchingRead) {
        const grounded = await this.lastChanceReadMatchingHit(
          repoId,
          query,
          emit,
          context,
          conversation,
          false,
          triedSearchQueries
        );
        if (grounded.ok) {
          matchingRead = true;
          filesRead += 1;
          lastToolResult = grounded.raw;
          if (!implementationPath && grounded.path) {
            implementationPath = grounded.path;
          }
          if (!groundedExport) {
            groundedExport = this.groundedExportFromRead(
              grounded.path ?? "",
              grounded.raw ?? "",
              query
            );
          }
          if (queryHasNamedSymbol(query) && isFileCallerQuery(query) && !callerRead) {
            const expanded = await this.expandReadForCallers(
              repoId,
              query,
              { path: grounded.path ?? "", repoId },
              grounded.raw ?? "",
              emit,
              context,
              conversation,
              groundedExport
            );
            lastToolResult = expanded.raw;
            if (expanded.callerRead) {
              callerRead = true;
            }
          }
        }
      }
      if (matchingRead && wantsCallerRead() && !callerRead && filesRead < AGENT_MAX_FILES_READ) {
        const caller = await this.lastChanceReadMatchingHit(
          repoId,
          query,
          emit,
          context,
          conversation,
          true,
          triedSearchQueries,
          groundedExport,
          implementationPath
        );
        if (caller.ok) {
          filesRead += 1;
          lastToolResult = caller.raw;
          callerRead = true;
        }
      }
    }

    if (wantsCallerRead() && matchingRead && !callerRead) {
      conversation.push({
        role: "user",
        content:
          "You did not read a file that imports or calls the export. Answer from the implementation you read. Do not invent a caller path. Say callers were not found in the index."
      });
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
   * If the model hunted but never called planner-hinted integrations, fetch
   * those with a focused query so compound asks still get both halves.
   * Does not walk the full connected list.
   */
  private async fillAllowlistedIntegrations(
    query: string,
    result: AgentSessionResult,
    options: AgentRunOptions,
    conversation?: AgentConversationMessage[]
  ): Promise<AgentConversationMessage[] | undefined> {
    const toFill = (options.fillIntegrations ?? []).filter((provider) =>
      this.runAllowedIntegrations.includes(provider)
    );
    if (!this.runSearchIntegration || toFill.length === 0) {
      return conversation;
    }
    const context: AgentSessionContext = { ...(result.context ?? {}) };
    const steps = [...result.steps];
    const messages = conversation ? [...conversation] : undefined;
    let calls = steps.filter((step) => isAgentIntegrationTool(step.tool)).length;
    for (const provider of toFill) {
      if (calls >= MAX_INTEGRATION_TOOL_CALLS) {
        break;
      }
      const focused = options.fillQueries?.[provider]?.trim();
      if (!focused) {
        continue;
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
    if (isApiRejectAsk(query)) {
      pruneContextToWriteReject(result.context, query);
      conversation = compactApiRejectConversation(query, result.context);
      if (!contextHasWriteReject(result.context, query)) {
        matchingRead = false;
        if (action !== "change") {
          return {
            ...result,
            answer: API_REJECT_HUNT_MISS,
            context: result.steps.length ? result.context : undefined
          };
        }
      }
    }
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
          "You did not read a file that mentions the named symbol. Summarize Slack/Jira/docs results, and say the index didn’t return a usable definition."
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
    // Prose locate (no camelCase symbol): still refuse if we never read a file.
    // Otherwise C2 becomes a Kanban lecture with no plane evidence.
    if (
      action === "locate" &&
      !matchingRead &&
      !hasIntegrationHits &&
      !readFileContextHasBody(result.context)
    ) {
      return {
        ...result,
        answer: INDEX_HUNT_MISS,
        context: result.steps.length ? result.context : undefined
      };
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
      const artifacts = listOpenedIntegrationArtifacts(result.context);
      let interpretNotes: string | undefined;
      if (artifacts.length > 0 && options.interpretOpens && !options.signal?.aborted) {
        interpretNotes = await options.interpretOpens(artifacts);
      }
      const answer = await options.streamAnswer({
        message: query,
        repoId,
        conversation: filledHistory ?? history,
        action,
        openedEvidence: formatOpenedIntegrationEvidence(result.context),
        interpretNotes
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

  /**
   * User typed a filename or path — read it before symbol search.
   * `authMiddleware.ts` is often the file name, not an identifier in the body.
   */
  private async seedNamedFileReads(
    repoId: string,
    query: string,
    emit: (step: AgentStep) => void,
    context: AgentSessionContext,
    conversation?: AgentConversationMessage[]
  ): Promise<{ ok: boolean; raw?: string }> {
    const named = extractNamedSourceFiles(query);
    if (!named.length) {
      return { ok: false };
    }
    const toRead: string[] = [];
    const seen = new Set<string>();
    const push = (path: string) => {
      const trimmed = path.replace(/^\/+/, "").trim();
      const key = trimmed.toLowerCase();
      if (!trimmed || seen.has(key)) {
        return;
      }
      seen.add(key);
      toRead.push(trimmed);
    };
    for (const ref of named) {
      if (ref.includes("/")) {
        push(ref);
        continue;
      }
      const found = (await this.ctx.findFiles?.({ query: ref, repoId }).catch(() => [])) ?? [];
      const base = ref.toLowerCase();
      const exact = found.filter((path) => (path.split("/").pop() ?? "").toLowerCase() === base);
      for (const path of (exact.length ? exact : found).slice(0, 2)) {
        push(path);
      }
    }
    for (const filePath of toRead) {
      try {
        const rawResult = await this.executeTool("read_file", { path: filePath, repoId });
        if (!readFilePayloadHasBody(rawResult)) {
          continue;
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
        // Try the next named path.
      }
    }
    return { ok: false };
  }

  private groundedExportFromRead(path: string, raw: string, query: string): string | undefined {
    if (queryHasNamedSymbol(query)) {
      return extractAgentSearchQuery(query);
    }
    if (!path.trim()) {
      return undefined;
    }
    return pickGroundedExport(path, stripReadLinePrefixes(readFileBodies(raw)), query);
  }

  private judgeReadResult(
    raw: string,
    query: string,
    args: Record<string, unknown>
  ): { raw: string; matchesSymbol: boolean } {
    const needsNamed = queryHasNamedSymbol(query);
    const needsRole = queryRoleHints(query).length > 0;
    if (!needsNamed && !needsRole) {
      return { raw, matchesSymbol: true };
    }
    try {
      const parsed = JSON.parse(raw) as ReadFilePayload;
      const path = typeof args.path === "string" ? args.path : parsed.path ?? "";
      const body = (parsed.files ?? [])
        .map((file) => `${file.path}\n${stripReadLinePrefixes(file.content ?? "")}`)
        .join("\n");
      if (isFeatureAddAsk(query) && readFilePayloadHasBody(raw)) {
        return { raw, matchesSymbol: true };
      }
      if (queryNamesSourceFile(path, query) && readFilePayloadHasBody(raw)) {
        return { raw, matchesSymbol: true };
      }
      if (locateReadCountsAsGrounding({ path, body, query })) {
        return { raw, matchesSymbol: true };
      }
      const verdict = classifyLocateRead({ path, body, query });
      if (verdict === "mention") {
        return {
          raw: JSON.stringify({
            path,
            skipNote:
              "This file talks about the role; it is not the implementation. Keep searching."
          }),
          matchesSymbol: false
        };
      }
      return {
        raw: JSON.stringify({
          ...parsed,
          skipNote: needsNamed && !needsRole
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
    const named = await this.seedNamedFileReads(repoId, query, emit, context);
    if (named.ok) {
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

    const opened = await this.readFirstMatchingHit(repoId, query, found.toRead, emit, context);
    if (opened.ok) {
      return { steps, context };
    }

    if (context.search_code && typeof context.search_code === "object") {
      context.search_code = {
        ...context.search_code,
        skipNote:
          "Index hits did not contain the named symbol in file bodies. Cite only files you actually read."
      };
    }
    return { steps, context };
  }

  /**
   * Locate must open a hit before answering. The model often keeps searching
   * after preferredHits exist; without a read, C2 posts INDEX_HUNT_MISS.
   */
  private async readFirstMatchingHit(
    repoId: string,
    query: string,
    hits: SearchHit[],
    emit: (step: AgentStep) => void,
    context: AgentSessionContext,
    conversation?: AgentConversationMessage[],
    skippedPaths?: Set<string>,
    preferCallerHits = false,
    groundedExport?: string,
    implementationPath?: string
  ): Promise<{ ok: boolean; raw?: string; path?: string }> {
    const implementationKey = implementationPath ? normalizeHuntPath(implementationPath) : "";
    for (const hit of hits) {
      if (!hit.fileName) {
        continue;
      }
      const pathKey = normalizeHuntPath(hit.fileName);
      if (skippedPaths?.has(pathKey)) {
        continue;
      }
      if (preferCallerHits && implementationKey && pathKey === implementationKey) {
        skippedPaths?.add(pathKey);
        emit({
          index: 0,
          tool: "read_file",
          summary: `read_file skipped (definition only): ${hit.fileName}`,
          completed: true
        });
        continue;
      }
      if (shouldSkipEvidencePath(hit.fileName, query)) {
        skippedPaths?.add(pathKey);
        emit({
          index: 0,
          tool: "read_file",
          summary: `read_file skipped (noise path): ${hit.fileName}`,
          completed: true
        });
        continue;
      }
      const { startLine, endLine } = readLineWindow(hit.lineNumber);
      let readRaw = await this.executeTool("read_file", {
        path: hit.fileName,
        repoId,
        startLine,
        endLine
      });
      let usedWindow = true;
      let body = "";
      try {
        body = readBodiesUnprefixed(JSON.parse(readRaw) as ReadFilePayload);
      } catch {
        body = "";
      }
      const groundingOk = locateReadCountsAsGrounding({ path: hit.fileName, body, query });
      const callerOk = preferCallerHits && readBodyHasCallerUse(body, query, groundedExport);
      if (!readFilePayloadHasBody(readRaw) || (!preferCallerHits && !groundingOk) || (preferCallerHits && !callerOk)) {
        const fullRaw = await this.executeTool("read_file", { path: hit.fileName, repoId });
        if (readFilePayloadHasBody(fullRaw)) {
          readRaw = fullRaw;
          usedWindow = false;
          try {
            body = readBodiesUnprefixed(JSON.parse(fullRaw) as ReadFilePayload);
          } catch {
            body = "";
          }
        }
      }
      if (!readFilePayloadHasBody(readRaw)) {
        continue;
      }
      const verdict = classifyLocateRead({ path: hit.fileName, body, query });
      if (preferCallerHits && !readBodyHasCallerUse(body, query, groundedExport)) {
        skippedPaths?.add(pathKey);
        emit({
          index: 0,
          tool: "read_file",
          summary:
            verdict === "mention"
              ? `read_file skipped (mention): ${hit.fileName}`
              : `read_file skipped (definition only): ${hit.fileName}`,
          completed: true
        });
        continue;
      }
      if (!preferCallerHits && verdict === "mention") {
        skippedPaths?.add(pathKey);
        emit({
          index: 0,
          tool: "read_file",
          summary: `read_file skipped (mention): ${hit.fileName}`,
          completed: true
        });
        continue;
      }
      if (!preferCallerHits && !locateReadCountsAsGrounding({ path: hit.fileName, body, query })) {
        skippedPaths?.add(pathKey);
        emit({
          index: 0,
          tool: "read_file",
          summary: `read_file skipped (no symbol match): ${hit.fileName}`,
          completed: true
        });
        continue;
      }
      if (isApiRejectAsk(query)) {
        const jumped = await this.readWriteRejectInSameFile(
          repoId,
          hit.fileName,
          query,
          emit,
          context,
          conversation
        );
        if (jumped.ok) {
          return jumped;
        }
        if (!contentLooksLikeAskedFieldReject(body, query, hit.fileName)) {
          skippedPaths?.add(pathKey);
          emit({
            index: 0,
            tool: "read_file",
            summary: `read_file skipped (no write/reject): ${hit.fileName}`,
            completed: true
          });
          continue;
        }
      }
      this.mergeContext(context, "read_file", readRaw);
      conversation?.push({
        role: "assistant",
        content: JSON.stringify({
          tool: "read_file",
          args: usedWindow
            ? { path: hit.fileName, startLine, endLine }
            : { path: hit.fileName }
        })
      });
      conversation?.push({ role: "user", content: readRaw });
      emit({
        index: 0,
        tool: "read_file",
        summary: `read_file: ${hit.fileName}`,
        completed: true
      });
      return { ok: true, raw: readRaw, path: hit.fileName };
    }
    return { ok: false };
  }

  /**
   * A definition window (L10–17) is not proof there are no callers. Re-read the
   * whole file; same-file `extractBearerToken(` at L77 counts.
   */
  private async expandReadForCallers(
    repoId: string,
    query: string,
    args: Record<string, unknown>,
    raw: string,
    emit: (step: AgentStep) => void,
    context: AgentSessionContext,
    conversation?: AgentConversationMessage[],
    groundedExport?: string
  ): Promise<{ raw: string; callerRead: boolean }> {
    if (readBodyHasCallerUse(readFileBodies(raw), query, groundedExport)) {
      return { raw, callerRead: true };
    }
    const expanded = await this.retryReadWithoutWindow(args, repoId, query);
    if (!expanded?.matchesSymbol) {
      return { raw, callerRead: false };
    }
    this.mergeContext(context, "read_file", expanded.raw);
    const path = typeof args.path === "string" ? args.path : "";
    conversation?.push({
      role: "assistant",
      content: JSON.stringify({ tool: "read_file", args: { path } })
    });
    conversation?.push({ role: "user", content: expanded.raw });
    emit({
      index: 0,
      tool: "read_file",
      summary: `read_file: ${path}`,
      completed: true
    });
    return {
      raw: expanded.raw,
      callerRead: readBodyHasCallerUse(readFileBodies(expanded.raw), query, groundedExport)
    };
  }

  /**
   * Preferred hits existed but were never opened, or named-symbol searches missed
   * an OR role phrase. Read a matching hit before INDEX_HUNT_MISS or vendor fill.
   */
  private async lastChanceReadMatchingHit(
    repoId: string,
    query: string,
    emit: (step: AgentStep) => void,
    context: AgentSessionContext,
    conversation?: AgentConversationMessage[],
    preferCallerHits = false,
    skipQueries: Set<string> = new Set(),
    groundedExport?: string,
    implementationPath?: string
  ): Promise<{ ok: boolean; raw?: string; path?: string }> {
    const parsed = context.search_code as (SearchPayload & { preferredHits?: SearchHit[] }) | undefined;
    let hits = parsed?.preferredHits ?? [];
    const roleHints = queryRoleHints(query);
    if (!preferCallerHits && roleHints.length > 0) {
      hits = hits.filter((hit) =>
        textMentionsQueryRoles(`${hit.fileName}\n${hit.content ?? ""}`, query)
      );
    }
    const skippedPaths = new Set<string>();
    if (hits.length) {
      const opened = await this.readFirstMatchingHit(
        repoId,
        query,
        hits,
        emit,
        context,
        conversation,
        skippedPaths,
        preferCallerHits,
        groundedExport,
        implementationPath
      );
      if (opened.ok) {
        return opened;
      }
    }
    const callerQueries =
      preferCallerHits && groundedExport
        ? [groundedExport, ...identifierSearchAliases(groundedExport)]
        : undefined;
    const found = await this.searchUntilReadableHits(
      repoId,
      callerQueries ? groundedExport! : query,
      emit,
      context,
      skipQueries,
      callerQueries
    );
    if (!found?.toRead.length) {
      return { ok: false };
    }
    return this.readFirstMatchingHit(
      repoId,
      query,
      found.toRead,
      emit,
      context,
      conversation,
      skippedPaths,
      preferCallerHits,
      groundedExport,
      implementationPath
    );
  }

  /**
   * C2: the index hit is often a read-only serializer class in the same file as
   * `validate()` / ValidationError. Open the file and jump to that line.
   */
  private async loadWriteRejectWindow(
    repoId: string,
    filePath: string,
    query: string
  ): Promise<{ raw: string; startLine: number; endLine: number } | undefined> {
    const fullRaw = await this.executeTool("read_file", { path: filePath, repoId });
    if (!readFilePayloadHasBody(fullRaw)) {
      return undefined;
    }
    const parsed = JSON.parse(fullRaw) as ReadFilePayload;
    const body = (parsed.files ?? []).map((file) => file.content).join("\n");
    const line = lineNumberOfWriteReject(body, query, filePath);
    if (!line) {
      return undefined;
    }
    const { startLine, endLine } = readLineWindow(line);
    const windowRaw = await this.executeTool("read_file", {
      path: filePath,
      repoId,
      startLine,
      endLine
    });
    if (!readFilePayloadHasBody(windowRaw)) {
      return undefined;
    }
    const windowBody = (JSON.parse(windowRaw) as ReadFilePayload).files
      ?.map((file) => file.content)
      .join("\n");
    if (!windowBody || !contentLooksLikeAskedFieldReject(windowBody, query, filePath)) {
      return undefined;
    }
    return { raw: windowRaw, startLine, endLine };
  }

  private async readWriteRejectInSameFile(
    repoId: string,
    filePath: string,
    query: string,
    emit: (step: AgentStep) => void,
    context: AgentSessionContext,
    conversation?: AgentConversationMessage[]
  ): Promise<{ ok: boolean; raw?: string }> {
    const jumped = await this.loadWriteRejectWindow(repoId, filePath, query);
    if (!jumped) {
      return { ok: false };
    }
    this.mergeContext(context, "read_file", jumped.raw);
    conversation?.push({
      role: "assistant",
      content: JSON.stringify({
        tool: "read_file",
        args: { path: filePath, startLine: jumped.startLine, endLine: jumped.endLine }
      })
    });
    conversation?.push({ role: "user", content: jumped.raw });
    emit({
      index: 0,
      tool: "read_file",
      summary: `read_file: ${filePath} (validate/reject)`,
      completed: true
    });
    return { ok: true, raw: jumped.raw };
  }

  /**
   * C2: do not stop at the first ranked hit list. OpenAPI and read-only
   * classes often fill preferredHits; keep searching until a body actually
   * rejects/writes, then answer from that window only.
   * One pass: never re-search a query, never re-read a path already proven not a reject.
   */
  private async huntWriteReject(
    repoId: string,
    query: string,
    emit: (step: AgentStep) => void,
    context: AgentSessionContext,
    conversation?: AgentConversationMessage[]
  ): Promise<boolean> {
    const cap = isApiRejectAsk(query) ? MAX_API_REJECT_SEARCH_ATTEMPTS : MAX_SEARCH_ATTEMPTS;
    const queries = fallbackAgentSearchQueries(query).slice(0, cap);
    const skippedPaths = new Set<string>();
    const triedQueries = new Set<string>();
    for (const searchQuery of queries) {
      const queryKey = searchQuery.trim().toLowerCase();
      if (!queryKey || triedQueries.has(queryKey)) {
        continue;
      }
      triedQueries.add(queryKey);
      try {
        const searchRaw = await this.executeTool("search_code", { query: searchQuery, repoId });
        const decorated = this.decorateToolResult("search_code", searchRaw, query);
        this.mergeContext(context, "search_code", decorated);
        emit({
          index: 0,
          tool: "search_code",
          summary: `search_code: ${truncateSummary(searchQuery)}`,
          completed: true
        });
        const parsed = JSON.parse(decorated) as SearchPayload & { preferredHits?: SearchHit[] };
        const toRead = (parsed.preferredHits ?? []).filter((hit) => {
          if (!hit.fileName) {
            return false;
          }
          return !skippedPaths.has(normalizeHuntPath(hit.fileName));
        });
        if (!toRead.length) {
          continue;
        }
        const opened = await this.readFirstMatchingHit(
          repoId,
          query,
          toRead,
          emit,
          context,
          conversation,
          skippedPaths
        );
        if (opened.ok && contextHasWriteReject(context, query)) {
          return true;
        }
      } catch {
        continue;
      }
    }
    return false;
  }

  private async searchUntilReadableHits(
    repoId: string,
    query: string,
    emit: (step: AgentStep) => void,
    context: AgentSessionContext,
    skipQueries: Set<string> = new Set(),
    searchQueries?: string[]
  ): Promise<{ toRead: SearchHit[] } | undefined> {
    const queries = (searchQueries ?? fallbackAgentSearchQueries(query))
      .filter((candidate) => !skipQueries.has(candidate))
      .slice(0, MAX_SEARCH_ATTEMPTS);
    let stepIndex = 0;
    const tried: string[] = [];
    let lastError: string | undefined;
    for (const searchQuery of queries) {
      tried.push(searchQuery);
      skipQueries.add(searchQuery);
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
      const toRead = preferredHitsForLocate(parsed.preferredHits ?? [], query);
      if (toRead.length > 0) {
        return { toRead };
      }
    }
    if (context.search_code && typeof context.search_code === "object") {
      context.search_code = {
        ...context.search_code,
        exhaustedQueries: tried,
        skipNote: agentSearchSkipNote(tried, lastError)
      };
    }
    return undefined;
  }

  /**
   * The model often asks for startLine:1 (copyright). If search already found
   * the declaration, window around that line instead.
   */
  private applyPreferredReadWindow(
    args: Record<string, unknown>,
    context: AgentSessionContext
  ): void {
    const path = typeof args.path === "string" ? args.path : "";
    const line = preferredLineForPath(context.search_code, path);
    if (line < 1) {
      return;
    }
    const window = readLineWindow(line);
    args.startLine = window.startLine;
    args.endLine = window.endLine;
  }

  private async retryReadWithoutWindow(
    args: Record<string, unknown>,
    repoId: string,
    query: string
  ): Promise<{ raw: string; matchesSymbol: boolean } | undefined> {
    const path = typeof args.path === "string" ? args.path : "";
    if (!path.trim()) {
      return undefined;
    }
    try {
      const raw = await this.executeTool("read_file", { path, repoId });
      const judged = this.judgeReadResult(raw, query, { path, repoId });
      return judged.matchesSymbol ? judged : undefined;
    } catch {
      return undefined;
    }
  }

  private prepareToolArgs(
    tool: AgentToolName,
    planArgs: Record<string, unknown>,
    repoId: string,
    userMessage: string,
    hunt?: { callerSearch?: string }
  ): Record<string, unknown> {
    const args: Record<string, unknown> = { ...planArgs, repoId };
    if (tool === "search_code") {
      const callerSearch = hunt?.callerSearch?.trim();
      if (callerSearch) {
        args.query = sanitizeAgentSearchQuery(callerSearch, callerSearch);
      } else {
        const raw = typeof args.query === "string" ? args.query : "";
        args.query = sanitizeAgentSearchQuery(raw, userMessage);
      }
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
        : "Every hit was a barrel, build output, vendored file, or a near-miss name (e.g. require_authentication ≠ requireAuth). Search again with a different term.";
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
      const prev = context[tool];
      context[tool] = mergeIntegrationPayload(prev, parsed);
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
      const ids = parseOpenIds(args);
      if (ids.length > 0) {
        return `${tool}: Open ${ids.join(", ")}`;
      }
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
    if (parsed.skipNote && !(parsed.files ?? []).some((file) => Boolean(file.content?.trim()))) {
      return false;
    }
    return (parsed.files ?? []).some((file) => Boolean(file.content?.trim()));
  } catch {
    return false;
  }
}

function readFileBodies(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as ReadFilePayload;
    return (parsed.files ?? []).map((file) => file.content ?? "").join("\n");
  } catch {
    return "";
  }
}

function readBodiesUnprefixed(parsed: ReadFilePayload | undefined): string {
  return (parsed?.files ?? [])
    .map((file) => `${file.path}\n${stripReadLinePrefixes(file.content ?? "")}`)
    .join("\n");
}

function readFileContextHasBody(context: AgentSessionContext | undefined): boolean {
  const payload = context?.read_file as ReadFilePayload | undefined;
  if (!payload) {
    return false;
  }
  const files = payload.files ?? [];
  if (payload.skipNote && !files.some((file) => Boolean(file.content?.trim()))) {
    return false;
  }
  return files.some((file) => Boolean(file.content?.trim()));
}

function contextHasWriteReject(
  context: AgentSessionContext | undefined,
  query: string
): boolean {
  const files = (context?.read_file as ReadFilePayload | undefined)?.files ?? [];
  return files.some((file) =>
    contentLooksLikeAskedFieldReject(file.content ?? "", query, file.path ?? "")
  );
}

function pruneContextToWriteReject(context: AgentSessionContext | undefined, query: string): void {
  if (!context?.read_file || typeof context.read_file !== "object") {
    return;
  }
  const payload = context.read_file as ReadFilePayload;
  const files = filterWriteRejectFiles(payload.files ?? [], query);
  context.read_file = { ...payload, files };
}

function compactApiRejectConversation(
  query: string,
  context: AgentSessionContext | undefined
): AgentConversationMessage[] {
  const messages: AgentConversationMessage[] = [{ role: "user", content: query }];
  const payload = context?.read_file;
  if (payload && JSON.stringify(payload).length > 2) {
    messages.push({ role: "assistant", content: JSON.stringify({ tool: "read_file" }) });
    messages.push({ role: "user", content: JSON.stringify(payload) });
  }
  return messages;
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
