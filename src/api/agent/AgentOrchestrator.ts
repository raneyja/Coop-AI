import { gatherRequest } from "./gatherRequest";
import { resolveRepoSourceScope, scopedIntegrations } from "../../context/repoSourceScope";
import { requestedRepoFiles, normalizeRequestedPath, formatRequestedFileOutcomes, resolveRepoFileScope, repoFileScopeAllowsPath, type RequestedRepoFile } from "./requestedRepoFiles";
import { isDirectRepoFileQuestion } from "./directRepoFileQuestion";
import { requestedRepoBranch } from "../../workspace/repoTargetResolver";
import { formatVerifiedFieldHandlingAnswer } from "./fieldHandlingEvidence";
import { remainingContextGatherBudgetMs, requiredEvidenceDeadlineAt } from "../../config/responseDeadline";
import { randomUUID } from "node:crypto";
import { stripPleaseOpenAttachedPaths } from "../../chat/customerFacingAnswer";
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
import { createRunToolContext } from "./runToolContext";
import { agentSearchSkipNote, parseAgentToolPlan } from "./parseAgentToolPlan";
import {
  mergePlannedAgentSearchQueries,
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
  verifiedFieldHandlingEvidence,
  isApiRejectAsk,
  isBackendStateLocateAsk,
  isBackendStateDefinitionHit,
  isCompoundAuthAndStateLocateAsk,
  isCreateDefinitionHit,
  isCreateLocateAsk,
  isDefinitionLocateAsk,
  isRequestAuthEnforcementHit,
  contentLooksLikeAskedFieldReject,
  contentLooksLikeCreateHandler,
  contentLooksLikeUnauthorizedWrite,
  contentLooksLikeWriteReject,
  lineNumberOfCreateHandler,
  lineNumberOfWriteReject,
  lineNumberOfUnauthorizedWrite,
  textMentionsQueryRoles,
  readBodyHasCallerUse,
  lineNumberOfCallerUse,
  isFailOpenRejectHit,
  askedRejectErrorQuotes,
  askedRejectFieldTokens,
  askRejectJobTokens,
  rejectEvidenceMatchesAskJob,
  isWeakRejectTwinForAsk,
  rejectInventPathRank,
  relatedSerializerPathsFromWeakTwin,
  scoreRejectPathForAskJob,
  inventRejectSymbolSearchCriteria,
  contentIncludesAskedRejectQuote,
  isParserLocateAsk
} from "./searchQuery";
import { findQueryMatchLine } from "./tools/searchCode";
import { isFileCallerQuery, isShipCheckQuery } from "../../context/fileCallerIntent";
import {
  classifyLocateRead,
  locateReadCountsAsGrounding,
  lineNumberOfGroundedExport,
  pickGroundedExport,
  preferredHitsForLocate
} from "./locateEvidence";
import { createAgentToolRegistry } from "./tools/registry";
import { handleIntegrationSearch } from "./tools/integrationSearch";
import { stripReadLinePrefixes, numberReadLines } from "./tools/readFile";
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
import { isMutationHandlerPath, isServerWritePath } from "../../indexing/evidencePathNoise";

export { pickTopSearchHit };

const DEFAULT_MAX_STEPS = AGENT_MAX_TOOL_ROUNDS;
const READ_LINE_PADDING = 25;
/** Each retry is another round trip — the gather budget is shared with the answer. */
const MAX_SEARCH_ATTEMPTS = 8;
/**
 * Fail-open / no-planTurn only — small seed, not the 12-query scavenger brain.
 * Live reject asks use planTurn; this caps deterministic fallback.
 */
const MAX_API_REJECT_SEED_SEARCHES = 4;
/** Cap attached reject sites compared under multi-hit gather (no first-twin freeze). */
const MAX_REJECT_SHORTLIST = 3;
/** Cap consecutive search_code without a consuming read on reject (blocks 10/0 parade). */
const MAX_REJECT_SEARCH_STREAK = 4;
/** Rails-only ledger of attachable reject snippets across search overwrites. */
const MAX_REJECT_HIT_LEDGER = 5;

type RejectHitLedgerEntry = {
  fileName: string;
  content: string;
  lineNumber: number;
};

type UnusedRejectEvidence =
  | { kind: "snippet"; path: string; content: string; lineNumber: number }
  | { kind: "jump"; path: string };
/** Read budget when the index returned a hit with no line number. */
const UNPOSITIONED_READ_LINES = 120;
const INDEX_HUNT_MISS =
  "I couldn't find that in this repo. Try a more specific name, or open the file.";
/** On-call API reject — never reuse the named-function miss copy. */
function apiRejectHuntMiss(steps: AgentStep[]): string {
  const opened = steps.some(
    (step) =>
      step.tool === "read_file" &&
      !/failed|skipped|search snippet only|not remotely verified/i.test(step.summary)
  );
  const snippetOnly = steps.some((step) => /search snippet only|not remotely verified/i.test(step.summary));
  return opened
    ? "I couldn't find where the API rejects that field: the opened candidate content did not confirm the server-side reject. I won't guess a path."
    : snippetOnly
      ? "I couldn't confirm where the API rejects that field: search found a matching snippet, but no opened remote file body verified it. I won't cite an unverified source."
    : "I couldn't find where the API rejects that field: the indexed searches yielded no attachable reject snippet, and no opened file confirmed it. I won't guess a path.";
}
/** Cap extra ship-check sibling reads (401 writers + tests) after the definition. */
const SHIP_CHECK_MAX_RIPPLE_READS = 5;
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

type SearchBudget = {
  maxSearches?: number;
  canContinue?: () => boolean;
};

type ReadFilePayload = {
  path?: string;
  files?: Array<{
    path: string;
    content: string;
    evidenceSource?: "remote-read" | "search-snippet" | "turn-attachment";
    repoId?: string;
    branch?: string;
    truncated?: boolean;
  }>;
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

function messageIsReadFileOfPath(content: string, path: string): boolean {
  try {
    const parsed = JSON.parse(content) as { tool?: string; args?: { path?: string } };
    return (
      parsed.tool === "read_file" &&
      typeof parsed.args?.path === "string" &&
      sameHuntPath(parsed.args.path, path)
    );
  } catch {
    return false;
  }
}

function payloadIsReadFileOfPath(content: string, path: string): boolean {
  try {
    const parsed = JSON.parse(content) as ReadFilePayload & { hits?: unknown; tool?: unknown };
    if (parsed.hits || parsed.tool) {
      return false;
    }
    const files = parsed.files ?? [];
    if (files.some((file) => file.path && sameHuntPath(file.path, path))) {
      return true;
    }
    return Boolean(parsed.path && sameHuntPath(parsed.path, path) && files.length > 0);
  } catch {
    return false;
  }
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
  loadRepoFacts?: (target: import("../../workspace/indexedRepoWorkspaceTypes").RepoTarget,
    onProgress?: (facts: Record<string, unknown>) => void) => Promise<Record<string, unknown> | undefined>;
  /** Started alongside source reads; settled before synthesis. */
  repoFacts?: Promise<Record<string, unknown> | undefined>;
  capturedAttachment?: { repoId: string; branch?: string; files: Array<{ path: string; content: string; lineRange?: [number, number] }> };
  repoTarget?: import("../../workspace/indexedRepoWorkspaceTypes").RepoTarget;
  onStep?: (step: AgentStep, steps: AgentStep[]) => void;
  /** Opt-in, content-minimized trace for diagnosing indexed-repo hunts. */
  onDiagnostic?: (event: Record<string, unknown>) => void;
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
  /**
   * Intent-quarterback index queries for this turn (prefer over slogan banks).
   * Empty/omitted → invent + fallbackAgentSearchQueries fail-open.
   * Seeds only — the agent loop owns further gather.
   */
  plannedSearchQueries?: string[];
  /**
   * Quarterback job brief for planTurn context (purpose / evidence class /
   * done-looks-like). Never sets silent workflows. Fail-open when omitted.
   */
  intentBrief?: string;
  projectInstructions?: string;
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
  private preserveCompoundWriteEvidence = false;
  private readonly registry;
  private runAllowedIntegrations: IntegrationChatProvider[] = [];
  private runSearchIntegration?: AgentRunOptions["searchIntegration"];
  private runSignal?: AbortSignal;
  private loopContext?: AgentSessionContext;
  private allowedRepoTools = true;
  private runPlannedSearchQueries: string[] = [];
  /** Rails-only: attachable reject snippets across search_code overwrites. */
  private rejectHitLedger: RejectHitLedgerEntry[] = [];
  /** Rails-only: serializer/server-write paths seen this turn (survive search overwrite). */
  private rejectJumpPathLedger = new Set<string>();
  /** One-shot last-chance quote searches before canned miss. */
  private rejectQuoteLastChanceTried = new Set<string>();
  /** One-shot: ask-derived symbol invent when quote + codehost still miss. */
  private rejectInventLastChanceTried = false;

  public constructor(private readonly ctx: AgentToolContext) {
    this.registry = createAgentToolRegistry(ctx);
  }

  public async executeTool(tool: AgentToolName, args: Record<string, unknown>): Promise<string> {
    if (isAgentIntegrationTool(tool)) {
      return gatherRequest(this.ctx, "integration-search", () => handleIntegrationSearch(
        {
          ...this.ctx,
          allowedIntegrations: this.runAllowedIntegrations,
          searchIntegration: this.runSearchIntegration ?? this.ctx.searchIntegration,
          priorIntegrationPayload: this.loopContext?.[tool],
          searchSignal: this.runSignal
        },
        tool,
        args
      ), JSON.stringify({ error: "Integration evidence unavailable" }));
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
    if (!request.repoId?.trim() || !request.message.trim() || options?.signal?.aborted) {
      return { steps: [], context: undefined };
    }
    const runId = randomUUID();
    const diagnostic = options?.onDiagnostic;
    const startedAt = Date.now();
    options = { ...options, onDiagnostic: diagnostic ? (event) => diagnostic({ runId, turnElapsedMs: Date.now() - startedAt, ...event }) : undefined };
    const requested = { ...options?.repoTarget, repoId: request.repoId.trim() };
    const gatherContext = { ...this.ctx, researchQuery: request.message, locateMode: request.action === "locate",
      gatherStartedAt: options.startedAt ?? startedAt, searchSignal: options.signal, onDiagnostic: options.onDiagnostic };
    let target: import("../../workspace/indexedRepoWorkspaceTypes").RepoTarget | undefined;
    try {
      target = this.ctx.resolveRepoTarget
        ? await gatherRequest(gatherContext, "target-resolution", () => this.ctx.resolveRepoTarget!(requested), undefined)
        : requested;
    } catch (error) {
      options.onDiagnostic?.({ stage: "outcome", repoId: requested.repoId, requestedBranch: requested.branch,
        outcome: "target-error", stopped: Boolean(options.signal?.aborted) });
      if (options.signal?.aborted) return { steps: [], context: undefined };
      throw error;
    }
    if (!target?.repoId) {
      options.onDiagnostic?.({ stage: "outcome", repoId: requested.repoId, requestedBranch: requested.branch,
        outcome: "target-unavailable", elapsedMs: Date.now() - startedAt });
      return { steps: [], answer: "I couldn’t verify the selected repository and branch for this turn, so I can’t identify its source safely." };
    }
    const run = new AgentOrchestrator(createRunToolContext(gatherContext, target, options.onDiagnostic));
    if (options.capturedAttachment && (options.capturedAttachment.repoId !== target.repoId ||
        options.capturedAttachment.branch !== target.branch)) {
      options = { ...options, capturedAttachment: undefined };
      options.onDiagnostic?.({ stage: "attachment-agent-rejected", reason: "target-mismatch" });
    }
    options?.onDiagnostic?.({ stage: "target", repoId: target.repoId, requestedBranch: requested.branch, resolvedBranch: target.branch });
    const explicitBranch = requestedRepoBranch(request.message);
    if (explicitBranch && explicitBranch !== target.branch) {
      options.onDiagnostic?.({ stage: "outcome", repoId: target.repoId, requestedBranch: explicitBranch,
        resolvedBranch: target.branch, outcome: "branch-mismatch", stepCount: 0, hasAnswer: true });
      return { steps: [], answer: `You asked about branch \`${explicitBranch}\`, but this repository’s indexed workspace is on ${target.branch ? `\`${target.branch}\`` : "an unverified branch"}. I can’t verify the requested implementation on \`${explicitBranch}\` from that workspace. Index the requested branch before retrying, or ask about the currently indexed branch.` };
    }
    try {
      const result = await run.runInternal(request, options);
      for (const file of (result.context?.read_file as ReadFilePayload | undefined)?.files ?? []) {
        if (file.evidenceSource !== "remote-read" || !file.path || !file.content) continue;
        const body = stripReadLinePrefixes(file.content);
        const verified = isApiRejectAsk(request.message)
          ? contentLooksLikeAskedFieldReject(body, request.message, file.path) || Boolean(verifiedFieldHandlingEvidence({ path: file.path, content: file.content, evidenceSource: file.evidenceSource }, request.message))
          : locateReadCountsAsGrounding({ path: file.path, body, query: request.message });
        if (verified) run.ctx.candidateLedger?.record(target.repoId!, file.path, request.message, "verified");
      }
      options?.onDiagnostic?.({ stage: "outcome", candidateLedger: run.ctx.candidateLedger?.snapshot(target.repoId!), repoId: target.repoId, resolvedBranch: target.branch, elapsedMs: Date.now() - startedAt, stopped: Boolean(options?.signal?.aborted), stepCount: result.steps.length, hasAnswer: Boolean(result.answer), evidencePaths: ((result.context?.read_file as ReadFilePayload | undefined)?.files ?? []).map((file) => file.path) });
      return result;
    } catch (error) {
      options?.onDiagnostic?.({ stage: "outcome", repoId: target.repoId, resolvedBranch: target.branch, elapsedMs: Date.now() - startedAt, outcome: "error", stopped: Boolean(options?.signal?.aborted) });
      throw error;
    }
  }

  private async runInternal(
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

    const sourceScope = resolveRepoSourceScope(query);
    options = { ...options,
      allowedIntegrations: scopedIntegrations(options?.allowedIntegrations ?? [], sourceScope),
      fillIntegrations: scopedIntegrations(options?.fillIntegrations ?? [], sourceScope) };
    this.runAllowedIntegrations = options.allowedIntegrations ?? [];
    this.runSearchIntegration = options?.searchIntegration;
    this.runSignal = options?.signal;
    this.allowedRepoTools = options?.allowedRepoTools !== false;
    this.runPlannedSearchQueries = options?.plannedSearchQueries ?? [];
    const fileScope = resolveRepoFileScope(query);
    if (!repoFileScopeAllowsPath(fileScope, "AGENTS.md")) options = { ...options, projectInstructions: undefined };
    if (options.capturedAttachment) options = { ...options, capturedAttachment: {
      ...options.capturedAttachment, files: options.capturedAttachment.files.filter((file) => repoFileScopeAllowsPath(fileScope, file.path))
    } };
    if (options.loadRepoFacts) {
      const snapshot: Record<string, unknown> = { repoInventory: { source: "unavailable", note: "Repository totals could not be verified. Do not estimate them." } };
      let accepting = true;
      const loader = options.loadRepoFacts;
      const repoFacts = gatherRequest(this.ctx, "repo-facts",
        () => loader(this.ctx.repoTarget!, facts => {
          if (accepting && !this.runSignal?.aborted) {
            for (const key of Object.keys(snapshot)) delete snapshot[key];
            Object.assign(snapshot, facts);
          }
        }), snapshot).catch(() => snapshot).finally(() => { accepting = false; });
      options = { ...options, repoFacts };
    }
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
      this.runPlannedSearchQueries = [];
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
    // maxSteps limits model-planned tool calls. Internal evidence reads used
    // to discard noise must remain visible, but they cannot starve the model
    // before it reaches the serializer/handler refinement it needs.
    let modelToolSteps = 0;
    const context: AgentSessionContext = {};
    const conversation: AgentConversationMessage[] = [{ role: "user", content: query }];
    if (options.intentBrief?.trim()) {
      conversation.push({ role: "user", content: options.intentBrief.trim() });
    } else if (isApiRejectAsk(query) && action !== "change") {
      const quoteHints = askedRejectErrorQuotes(query).slice(0, 1);
      const jobTokens = askRejectJobTokens(query);
      conversation.push({
        role: "user",
        content: [
          "Job brief: find the server write/reject for the asked field.",
          quoteHints.length > 0
            ? `Exact error quote to search early: "${quoteHints[0]}".`
            : "When the ask quotes an error string, search that Exact quote first (not ValidationError or bare field_id).",
          jobTokens.length > 0
            ? `Ask job words: ${jobTokens.join("/")}. If the first raise site does not mention them, search/read another sibling under budget.`
            : "",
          "Done = a read_file body that raises/ValidationError/rejects that field is attached.",
          "Prefer API serializers/views. Do not stop on web components, types, error_codes catalogs, or bgtasks.",
          "Seed searchCriteria are optional hints — invent further queries from results."
        ]
          .filter(Boolean)
          .join(" ")
      });
    }
    const emit = (step: AgentStep) => {
      steps.push(step);
      options.onStep?.(step, [...steps]);
    };
    const startedAt = options.startedAt ?? Date.now();
    const wallMs = options.wallMs ?? AGENT_JOB_WALL_MS;
    const rejectEvidenceDeadline =
      isApiRejectAsk(query) ? requiredEvidenceDeadlineAt(startedAt) : undefined;
    let filesRead = 0;
    let integrationCalls = 0;
    let lastToolResult: string | undefined;
    let matchingRead = false;
    let callerRead = false;
    let groundedExport = queryHasNamedSymbol(query) ? extractAgentSearchQuery(query) : undefined;
    let implementationPath: string | undefined;
    /** Server-write / serializer paths opened this turn — jump before abandoning / miss. */
    const openedServerWritePaths = new Set<string>();
    const triedSearchQueries = new Set<string>();
    let rejectSearchStreak = 0;
    this.rejectHitLedger = [];
    this.rejectJumpPathLedger = new Set();
    this.rejectQuoteLastChanceTried = new Set();
    this.rejectInventLastChanceTried = false;
    let rejectMultiHitNudgeSent = false;
    const wantsCallerRead = (): boolean =>
      isFileCallerQuery(query) &&
      (queryHasNamedSymbol(query) || Boolean(groundedExport) || isShipCheckQuery(query));
    const allowedIntegrations = options.allowedIntegrations ?? [];
    this.loopContext = context;
    const vendorState = new Map<AgentToolName, VendorToolState>();
    const allowedRepoTools = options.allowedRepoTools !== false;
    const capturedFiles = options.capturedAttachment?.files.filter((file) => file.path && file.content.trim()) ?? [];
    if (capturedFiles.length > 0) {
      context.read_file = { files: capturedFiles.map((file) => ({ ...file,
        content: numberReadLines(file.content, file.lineRange?.[0] ?? 1), evidenceSource: "turn-attachment" })) };
      lastToolResult = JSON.stringify(context.read_file);
      conversation.push({ role: "user", content: `Authoritative source captured for this turn:\n${lastToolResult}` });
      emit({ index: steps.length + 1, tool: "read_file", summary: "Read attached source", completed: true });
      matchingRead = capturedFiles.some((file) => locateReadCountsAsGrounding({ path: file.path, body: file.content, query }));
      filesRead = capturedFiles.length;
    }
    const diagnostic = options.onDiagnostic;
    diagnostic?.({
      stage: "turn",
      repoId,
      action,
      hunt: isApiRejectAsk(query)
        ? "api-reject"
        : isBackendStateLocateAsk(query)
          ? "backend-state-locate"
          : isDefinitionLocateAsk(query)
            ? "definition-locate"
            : "other",
      taskQuery: query,
      gatherStartedAt: startedAt,
      rejectEvidenceDeadline,
      gatherRemainingMs: remainingContextGatherBudgetMs(startedAt),
      plannedSearchQueries: this.runPlannedSearchQueries.slice(0, 4),
      requiredEvidence: options.intentBrief?.match(/evidence=[^\s.]+/g) ?? []
    });
    const requiresWriteSiteAndReject =
      requiresStateWriteAndReject(query, options.intentBrief);
    this.preserveCompoundWriteEvidence = requiresWriteSiteAndReject;
    const hasRequiredRejectEvidence = (): boolean =>
      contextHasVerifiedFieldBehavior(context, query) &&
      (!requiresWriteSiteAndReject || (contextHasWriteReject(context, query) && contextHasStateWriteSite(context)));
    const gatherMayProceed = (): boolean =>
      remainingContextGatherBudgetMs(startedAt) > 0 ||
      (rejectEvidenceDeadline !== undefined && Date.now() < rejectEvidenceDeadline && !hasRequiredRejectEvidence());
    const rejectGatherNudge = (): string =>
      "Reply with tool JSON: search_code or read_file. Done only after a write-reject for the asked field is attached — not a named-symbol locate.";
    /** Pure: may keep comparing reject siblings under budget (no nudge side effects). */
    const rejectGatherMayContinue = (): boolean => {
      if (!contextHasWriteReject(context, query) && contextHasVerifiedFieldBehavior(context, query)) return false;
      const files = remoteReadEvidenceFiles(
        (context.read_file as ReadFilePayload | undefined)?.files
      );
      if (rejectEvidenceMatchesAskJob(files, query)) {
        return false;
      }
      const rejectSites = files.filter((file) =>
        contentLooksLikeAskedFieldReject(file.content ?? "", query, file.path ?? "")
      ).length;
      if (rejectSites >= MAX_REJECT_SHORTLIST) {
        return false;
      }
      if (!gatherMayProceed() || Date.now() - startedAt > wallMs - 1500) {
        return false;
      }
      return true;
    };
    /** After a write-reject attach: freeze only when job matched, shortlist full, or budget gone. */
    const shouldStopAfterRejectAttach = (): boolean => {
      if (requiresWriteSiteAndReject && contextHasWriteReject(context, query) && contextHasStateWriteSite(context)) return true;
      if (requiresWriteSiteAndReject && contextHasWriteReject(context, query) && !contextHasStateWriteSite(context)) {
        lastToolResult = JSON.stringify({
          note: "Write-reject attached. The compound ask also needs the server-side state write/update site. Use read_file on the attached file's create/update method before repeating searches; follow its delegation if persistence lives elsewhere.",
          verifiedFileOutlines: (context.search_code as Record<string, unknown> | undefined)?.verifiedFileOutlines
        });
        conversation.push({ role: "user", content: lastToolResult });
        return false;
      }
      if (!rejectGatherMayContinue()) {
        return true;
      }
      if (!rejectMultiHitNudgeSent) {
        rejectMultiHitNudgeSent = true;
        const jobTokens = askRejectJobTokens(query);
        lastToolResult = JSON.stringify({
          note:
            jobTokens.length > 0
              ? `Write-reject attached, but ask job words (${jobTokens.join("/")}) are not clearly matched in that evidence. While budget remains, search_code/read_file another sibling — or {"done":true} if this is the only site.`
              : `Write-reject attached. While budget remains you may compare one more sibling, or {"done":true}.`
        });
        conversation.push({ role: "user", content: lastToolResult });
      }
      return false;
    };
    /** True when a weak twin is attached and gather may still compare siblings. */
    const wantsMoreRejectSiblings = (): boolean =>
      isApiRejectAsk(query) &&
      contextHasVerifiedFieldBehavior(context, query) &&
      rejectGatherMayContinue();
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
      if (openFile && isShipCheckQuery(query)) {
        implementationPath = openFile;
        const captured = await this.captureGroundedExport(
          openFile,
          seeded.raw ?? "",
          query,
          repoId,
          emit,
          context,
          conversation
        );
        groundedExport = captured.exportName;
        lastToolResult = captured.raw;
      }
    }
    if (allowedRepoTools) {
      const named = await this.seedNamedFileReads(
        repoId,
        query,
        emit,
        context,
        conversation
      );
      if (named.ok) {
        matchingRead = true;
        filesRead = (context.read_file as ReadFilePayload | undefined)?.files?.length ?? 0;
        lastToolResult = named.raw;
      }
    }

    // All requested bodies/outcomes are already resolved. Direct source questions
    // need no model tool planning or last-chance discovery.
    if (allowedRepoTools && action !== "change" && allowedIntegrations.length === 0 &&
        isDirectRepoFileQuestion(query) && context.requestedFiles?.length) {
      return this.finishWithAnswer({ steps, context }, query, repoId, action, options, [], matchingRead);
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
      if (context.requestedFiles?.length && context.requestedFiles.every((file) => file.status !== "read")) {
        // Unavailable/ambiguous sources are terminal outcomes, never generic misses.
        return true;
      }
      if (isApiRejectAsk(query)) {
        return hasRequiredRejectEvidence();
      }
      if (isBackendStateLocateAsk(query)) {
        return contextHasGroundedLocateRead(context, query);
      }
      if (isShipCheckQuery(query)) {
        return (
          matchingRead &&
          (callerRead || contextHasUnauthorizedSiblingWrite(context, implementationPath))
        );
      }
      if (isCompoundAuthAndStateLocateAsk(query)) {
        return (
          contextHasRequestAuthEnforcement(context) && contextHasBackendStateDefinition(context)
        );
      }
      if (isCreateLocateAsk(query)) {
        return contextHasCreateDefinition(context);
      }
      if (isDefinitionLocateAsk(query)) {
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

    // Reject + planTurn: criteria are hints in the brief only — no pre-loop parade.
    if (isApiRejectAsk(query) && action !== "change" && allowedRepoTools) {
      if (this.runPlannedSearchQueries.length > 0 && !options.intentBrief?.trim()) {
        conversation.push({
          role: "user",
          content: `Suggested searchCriteria (hints only, not executed): ${this.runPlannedSearchQueries
            .slice(0, 4)
            .join("; ")}`
        });
      }
    }

    const skipDeterministicFallback = !allowedRepoTools || isApiRejectAsk(query);
    const askedFields = askedRejectFieldTokens(query).map((field) =>
      field.replace(/_id$/i, "")
    );
    const signingPendingReject =
      /\b(?:signing|signer|envelope|recipient)\b/i.test(query) &&
      /\bmust\s+be\s+pending\s+for\s+signing\b/i.test(query);
    const firstRejectFieldCriteria = signingPendingReject
      ? ["must be pending for signing"]
      : /\b(?:state|transition|backlog)\b/i.test(query)
        ? ["validate_state"]
        : askedFields.some((field) => /^parent$/i.test(field))
          ? [/\bissue_id\b/i.test(query) ? "Parent is not valid issue_id" : "validate_parent"]
          : askedFields.map((field) => `get("${field}")`);
    // Status wording is still an observed server rejection. Letting the
    // planner own the first search made this exact class of ask nondeterministic:
    // the model could answer or mark done before it ever called search_code.
    // Seed status rejects deterministically, just like parent/state rejects;
    // the model remains responsible for refinement after seeing real hits.
    const modelOwnsStatusSearch = false;
    const firstRejectSearchQuery =
      isApiRejectAsk(query) && action !== "change" && allowedRepoTools && !modelOwnsStatusSearch &&
        (firstRejectFieldCriteria.length > 0 || askedRejectErrorQuotes(query).length > 0)
        ? mergePlannedAgentSearchQueries({
            userMessage: query,
            planned: firstRejectFieldCriteria,
            max: 1
          })[0]
        : undefined;
    const firstRepoPreflightQuery = firstRejectSearchQuery ?? (
      action !== "change" && allowedRepoTools &&
      (isDefinitionLocateAsk(query) && queryHasNamedSymbol(query) &&
        /\b(?:[a-z][A-Z][A-Za-z0-9]*|[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+)\b/.test(query) &&
        !isApiRejectAsk(query) && !isBackendStateLocateAsk(query) && !isFileCallerQuery(query))
        ? extractAgentSearchQuery(query)
        : undefined
    );
    // Do the mandatory reject hunt before asking the model to plan. A planner
    // round can consume the entire soft gather window on an index miss, which
    // previously meant the model never received a candidate file to read.
    // This is the contract for every API-rejection question: search first,
    // then let the model choose/refine the read from real repository evidence.
    let forcedRejectSearchDone = false;
    let preflightGrounded = false;
    if (firstRepoPreflightQuery) {
      try {
        const searchRaw = await this.executeTool("search_code", {
          query: firstRepoPreflightQuery,
          repoId
        });
        const decorated = this.decorateToolResult("search_code", searchRaw, query);
        this.mergeContext(context, "search_code", decorated);
        emit({
          index: steps.length,
          tool: "search_code",
          summary: `search_code: ${truncateSummary(firstRepoPreflightQuery)} (forced repository preflight)`,
          completed: true
        });
        lastToolResult = decorated;
        forcedRejectSearchDone = true;

        // A repository question is not grounded by search results alone. The
    // first search must be followed by a verified implementation read
    // before the model gets to decide that it has enough evidence. Read
    // the ranked candidates through the same strict gate as the normal
    // loop so a caller/type/test hit cannot satisfy a calm locate ask.
        if (isDefinitionLocateAsk(query) && queryHasNamedSymbol(query) &&
          /\b(?:[a-z][A-Z][A-Za-z0-9]*|[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+)\b/.test(query) &&
          !isApiRejectAsk(query) && !isBackendStateLocateAsk(query)) {
          try {
            const parsed = JSON.parse(decorated) as SearchPayload & { preferredHits?: SearchHit[] };
            const candidates = [...(parsed.preferredHits ?? []), ...(parsed.hits ?? [])]
              .filter((hit, index, all) => all.findIndex((seen) => seen.fileName === hit.fileName) === index);
            const opened = await this.readFirstMatchingHit(
              repoId,
              query,
              candidates,
              emit,
              context,
              conversation,
              undefined,
              false,
              groundedExport,
              implementationPath,
              diagnostic,
              true
            );
            if (opened.ok) {
              matchingRead = true;
              filesRead += 1;
              lastToolResult = opened.raw;
              implementationPath = implementationPath ?? opened.path;
              preflightGrounded = true;
            }
          } catch {
            // Keep the search result and let the model refine or retry. A
            // failed candidate read must not turn into an invented answer.
          }
        }

        // Signing-status rejects contain a distinctive natural-language error,
        // but do not always name the field as `status`. Open the exact phrase's
        // candidate immediately so the model cannot finish after a generic
        // `get("status")` search without reading the handler body.
        if (signingPendingReject && isApiRejectAsk(query)) {
          try {
            const parsed = JSON.parse(decorated) as SearchPayload & { preferredHits?: SearchHit[] };
            const candidates = [...(parsed.preferredHits ?? []), ...(parsed.hits ?? [])]
              .filter((hit, index, all) => all.findIndex((seen) => seen.fileName === hit.fileName) === index);
            const opened = await this.readFirstMatchingHit(
              repoId,
              query,
              candidates,
              emit,
              context,
              conversation,
              undefined,
              false,
              groundedExport,
              implementationPath,
              diagnostic
            );
            if (opened.ok) {
              matchingRead = true;
              filesRead += 1;
              lastToolResult = opened.raw;
              implementationPath = implementationPath ?? opened.path;
              preflightGrounded = true;
            }
          } catch {
            // Preserve the search result and let the normal reject rail retry.
          }
        }
      } catch {
        // The model still gets a chance to retry/refine below; the preflight
        // must never turn a repository question into a synthetic answer.
      }
    }
    for (let round = 0; round < maxSteps; round++) {
      if (options.signal?.aborted) {
        break;
      }
      if (preflightGrounded || modelToolSteps >= maxSteps || (firstRepoPreflightQuery && maxSteps <= 1 && modelToolSteps === 0)) {
        break;
      }
      if (!gatherMayProceed() || Date.now() - startedAt > wallMs) {
        break;
      }

      let raw: string;
      try {
        raw = await gatherRequest(this.ctx, "tool-plan", () => planTurn({
          message: query,
          repoId,
          round,
          priorSteps: [...steps],
          lastToolResult,
          conversation: [...conversation],
          allowedIntegrations,
          projectInstructions: options.projectInstructions,
          requestedFiles: context.requestedFiles
        }), "", rejectEvidenceDeadline === undefined
          ? undefined
          : { deadlineAt: rejectEvidenceDeadline });
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
            ),
            openedServerWritePaths
          );
        }
        if (isApiRejectAsk(query)) {
          lastToolResult = JSON.stringify({ error: rejectGatherNudge() });
          conversation.push({
            role: "user",
            content: lastToolResult
          });
          continue;
        }
        break;
      }

      const modelPlan = parseAgentToolPlan(raw, { allowedIntegrations, allowedRepoTools });
      // Make the first reject search deterministic and ask-derived. The model
      // still owns every later refinement after it sees the actual results.
      const plan = round === 0 && firstRepoPreflightQuery && !forcedRejectSearchDone
        ? { kind: "call" as const, tool: "search_code" as const, args: { query: firstRepoPreflightQuery } }
        : modelPlan;
      diagnostic?.({
        stage: "plan",
        round,
        result: plan.kind,
        ...(plan.kind === "call"
          ? {
              tool: plan.tool,
              query: plan.tool === "search_code" && typeof plan.args.query === "string"
                ? plan.args.query.slice(0, 180)
                : undefined,
              path: plan.tool === "read_file" && typeof plan.args.path === "string"
                ? plan.args.path
                : undefined,
              forcedFirstRejectSearch: round === 0 && Boolean(firstRejectSearchQuery)
            }
          : {})
      });
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
            ),
            openedServerWritePaths
          );
        }
        if (action !== "locate" && canAnswerNow() && looksLikeProseAnswer(raw)) {
          return this.finishWithAnswer(
            { steps, context, answer: raw.trim() },
            query,
            repoId,
            action,
            options,
            conversation,
            true,
            openedServerWritePaths
          );
        }
        const block = vendorBlock();
        lastToolResult = JSON.stringify({
          error: block
            ? block
            : canAnswerNow()
              ? 'Reply {"done":true} so the next turn can answer the user, or call another allowed tool.'
              : allowedRepoTools
                ? isApiRejectAsk(query)
                  ? requiresWriteSiteAndReject && contextHasWriteReject(context, query) && !contextHasStateWriteSite(context)
                    ? "Reply with tool JSON: search_code or read_file. The reject is attached, but the compound ask also needs the server-side state write/update site."
                    : rejectGatherNudge()
                  : "Reply with a tool JSON call. You have not read an implementation of the named symbol or role — do not answer yet."
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
                ? isApiRejectAsk(query)
                  ? requiresWriteSiteAndReject && contextHasWriteReject(context, query) && !contextHasStateWriteSite(context)
                    ? "Do not finish yet. The reject is attached, but the compound ask also needs the server-side state write/update site. Call search_code or read_file."
                    : "Do not finish yet. Attach a write-reject for the asked field (ValidationError / raise / reject) — call search_code or read_file. preferredHits come first."
                  : "Do not finish yet. You have not read an implementation of the named symbol or role. Call search_code or read_file on a different path — do not answer from a mention, UI, test, or form."
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

      // Reject: consume preferredHits / attachable snippets before another search spray.
      if (
        plan.tool === "search_code" &&
        isApiRejectAsk(query) &&
        !contextHasVerifiedFieldBehavior(context, query)
      ) {
        const preferred = [...searchPreferredHits(context), ...searchRawHits(context)];
        const actionablePreferred = [
          ...new Map(
            preferred
              .filter(
                (hit) =>
                  isFailOpenRejectHit(hit, query) || isRejectJumpCandidatePath(hit.fileName)
              )
              .map((hit) => [
                `${normalizeHuntPath(hit.fileName)}:${hit.lineNumber ?? 0}`,
                hit
              ])
          ).values()
        ];
        const attachable = this.findAttachableRejectHit(
          [...this.rejectHitLedger, ...actionablePreferred, ...searchRawHits(context)],
          query
        );
        if (attachable) {
          const attached = await this.readFirstMatchingHit(
            repoId,
            query,
            [attachable],
            emit,
            context,
            conversation
          );
          if (attached.ok) {
            matchingRead = true;
            filesRead += 1;
            lastToolResult = attached.raw;
            rejectSearchStreak = 0;
            if (shouldStopAfterRejectAttach()) {
              break;
            }
            continue;
          }
        }
        if (actionablePreferred.length > 0 && filesRead < AGENT_MAX_FILES_READ) {
          const opened = await this.readFirstMatchingHit(
            repoId,
            query,
            actionablePreferred,
            emit,
            context,
            conversation
          );
          if (opened.ok) {
            matchingRead = true;
            filesRead += 1;
            lastToolResult = opened.raw;
            rejectSearchStreak = 0;
            if (contextHasVerifiedFieldBehavior(context, query)) {
              if (shouldStopAfterRejectAttach()) {
                break;
              }
              continue;
            }
          }
          // Actionable preferred exhausted without reject — allow a new search.
        }
        if (rejectSearchStreak >= MAX_REJECT_SEARCH_STREAK) {
          break;
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
      modelToolSteps += 1;
      if (plan.tool === "search_code" && typeof args.query === "string" &&
          [...triedSearchQueries].some((used) => used.toLowerCase() === (args.query as string).toLowerCase())) {
        lastToolResult = JSON.stringify({
          error: "This query was already searched in this turn. Repeating it will not establish the requested operation. Choose a different identifier or error phrase from the observed source, or read a different candidate.",
          query: args.query,
          verifiedFileOutlines: (context.search_code as Record<string, unknown> | undefined)?.verifiedFileOutlines
        });
        conversation.push({ role: "assistant", content: JSON.stringify({ tool: plan.tool, args }) });
        conversation.push({ role: "user", content: lastToolResult });
        continue;
      }
      const gatheringWriteSite = requiresWriteSiteAndReject && contextHasVerifiedFieldBehavior(context, query) && !contextHasStateWriteSite(context);
      if (plan.tool === "read_file") {
        if (!gatheringWriteSite) this.applyPreferredReadWindow(args, context);
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
        let judged = gatheringWriteSite && readFilePayloadHasBody(rawResult)
          ? { raw: rawResult, matchesSymbol: true }
          : this.judgeReadResult(rawResult, query, args);
        if (!judged.matchesSymbol) {
          const retried = await this.retryReadWithoutWindow(args, repoId, query);
          if (retried) {
            judged = retried;
            rawResult = retried.raw;
          }
        }
        rawResult = judged.raw;
        const path = typeof args.path === "string" ? args.path : "";
        if (isApiRejectAsk(query) || isBackendStateLocateAsk(query)) {
          const body = readFileBodies(rawResult);
          diagnostic?.({
            stage: "read",
            round,
            repoId,
            path,
            requestedStartLine: args.startLine,
            requestedEndLine: args.endLine,
            hasRemoteBody: readFilePayloadHasBody(rawResult),
            bodyLines: body ? body.split(/\r?\n/).length : 0,
            acceptedByReadGate: judged.matchesSymbol,
            locateVerdict: isDefinitionLocateAsk(query)
              ? classifyLocateRead({ path, body, query })
              : undefined,
            rejectMatch: isApiRejectAsk(query)
              ? contentLooksLikeAskedFieldReject(body, query, path)
              : undefined,
            skipNote: (() => {
              try {
                const parsed = JSON.parse(rawResult) as { skipNote?: unknown; error?: unknown };
                return typeof parsed.skipNote === "string"
                  ? parsed.skipNote.slice(0, 180)
                  : typeof parsed.error === "string"
                    ? parsed.error.slice(0, 180)
                    : undefined;
              } catch {
                return undefined;
              }
            })()
          });
        }
        if (isApiRejectAsk(query) && path && !gatheringWriteSite) {
          if (isRejectJumpCandidatePath(path)) {
            openedServerWritePaths.add(normalizeHuntPath(path));
          }
          const jumped = await this.loadWriteRejectWindow(repoId, path, query);
          if (jumped) {
            rawResult = jumped.raw;
            args.startLine = jumped.startLine;
            args.endLine = jumped.endLine;
            judged = { raw: jumped.raw, matchesSymbol: true };
            rejectSearchStreak = 0;
          } else if (!contentLooksLikeAskedFieldReject(readFileBodies(rawResult), query, path)) {
            // Keep body for finish jump — do not wipe with skipNote while unused.
            judged = { raw: rawResult, matchesSymbol: false };
          }
        }
        if (isCreateLocateAsk(query) && path) {
          const jumped = await this.loadCreateHandlerWindow(repoId, path);
          if (jumped) {
            rawResult = jumped.raw;
            args.startLine = jumped.startLine;
            args.endLine = jumped.endLine;
            judged = { raw: jumped.raw, matchesSymbol: true };
          } else if (
            !contentLooksLikeCreateHandler(readFileBodies(rawResult)) &&
            !isCreateDefinitionHit({
              fileName: path,
              content: readFileBodies(rawResult)
            })
          ) {
            rawResult = JSON.stringify({
              path,
              skipNote:
                "This snippet is not the create handler. Search IssueViewSet create / CreateSerializer / perform_create."
            });
            judged = { raw: rawResult, matchesSymbol: false };
          }
        }
        if (judged.matchesSymbol) {
          matchingRead = true;
          if (!implementationPath && path) {
            implementationPath = path;
          }
          if (!groundedExport && !gatheringWriteSite) {
            const captured = await this.captureGroundedExport(
              path,
              rawResult,
              query,
              repoId,
              emit,
              context,
              conversation
            );
            groundedExport = captured.exportName;
            rawResult = captured.raw;
          }
          this.mergeContext(context, plan.tool, rawResult);
          if (
            isFileCallerQuery(query) &&
            (queryHasNamedSymbol(query) || isShipCheckQuery(query)) &&
            !callerRead
          ) {
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
        if (isApiRejectAsk(query) && contextHasVerifiedFieldBehavior(context, query)) {
          if (gatheringWriteSite) {
            conversation.push({ role: "assistant", content: JSON.stringify({ tool: plan.tool, args }) });
            conversation.push({ role: "user", content: rawResult });
            emit({ index: steps.length, tool: "read_file", summary: `read_file: ${path} (write-site candidate)`, completed: true });
          }
          if (shouldStopAfterRejectAttach()) {
            break;
          }
          continue;
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
        if (plan.tool === "search_code") {
          const rawSearch = this.parseSearchDiagnostic(rawResult);
          rawResult = this.decorateToolResult(plan.tool, rawResult, rankQuery);
          const decoratedSearch = this.parseSearchDiagnostic(rawResult);
          if (isApiRejectAsk(query) || isBackendStateLocateAsk(query)) {
            diagnostic?.({
              stage: "search",
              round,
              repoId,
              query: typeof args.query === "string" ? args.query.slice(0, 180) : "",
              source: rawSearch.source,
              stale: rawSearch.stale,
              availability: rawSearch.availability,
              codeHostFallbackAttempted: rawSearch.codeHostFallbackAttempted,
              codeHostFallback: rawSearch.codeHostFallback,
              codeHostFallbackStatus: rawSearch.codeHostFallbackStatus,
              filenameFallbackStatus: rawSearch.filenameFallbackStatus,
              rawHitCount: rawSearch.hits.length,
              rawSymbolCount: rawSearch.symbols.length,
              rawHits: rawSearch.hits.slice(0, 12),
              preferredHits: decoratedSearch.preferredHits.slice(0, 8),
              modelVisibleHits: decoratedSearch.hits.slice(0, 8)
            });
          }
        }
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
        if (isApiRejectAsk(query)) {
          rejectSearchStreak += 1;
          this.recordRejectHitLedger(
            [...hits, ...((parsed.hits as SearchHit[] | undefined) ?? [])],
            query
          );
        }
        // Reject: if the Zoekt snippet already IS the write-reject, attach it now.
        // Live dogfood: 10 searches / 0 reads when body fetch failed or auto-read
        // never opened preferredHits — the index already had the raise line.
        // Multi-hit: also attach a new sibling path while ask job is still unmatched.
        if (
          isApiRejectAsk(query) &&
          (!contextHasVerifiedFieldBehavior(context, query) || wantsMoreRejectSiblings())
        ) {
          const snippetHits = [
            ...this.rejectHitLedger,
            ...hits,
            ...((parsed.hits as SearchHit[] | undefined) ?? [])
          ];
          const attached = await this.attachRejectFromSearchHits(
            repoId,
            snippetHits,
            query,
            emit,
            context,
            conversation,
            new Set(attachedReadPaths(context).map((path) => normalizeHuntPath(path)))
          );
          if (attached.ok) {
            matchingRead = true;
            filesRead += 1;
            lastToolResult = attached.raw;
            rejectSearchStreak = 0;
            if (shouldStopAfterRejectAttach()) {
              break;
            }
            continue;
          }
        }
        // A server serializer hit can be actionable by path even when Zoekt
        // returned only a class/import line. Consume that path now so the
        // model cannot overwrite it with another search first.
        if (isApiRejectAsk(query) && !contextHasVerifiedFieldBehavior(context, query)) {
          const beforeReads = (context.read_file as ReadFilePayload | undefined)?.files?.length ?? 0;
          await this.resolveUnusedRejectEvidence(
            repoId,
            query,
            emit,
            context,
            conversation,
            openedServerWritePaths,
            false
          );
          const afterReads = (context.read_file as ReadFilePayload | undefined)?.files?.length ?? 0;
          if (contextHasVerifiedFieldBehavior(context, query)) {
            matchingRead = true;
            filesRead += Math.max(1, afterReads - beforeReads);
            lastToolResult = JSON.stringify(context.read_file);
            if (shouldStopAfterRejectAttach()) {
              break;
            }
            continue;
          }
        }
        if (!hits.length && !isApiRejectAsk(query) && !isDefinitionLocateAsk(query)) {
          const found = await this.searchUntilReadableHits(
            repoId,
            query,
            emit,
            context,
            triedSearchQueries,
            undefined,
            {
              maxSearches: Math.max(0, maxSteps - steps.length),
              canContinue: () => gatherMayProceed() && steps.length < maxSteps
            }
          );
          if (found) {
            hits = found.toRead;
            lastToolResult = JSON.stringify(context.search_code ?? parsed);
            conversation[conversation.length - 1] = { role: "user", content: lastToolResult };
          }
        }
        // Reject: preferHits emptied by decorate — still try raw hits for auto-read,
        // but never restore error_codes / UI noise (live Fail class).
        if (isApiRejectAsk(query) && !hits.length && Array.isArray(parsed.hits)) {
          hits = parsed.hits.filter(
            (hit) =>
              Boolean(hit.fileName) &&
              !shouldSkipEvidencePath(hit.fileName, query) &&
              (isFailOpenRejectHit(hit, query) || isRejectJumpCandidatePath(hit.fileName))
          );
        }
        const huntingCallers = matchingRead && wantsCallerRead() && !callerRead;
        const roleHints = queryRoleHints(query);
        const autoReadHits =
          huntingCallers
            ? hits
            : isApiRejectAsk(query)
              ? hits.filter((hit) => !shouldSkipEvidencePath(hit.fileName, query))
              : roleHints.length > 0
                ? hits.filter((hit) =>
                    textMentionsQueryRoles(`${hit.fileName}\n${hit.content ?? ""}`, query)
                  )
                : hits;
        if (
          autoReadHits.length > 0 &&
          filesRead < AGENT_MAX_FILES_READ &&
          (!matchingRead || huntingCallers || wantsMoreRejectSiblings())
        ) {
          const skippedAttached = wantsMoreRejectSiblings()
            ? new Set(attachedReadPaths(context).map((path) => normalizeHuntPath(path)))
            : undefined;
          const seeded = await this.readFirstMatchingHit(
            repoId,
            query,
            autoReadHits,
            emit,
            context,
            conversation,
            skippedAttached,
            huntingCallers,
            groundedExport,
            implementationPath,
            diagnostic,
            action === "locate"
          );
          if (seeded.ok) {
            filesRead += 1;
            lastToolResult = seeded.raw;
            rejectSearchStreak = 0;
            if (!matchingRead) {
              matchingRead = true;
              if (!implementationPath && seeded.path) {
                implementationPath = seeded.path;
              }
              if (!groundedExport) {
                const captured = await this.captureGroundedExport(
                  seeded.path ?? "",
                  seeded.raw ?? "",
                  query,
                  repoId,
                  emit,
                  context,
                  conversation
                );
                groundedExport = captured.exportName;
                lastToolResult = captured.raw;
              }
            } else if (huntingCallers) {
              callerRead = true;
            }
            if (
              (queryHasNamedSymbol(query) || isShipCheckQuery(query)) &&
              isFileCallerQuery(query) &&
              !callerRead
            ) {
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
            if (isApiRejectAsk(query) && contextHasVerifiedFieldBehavior(context, query)) {
              if (shouldStopAfterRejectAttach()) {
                break;
              }
              continue;
            }
          }
        }
        // A read is progress even when earlier searches were noisy. Keep the
        // planner alive for the next refinement/read; only a new search should
        // be stopped by the consecutive-search guard.
        if (isApiRejectAsk(query) && rejectSearchStreak >= MAX_REJECT_SEARCH_STREAK && plan.tool === "search_code") {
          break;
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
        // Reject asks: do not resurrect the slogan scavenger via lastChance.
        // Preferred hits + finish jump rail are enough; agent owns further gather.
        const grounded = isApiRejectAsk(query)
          ? await this.lastChancePreferredHitsOnly(
              repoId,
              query,
              emit,
              context,
              conversation
            )
          : await this.lastChanceReadMatchingHit(
              repoId,
              query,
              emit,
              context,
              conversation,
              false,
              triedSearchQueries,
              undefined,
              undefined,
              {
                maxSearches: Math.max(0, maxSteps - steps.length),
                canContinue: () => gatherMayProceed() && steps.length < maxSteps
              }
            );
        if (grounded.ok) {
          matchingRead = true;
          filesRead += 1;
          lastToolResult = grounded.raw;
          if (!implementationPath && grounded.path) {
            implementationPath = grounded.path;
          }
          if (!groundedExport) {
            const captured = await this.captureGroundedExport(
              grounded.path ?? "",
              grounded.raw ?? "",
              query,
              repoId,
              emit,
              context,
              conversation
            );
            groundedExport = captured.exportName;
            lastToolResult = captured.raw;
          }
          if (
            (queryHasNamedSymbol(query) || isShipCheckQuery(query)) &&
            isFileCallerQuery(query) &&
            !callerRead
          ) {
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
          implementationPath,
          {
            maxSearches: Math.max(0, maxSteps - steps.length),
            canContinue: () => gatherMayProceed() && steps.length < maxSteps
          }
        );
        if (caller.ok) {
          filesRead += 1;
          lastToolResult = caller.raw;
          callerRead = true;
        }
      }
      if (isShipCheckQuery(query) && matchingRead && filesRead < AGENT_MAX_FILES_READ) {
        const ripples = await this.readShipCheckRippleHits(
          repoId,
          query,
          emit,
          context,
          conversation,
          groundedExport,
          implementationPath,
          AGENT_MAX_FILES_READ - filesRead
        );
        filesRead += ripples.filesRead;
        if (ripples.callerRead) {
          callerRead = true;
        }
        if (ripples.lastRaw) {
          lastToolResult = ripples.lastRaw;
        }
      }
    }

    if (wantsCallerRead() && matchingRead && !callerRead) {
      conversation.push({
        role: "user",
        content: isShipCheckQuery(query)
          ? "You did not read a sibling file that writes the same unauthorized response. Do not list path-only search hits. Say you could not open other call sites."
          : "You did not read a file that imports or calls the export. Answer from the implementation you read. Do not invent a caller path. Say callers were not found in the index."
      });
    }

    // Right file, wrong floor: never emit reject-miss while a preferred
    // serializer/server-write path was opened (or preferred) without a jump.
    if (
      isApiRejectAsk(query) &&
      action !== "change" &&
      !contextHasVerifiedFieldBehavior(context, query)
    ) {
      await this.resolveUnusedRejectEvidence(
        repoId,
        query,
        emit,
        context,
        conversation,
        openedServerWritePaths,
        false
      );
      if (contextHasVerifiedFieldBehavior(context, query)) {
        matchingRead = true;
      }
    }

    return this.finishWithAnswer(
      { steps, context },
      query,
      repoId,
      action,
      options,
      conversation,
      matchingRead,
      openedServerWritePaths
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
    matchingRead = false,
    openedServerWritePaths: Set<string> = new Set()
  ): Promise<AgentSessionResult> {
    if (options.signal?.aborted) return { ...result, answer: undefined };
    if (options.repoFacts) {
      const facts = await options.repoFacts;
      if (options.signal?.aborted) return { ...result, answer: undefined };
      if (facts) result.context = { ...result.context, repoFacts: facts };
    }
    const directFileAnswer = options.allowedRepoTools !== false && Boolean(result.context?.requestedFiles?.length) &&
      action !== "change" && isDirectRepoFileQuestion(query) &&
      !(options.allowedIntegrations?.length || options.fillIntegrations?.length);
    const requestedFiles = result.context?.requestedFiles;
    // Specialized hunt compaction must not drop independent named-file jobs.
    const requiredReads = ((result.context?.read_file as ReadFilePayload | undefined)?.files ?? [])
      .filter((file) => file.evidenceSource === "remote-read" && requestedFiles?.some((ref) => ref.path === file.path));
    const hasRequestedFiles = (requestedFiles?.length ?? 0) > 0;
    for (const requested of requestedFiles ?? []) {
      if (requested.status === "ambiguous") continue;
      const read = ((result.context?.read_file as ReadFilePayload | undefined)?.files ?? [])
        .find((file) => file.path === requested.path && file.content?.trim() && file.evidenceSource === "remote-read");
      if (read) {
        requested.status = "read";
        requested.reason = read.truncated ? "Partial body; omitted content remains unverified." : undefined;
      }
    }
    const requiresWriteSiteAndReject =
      requiresStateWriteAndReject(query, options.intentBrief);
    const hasRequiredRejectEvidence = (): boolean =>
      contextHasVerifiedFieldBehavior(result.context, query) &&
      (!requiresWriteSiteAndReject || (contextHasWriteReject(result.context, query) && contextHasStateWriteSite(result.context)));
    if (requiresWriteSiteAndReject && contextHasWriteReject(result.context, query) && !contextHasStateWriteSite(result.context)) {
      const files = remoteReadEvidenceFiles((result.context?.read_file as ReadFilePayload | undefined)?.files);
      for (const file of files) {
        if (!file.path || !contentLooksLikeAskedFieldReject(stripReadLinePrefixes(file.content ?? ""), query, file.path)) continue;
        // The opened guard already fetched this entire remote file into the
        // turn cache. Retain its same-class update implementation without
        // spending another planning round on a truncated window.
        const remote = await this.ctx.readRemoteFile?.({ path: file.path, repoId });
        const window = remote?.content && sameClassSerializerUpdateWindow(remote.content, stripReadLinePrefixes(file.content ?? ""), query);
        if (!window) continue;
        const raw = JSON.stringify({ path: file.path, files: [{ path: file.path,
          content: numberReadLines(window.content, window.startLine), evidenceSource: "remote-read" }] });
        this.replaceReadFileAttach(result.context!, conversation, file.path, raw, window);
        const step: AgentStep = { index: result.steps.length, tool: "read_file", completed: true,
          summary: `read_file verified update from opened remote body: ${file.path}:${window.startLine}-${window.endLine}` };
        result.steps.push(step);
        options.onStep?.(step, [...result.steps]);
        break;
      }
    }
    if (isApiRejectAsk(query)) {
      // Miss forbidden while unused reject evidence remains — attach / jump first.
      if (!contextHasVerifiedFieldBehavior(result.context, query) && action !== "change") {
        const emit: (step: AgentStep) => void = (step) => {
          result.steps.push({ ...step, index: result.steps.length });
          options.onStep?.(step, [...result.steps]);
        };
        const ctx = (result.context ?? {}) as AgentSessionContext;
        result.context = ctx;
        await this.resolveUnusedRejectEvidence(
          repoId,
          query,
          emit,
          ctx,
          conversation,
          openedServerWritePaths,
          typeof options.planTurn !== "function"
        );
      }
      if (!requiresWriteSiteAndReject) {
        pruneContextToWriteReject(result.context, query);
      }
      conversation = compactApiRejectConversation(query, result.context);
      conversation.push({ role: "user", content: "Explain only the checks and persistence/delegation shown in attached source. If the complete attached method filters the submitted field instead of raising the assumed error, correct that premise and describe the shown filter; do not claim that no other validation can fail or that no rejection exists elsewhere. Distinguish the observed validation from any policy the question assumes but the source does not establish. Copy any code excerpt verbatim with its attached line numbers; do not invent an equivalent implementation." });
      const files = (result.context?.read_file as ReadFilePayload | undefined)?.files ?? [];
      if (!hasRequiredRejectEvidence()) {
        matchingRead = false;
        if (action !== "change" && !hasRequestedFiles) {
          const answer = requiresWriteSiteAndReject && contextHasWriteReject(result.context, query) && !contextHasStateWriteSite(result.context)
            ? "I found the server-side state rejection, but not the state write/update site, so I can’t answer both parts from attached evidence."
            : requiresWriteSiteAndReject && contextHasVerifiedFieldBehavior(result.context, query)
              ? "I found source-backed field handling, but it does not establish the claimed rejection, so I can’t answer both parts from the attached evidence."
              : apiRejectHuntMiss(result.steps);
          return {
            ...result,
            answer,
            context: result.steps.length ? result.context : undefined
          };
        }
      } else {
        matchingRead = true;
        if (!hasRequestedFiles && action === "locate" && requiresWriteSiteAndReject && !this.contextHasIntegrationHits(result.context)) {
          for (const file of remoteReadEvidenceFiles(files)) {
            if (!file.path || !contentLooksLikeAskedFieldReject(file.content ?? "", query, file.path)) continue;
            const remote = await this.ctx.readRemoteFile?.({ path: file.path, repoId });
            if (!remote?.content) continue;
            const guard = completePythonRejectWindow(remote.content, query, file.path);
            const update = guard && sameClassSerializerUpdateWindow(remote.content, guard.content, query);
            if (!guard || !update) continue;
            const cite = (window: { content: string; startLine: number; endLine: number }): string =>
              `\`\`\`python ${file.path}:${window.startLine}-${window.endLine}\n${window.content}\n\`\`\``;
            return { ...result, answer: `The opened serializer rejects the submitted state in this guard:\n\n${cite(guard)}\n\nAccepted updates delegate to \`super().update(instance, validated_data)\` in the same class:\n\n${cite(update)}\n\nThis establishes the shown validation and update delegation. A policy for the specific transition described remains unverified.`, context: result.context };
          }
        }
        if (!hasRequestedFiles && action === "locate" && !requiresWriteSiteAndReject && !contextHasWriteReject(result.context, query) && !this.contextHasIntegrationHits(result.context)) {
          for (const file of files) {
            const source = { path: file.path, content: file.content, evidenceSource: file.evidenceSource };
            const handling = verifiedFieldHandlingEvidence(source, query);
            if (handling) {
              return { ...result, answer: formatVerifiedFieldHandlingAnswer(source, handling), context: result.context };
            }
          }
        }
      }
    }
    if (isCompoundAuthAndStateLocateAsk(query)) {
      matchingRead =
        contextHasRequestAuthEnforcement(result.context) &&
        contextHasBackendStateDefinition(result.context);
    }
    if (isCreateLocateAsk(query)) {
      matchingRead = contextHasCreateDefinition(result.context);
    }
    if (
      (isBackendStateLocateAsk(query) || isParserLocateAsk(query)) &&
      !contextHasGroundedLocateRead(result.context, query) && !hasRequestedFiles
    ) {
      return {
        ...result,
        answer: INDEX_HUNT_MISS,
        context: result.steps.length ? result.context : undefined
      };
    }
    const history = directFileAnswer ? [{ role: "user" as const, content: query }] : action === "locate" && !isShipCheckQuery(query) && !this.contextHasIntegrationHits(result.context)
      ? [...compactApiRejectConversation(query, result.context), { role: "user" as const,
          content: "Answer only from the opened remote source above. Search snippets and planning guesses are discovery leads, not source evidence. Cite only opened paths and copy code verbatim with its attached line numbers." }]
      :
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
    if (needsGrounding && !matchingRead && !hasIntegrationHits && !requestedFiles?.length) {
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
      !readFileContextHasBody(result.context) && !requestedFiles?.length
    ) {
      return {
        ...result,
        answer: INDEX_HUNT_MISS,
        context: result.steps.length ? result.context : undefined
      };
    }
    if (requiredReads.length) {
      const payload = result.context?.read_file as ReadFilePayload | undefined;
      result.context!.read_file = { ...payload, files: [
        ...(payload?.files ?? []).filter((file) => !requiredReads.some((required) => required.path === file.path)),
        ...requiredReads
      ] };
    }
    if (!options.streamAnswer) {
      return { ...result, context: result.steps.length || requestedFiles?.length ? result.context : undefined };
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
        interpretNotes = await gatherRequest(this.ctx, "integration-interpret", () => options.interpretOpens!(artifacts), undefined);
      }
      const historyForAnswer = filledHistory ?? history;
      if (requestedFiles?.length) {
        if (isApiRejectAsk(query) && !hasRequiredRejectEvidence()) {
          historyForAnswer.push({ role: "user", content: "The API-rejection part is unverified. Say that plainly; do not invent a rejection, guard, or transition policy. Still answer the independently supported named-file parts from their bodies below." });
        }
        if (requiredReads.length) {
          historyForAnswer.push({ role: "user", content: JSON.stringify({ files: requiredReads }) });
        }
        // Put every independently resolved outcome after summarized history.
        historyForAnswer.push({ role: "user", content: JSON.stringify({ requestedFiles }) });
        if (!directFileAnswer) historyForAnswer.push({ role: "user", content: formatRequestedFileOutcomes(requestedFiles) });
        options.onDiagnostic?.({ stage: "requested-file-synthesis", requestedFiles });
      }
      if (
        historyForAnswer &&
        ((isCreateLocateAsk(query) && contextHasCreateDefinition(result.context)) ||
          (isCompoundAuthAndStateLocateAsk(query) &&
            contextHasRequestAuthEnforcement(result.context) &&
            contextHasBackendStateDefinition(result.context)))
      ) {
        historyForAnswer.push({
          role: "user",
          content:
            "Cite the attached create / auth / state definition evidence. Do not ask the user to open a path you already read."
        });
      }
      options.onDiagnostic?.({ stage: "synthesis-start" });
      const answer = await options.streamAnswer({
        message: query,
        repoId,
        conversation: historyForAnswer,
        action,
        openedEvidence: formatOpenedIntegrationEvidence(result.context),
        interpretNotes,
        attachedFiles: directFileAnswer ? undefined : options.capturedAttachment?.files.filter((file) => !requestedFiles?.some((ref) => ref.path === file.path)),
        projectInstructions: options.projectInstructions,
        requestedFiles,
        repoFacts: result.context?.repoFacts,
        directFileAnswer
      });
      const cleaned =
        isCreateLocateAsk(query) || isCompoundAuthAndStateLocateAsk(query)
          ? stripPleaseOpenAttachedPaths(answer, attachedReadPaths(result.context))
          : answer;
      return {
        ...result,
        answer: cleaned,
        context: result.steps.length || requestedFiles?.length ? result.context : undefined
      };
    } catch {
      return { ...result, context: result.steps.length || requestedFiles?.length ? result.context : undefined };
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
    if (
      !filePath ||
      !(isFeatureAddAsk(query) || (isShipCheckQuery(query) && !queryHasNamedSymbol(query)))
    ) {
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
    const named = requestedRepoFiles(query);
    if (!named.length) {
      return { ok: false };
    }
    const outcomes: RequestedRepoFile[] = [];
    let lastRaw: string | undefined;
    for (const [index, ref] of named.entries()) {
      if (this.runSignal?.aborted) break;
      const outcome: RequestedRepoFile = { requestedPath: ref.requestedPath,
        repoId, branch: this.ctx.repoTarget?.branch, status: "unavailable" };
      outcomes.push(outcome);
      if (index >= AGENT_MAX_FILES_READ) {
        outcome.reason = "Read limit reached; body unverified.";
        continue;
      }
      let filePath = ref.requestedPath;
      if (!ref.exact) {
        const found = (await this.ctx.findFiles?.({ query: ref.requestedPath, repoId }).catch(() => [])) ?? [];
        if (this.runSignal?.aborted) break;
        const exact = [...new Set(found.map(normalizeRequestedPath))]
          .filter((path) => path.split("/").pop() === ref.requestedPath);
        if (exact.length > 1) {
          outcome.status = "ambiguous";
          outcome.candidates = exact;
          continue;
        }
        // A missing discovery result is not proof of absence: try the root path.
        filePath = exact[0] ?? filePath;
      }
      outcome.path = filePath;
      try {
        const captured = ((context.read_file as ReadFilePayload | undefined)?.files ?? [])
          .find((file) => normalizeRequestedPath(file.path) === filePath && file.content?.trim() &&
            file.evidenceSource === "remote-read");
        const rawResult = captured
          ? JSON.stringify({ path: filePath, files: [captured] })
          : await this.executeTool("read_file", { path: filePath, repoId });
        if (this.runSignal?.aborted) break;
        if (!readFilePayloadHasBody(rawResult)) {
          outcome.reason = "Remote body unavailable; absence is not established.";
          continue;
        }
        outcome.status = "read";
        lastRaw = rawResult;
        const previous = context.read_file as ReadFilePayload | undefined;
        if (previous?.files) previous.files = previous.files.filter((file) => normalizeRequestedPath(file.path) !== filePath);
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
      } catch {
        outcome.reason = "Remote read failed; body unverified.";
      }
    }
    if (this.runSignal?.aborted) return { ok: false };
    context.requestedFiles = outcomes;
    conversation?.push({ role: "user", content: JSON.stringify({ requestedFiles: outcomes }) });
    this.ctx.onDiagnostic?.({ stage: "requested-files-resolved", requestedFiles: outcomes });
    return { ok: Boolean(lastRaw), raw: lastRaw };
  }

  private async captureGroundedExport(
    path: string,
    raw: string,
    query: string,
    repoId: string,
    emit: (step: AgentStep) => void,
    context: AgentSessionContext,
    conversation?: AgentConversationMessage[]
  ): Promise<{ exportName?: string; raw: string }> {
    if (queryHasNamedSymbol(query)) {
      return { exportName: extractAgentSearchQuery(query), raw };
    }
    if (!path.trim()) {
      return { raw };
    }
    let bodyRaw = raw;
    const full = await this.retryReadWithoutWindow({ path, repoId }, repoId, query);
    if (full?.raw) {
      bodyRaw = full.raw;
    }
    const exportName = pickGroundedExport(
      path,
      stripReadLinePrefixes(readFileBodies(bodyRaw)),
      query
    );
    if (exportName && full?.raw) {
      const line = lineNumberOfGroundedExport(
        path,
        stripReadLinePrefixes(readFileBodies(full.raw)),
        exportName
      );
      if (line) {
        const jumped = await this.readWindowAroundLine(repoId, path, line);
        if (jumped) {
          this.replaceReadFileAttach(context, conversation, path, jumped.raw, {
            startLine: jumped.startLine,
            endLine: jumped.endLine
          });
          emit({
            index: 0,
            tool: "read_file",
            summary: `read_file: ${path}`,
            completed: true
          });
          return { exportName, raw: jumped.raw };
        }
      }
    }
    return { exportName, raw };
  }

  private judgeReadResult(
    raw: string,
    query: string,
    args: Record<string, unknown>
  ): { raw: string; matchesSymbol: boolean } {
    const needsNamed = queryHasNamedSymbol(query);
    const needsRole = queryRoleHints(query).length > 0;
    if (!needsNamed && !needsRole && !isParserLocateAsk(query)) {
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
    const named = await this.seedNamedFileReads(repoId, query, emit, context);
    if (named.ok || context.requestedFiles?.length) {
      return this.finishWithAnswer({ steps, context }, query, repoId, "understand", options ?? {}, undefined, named.ok);
    }
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

    // Fail-open reject path when planTurn is missing: small seed, not 12 slogans.
    if (isApiRejectAsk(query)) {
      const hunted = await this.huntWriteReject(repoId, query, emit, context);
      if (hunted) {
        return { steps, context };
      }
      return { steps, context };
    }

    const found = await this.searchUntilReadableHits(repoId, query, emit, context, new Set(), undefined, {
      maxSearches: Math.max(0, maxSteps - steps.length),
      canContinue: () => steps.length < maxSteps
    });
    if (!found || steps.length >= maxSteps) {
      return { steps, context };
    }

    const opened = await this.readFirstMatchingHit(repoId, query, found.toRead, emit, context, undefined, undefined, false, undefined, undefined, undefined, true);
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
    implementationPath?: string,
    diagnostic?: AgentRunOptions["onDiagnostic"],
    strictLocate = false
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
      let { startLine, endLine } = readLineWindow(hit.lineNumber);
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
      const groundingOk = locateReadCountsAsGrounding({ path: hit.fileName, body, query }, { requireImplementation: strictLocate });
      const callerOk =
        preferCallerHits && shipCheckRippleBody(body, query, groundedExport);
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
        diagnostic?.({
          stage: "candidate-read",
          repoId,
          path: hit.fileName,
          line: hit.lineNumber,
          result: "empty-body",
          windowStart: startLine,
          windowEnd: endLine
        });
        // Retain the snippet for an honest explanation, but keep looking for a
        // remotely readable sibling; the snippet cannot satisfy the evidence gate.
        if (
          isApiRejectAsk(query) &&
          hit.content &&
          contentLooksLikeAskedFieldReject(hit.content, query, hit.fileName)
        ) {
          const attached = this.attachRejectSnippetPayload(
            hit.fileName,
            hit.content,
            hit.lineNumber,
            query,
            emit,
            context,
            conversation
          );
          if (attached.ok) {
            skippedPaths?.add(pathKey);
          }
        }
        emit({
          index: 0,
          tool: "read_file",
          summary: `read_file failed (empty body): ${hit.fileName}`,
          completed: true
        });
        continue;
      }
      // Field-behavior hunts verify the full remote method before locate-only gates.
      // A filtering implementation need not contain rejection keywords.
      if (isApiRejectAsk(query)) {
        const verifiedField = await this.readWriteRejectInSameFile(repoId, hit.fileName, query, emit, context, conversation);
        if (verifiedField.ok) return verifiedField;
      }
      const verdict = classifyLocateRead({ path: hit.fileName, body, query }, { requireImplementation: strictLocate });
      if (isDefinitionLocateAsk(query) || isApiRejectAsk(query)) {
        diagnostic?.({
          stage: "candidate-read",
          repoId,
          path: hit.fileName,
          line: hit.lineNumber,
          result: verdict,
          bodyLines: body.split(/\r?\n/).length,
          bodyChars: body.length,
          rejectMatch: isApiRejectAsk(query)
            ? contentLooksLikeAskedFieldReject(body, query, hit.fileName)
            : undefined,
          windowStart: startLine,
          windowEnd: endLine
        });
      }
      if (preferCallerHits && !shipCheckRippleBody(body, query, groundedExport)) {
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
      if (!preferCallerHits && !locateReadCountsAsGrounding({ path: hit.fileName, body, query }, { requireImplementation: strictLocate })) {
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
        if (!contentLooksLikeAskedFieldReject(body, query, hit.fileName)) {
          // Wrong-body / wrong-floor: hit snippet may already be the reject.
          if (
            hit.content &&
            contentLooksLikeAskedFieldReject(hit.content, query, hit.fileName)
          ) {
            const attached = this.attachRejectSnippetPayload(
              hit.fileName,
              hit.content,
              hit.lineNumber,
              query,
              emit,
              context,
              conversation
            );
            if (attached.ok) {
              return attached;
            }
          }
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
      if (isCreateLocateAsk(query)) {
        const createJump = await this.loadCreateHandlerWindow(repoId, hit.fileName);
        if (createJump) {
          readRaw = createJump.raw;
          usedWindow = true;
          startLine = createJump.startLine;
          endLine = createJump.endLine;
          body = readBodiesUnprefixed(JSON.parse(readRaw) as ReadFilePayload);
        } else if (!contentLooksLikeCreateHandler(body) && !isCreateDefinitionHit({ fileName: hit.fileName, content: body })) {
          skippedPaths?.add(pathKey);
          emit({
            index: 0,
            tool: "read_file",
            summary: `read_file skipped (no create handler): ${hit.fileName}`,
            completed: true
          });
          continue;
        }
      }
      if (isShipCheckQuery(query)) {
        const unauthAttach = await this.jumpUnauthorizedAttachIfNeeded(
          repoId,
          hit.fileName,
          readRaw,
          usedWindow
        );
        if (unauthAttach) {
          readRaw = unauthAttach.raw;
          usedWindow = true;
          startLine = unauthAttach.startLine;
          endLine = unauthAttach.endLine;
        }
      } else if (preferCallerHits) {
        const callerAttach = await this.jumpCallerAttachIfNeeded(
          repoId,
          hit.fileName,
          query,
          groundedExport,
          readRaw,
          usedWindow
        );
        if (callerAttach) {
          readRaw = callerAttach.raw;
          usedWindow = true;
          startLine = callerAttach.startLine;
          endLine = callerAttach.endLine;
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

  private parseSearchDiagnostic(raw: string): {
    source?: string;
    stale?: boolean;
    availability?: string;
    codeHostFallbackAttempted?: boolean;
    codeHostFallback?: boolean;
    codeHostFallbackStatus?: string;
    filenameFallbackStatus?: string;
    hits: Array<{ path: string; line: number; score?: number }>;
    preferredHits: Array<{ path: string; line: number; score?: number }>;
    symbols: Array<{ path: string; line: number; symbol?: string }>;
  } {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const summarizeHits = (value: unknown) =>
        (Array.isArray(value) ? value : [])
          .flatMap((item) => {
            if (!item || typeof item !== "object") return [];
            const hit = item as Record<string, unknown>;
            const path = typeof hit.fileName === "string" ? hit.fileName : "";
            if (!path) return [];
            return [{
              path,
              line: Number.isInteger(hit.lineNumber) ? Number(hit.lineNumber) : 0,
              ...(typeof hit.score === "number" ? { score: hit.score } : {})
            }];
          });
      const symbols = (Array.isArray(parsed.symbols) ? parsed.symbols : [])
        .flatMap((item) => {
          if (!item || typeof item !== "object") return [];
          const symbol = item as Record<string, unknown>;
          const path = typeof symbol.file === "string" ? symbol.file : "";
          if (!path) return [];
          return [{
            path,
            line: Number.isInteger(symbol.line) ? Number(symbol.line) : 0,
            ...(typeof symbol.symbol === "string" ? { symbol: symbol.symbol } : {})
          }];
        });
      return {
        source: typeof parsed.source === "string" ? parsed.source : undefined,
        stale: typeof parsed.stale === "boolean" ? parsed.stale : undefined,
        availability: typeof parsed.availability === "string" ? parsed.availability : undefined,
        codeHostFallbackAttempted:
          typeof parsed.codeHostFallbackAttempted === "boolean"
            ? parsed.codeHostFallbackAttempted
            : undefined,
        codeHostFallback:
          typeof parsed.codeHostFallback === "boolean" ? parsed.codeHostFallback : undefined,
        codeHostFallbackStatus:
          typeof parsed.codeHostFallbackStatus === "string"
            ? parsed.codeHostFallbackStatus
            : undefined,
        hits: summarizeHits(parsed.hits),
        filenameFallbackStatus: typeof parsed.filenameFallbackStatus === "string" ? parsed.filenameFallbackStatus : undefined,
        preferredHits: summarizeHits(parsed.preferredHits),
        symbols
      };
    } catch {
      return { hits: [], preferredHits: [], symbols: [] };
    }
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
  /**
   * Reject fail-open: open preferred hits already in context — no new slogan
   * search parade (that was the script brain).
   */
  private async lastChancePreferredHitsOnly(
    repoId: string,
    query: string,
    emit: (step: AgentStep) => void,
    context: AgentSessionContext,
    conversation?: AgentConversationMessage[]
  ): Promise<{ ok: boolean; raw?: string; path?: string }> {
    const parsed = context.search_code as (SearchPayload & { preferredHits?: SearchHit[] }) | undefined;
    const preferred = parsed?.preferredHits ?? [];
    const rawHits = (parsed?.hits as SearchHit[] | undefined) ?? [];
    const allHits = [...this.rejectHitLedger, ...preferred, ...rawHits];
    if (isApiRejectAsk(query) && !contextHasVerifiedFieldBehavior(context, query)) {
      const attached = await this.attachRejectFromSearchHits(repoId, allHits, query, emit, context, conversation);
      if (attached.ok) {
        return attached;
      }
    }
    let hits = preferred.filter((hit) => Boolean(hit.fileName));
    if (!hits.length && isApiRejectAsk(query)) {
      hits = allHits.filter((hit) => hit.fileName && isFailOpenRejectHit(hit, query));
    }
    if (!hits.length) {
      return { ok: false };
    }
    return this.readFirstMatchingHit(repoId, query, hits, emit, context, conversation);
  }

  private async lastChanceReadMatchingHit(
    repoId: string,
    query: string,
    emit: (step: AgentStep) => void,
    context: AgentSessionContext,
    conversation?: AgentConversationMessage[],
    preferCallerHits = false,
    skipQueries: Set<string> = new Set(),
    groundedExport?: string,
    implementationPath?: string,
    searchBudget?: SearchBudget
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
      callerQueries,
      searchBudget
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
   * Create locate: index often lands on class IssueViewSet while create() is
   * further down. Jump the attached window to create / perform_create.
   */
  private async loadCreateHandlerWindow(
    repoId: string,
    filePath: string
  ): Promise<{ raw: string; startLine: number; endLine: number } | undefined> {
    const fullRaw = await this.executeTool("read_file", { path: filePath, repoId });
    if (!readFilePayloadHasBody(fullRaw)) {
      return undefined;
    }
    const parsed = JSON.parse(fullRaw) as ReadFilePayload;
    const body = (parsed.files ?? []).map((file) => file.content).join("\n");
    const line = lineNumberOfCreateHandler(body);
    if (!line) {
      return undefined;
    }
    const jumped = await this.readWindowAroundLine(repoId, filePath, line);
    if (!jumped) {
      return undefined;
    }
    const windowBody = (JSON.parse(jumped.raw) as ReadFilePayload).files
      ?.map((file) => file.content)
      .join("\n");
    if (
      !windowBody ||
      (!contentLooksLikeCreateHandler(windowBody) &&
        !isCreateDefinitionHit({ fileName: filePath, content: windowBody }))
    ) {
      return undefined;
    }
    return jumped;
  }

  /**
   * C2: the index hit is often a read-only serializer class in the same file as
   * `validate()` / ValidationError. Open the file and jump to that line.
   * Right-file-wrong-floor: if the asked-field reject exists anywhere in the
   * body, always jump before abandoning the path.
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
    let line = lineNumberOfWriteReject(body, query, filePath);
    if (!line && contentLooksLikeAskedFieldReject(body, query, filePath)) {
      line = lineNumberOfAnyWriteReject(body);
    }
    if (!line) {
      const handling = (parsed.files ?? []).map((file) => verifiedFieldHandlingEvidence({
        path: file.path ?? filePath, content: file.content ?? "", evidenceSource: file.evidenceSource
      }, query)).find(Boolean);
      if (!handling) return undefined;
      const raw = await this.executeTool("read_file", {
        path: filePath, repoId, startLine: handling.startLine, endLine: handling.endLine
      });
      const files = (JSON.parse(raw) as ReadFilePayload).files ?? [];
      if (!files.some((file) => verifiedFieldHandlingEvidence({ path: file.path ?? filePath,
        content: file.content ?? "", evidenceSource: file.evidenceSource }, query))) return undefined;
      return { raw, startLine: handling.startLine, endLine: handling.endLine };
    }
    let jumped = await this.readWindowAroundLine(repoId, filePath, line);
    if (!jumped) {
      return undefined;
    }
    let windowBody = (JSON.parse(jumped.raw) as ReadFilePayload).files
      ?.map((file) => file.content)
      .join("\n");
    if (!windowBody || !contentLooksLikeAskedFieldReject(windowBody, query, filePath)) {
      // Narrow window missed the field tokens — widen once around the same line.
      const wideStart = Math.max(1, line - READ_LINE_PADDING * 2);
      const wideEnd = line + READ_LINE_PADDING * 2;
      try {
        const wideRaw = await this.executeTool("read_file", {
          path: filePath,
          repoId,
          startLine: wideStart,
          endLine: wideEnd
        });
        if (readFilePayloadHasBody(wideRaw)) {
          windowBody = (JSON.parse(wideRaw) as ReadFilePayload).files
            ?.map((file) => file.content)
            .join("\n");
          if (windowBody && contentLooksLikeAskedFieldReject(windowBody, query, filePath)) {
            return { raw: wideRaw, startLine: wideStart, endLine: wideEnd };
          }
        }
      } catch {
        /* fall through */
      }
      // Full body already proven — attach it rather than miss after opening the right file.
      if (contentLooksLikeAskedFieldReject(body, query, filePath)) {
        return {
          raw: fullRaw,
          startLine: 1,
          endLine: Math.max(1, body.split("\n").length)
        };
      }
      return undefined;
    }
    return jumped;
  }

  /**
   * Window around a known line. Picking may use a full body locally; this is
   * the snippet the writer sees.
   */
  private async readWindowAroundLine(
    repoId: string,
    filePath: string,
    line: number
  ): Promise<{ raw: string; startLine: number; endLine: number } | undefined> {
    if (!Number.isInteger(line) || line < 1) {
      return undefined;
    }
    const { startLine, endLine } = readLineWindow(line);
    try {
      const windowRaw = await this.executeTool("read_file", {
        path: filePath,
        repoId,
        startLine,
        endLine
      });
      if (!readFilePayloadHasBody(windowRaw)) {
        return undefined;
      }
      return { raw: windowRaw, startLine, endLine };
    } catch {
      return undefined;
    }
  }

  /**
   * Ship-check: keep the unauthorized/401 write in the attached window so the
   * writer history clip still has the shape, not just the file head.
   */
  private async jumpUnauthorizedAttachIfNeeded(
    repoId: string,
    filePath: string,
    readRaw: string,
    usedWindow: boolean
  ): Promise<{ raw: string; startLine: number; endLine: number } | undefined> {
    const useBody = stripReadLinePrefixes(readFileBodies(readRaw));
    if (usedWindow && contentLooksLikeUnauthorizedWrite(useBody)) {
      return undefined;
    }
    const line = lineNumberOfUnauthorizedWrite(useBody);
    if (!line) {
      return undefined;
    }
    const jumped = await this.readWindowAroundLine(repoId, filePath, line);
    if (!jumped) {
      return undefined;
    }
    const jumpedBody = stripReadLinePrefixes(readFileBodies(jumped.raw));
    if (!contentLooksLikeUnauthorizedWrite(jumpedBody)) {
      return undefined;
    }
    return jumped;
  }

  /**
   * After the definition is grounded, open remaining 401/unauthorized sibling
   * hits (and tests) so the writer can name confirmed ripples.
   */
  private async readShipCheckRippleHits(
    repoId: string,
    query: string,
    emit: (step: AgentStep) => void,
    context: AgentSessionContext,
    conversation: AgentConversationMessage[] | undefined,
    groundedExport: string | undefined,
    implementationPath: string | undefined,
    remainingReads: number
  ): Promise<{ filesRead: number; callerRead: boolean; lastRaw?: string }> {
    const cap = Math.min(SHIP_CHECK_MAX_RIPPLE_READS, Math.max(0, remainingReads));
    if (cap <= 0) {
      return { filesRead: 0, callerRead: false };
    }
    const parsed = context.search_code as (SearchPayload & { preferredHits?: SearchHit[] }) | undefined;
    let hits = [...(parsed?.preferredHits ?? parsed?.hits ?? [])];
    if (!hits.some((hit) => contentLooksLikeUnauthorizedWrite(hit.content ?? ""))) {
      try {
        const extra = await this.executeTool("search_code", {
          repoId,
          query: "unauthorized"
        });
        const decorated = this.decorateToolResult("search_code", extra, query);
        this.mergeContext(context, "search_code", decorated);
        conversation?.push({
          role: "assistant",
          content: JSON.stringify({ tool: "search_code", args: { query: "unauthorized" } })
        });
        conversation?.push({ role: "user", content: decorated });
        emit({
          index: 0,
          tool: "search_code",
          summary: "search_code: unauthorized",
          completed: true
        });
        const extraParsed = JSON.parse(decorated) as SearchPayload & { preferredHits?: SearchHit[] };
        hits = [...hits, ...(extraParsed.preferredHits ?? extraParsed.hits ?? [])];
      } catch {
        // Index miss — still try existing hits.
      }
    }
    const skippedPaths = new Set<string>();
    for (const file of (context.read_file as ReadFilePayload | undefined)?.files ?? []) {
      if (file.path) {
        skippedPaths.add(normalizeHuntPath(file.path));
      }
    }
    if (implementationPath) {
      skippedPaths.add(normalizeHuntPath(implementationPath));
    }
    let filesRead = 0;
    let callerRead = false;
    let lastRaw: string | undefined;
    const seen = new Set<string>();
    for (const hit of hits) {
      if (filesRead >= cap) {
        break;
      }
      const key = normalizeHuntPath(hit.fileName ?? "");
      if (!key || seen.has(key) || skippedPaths.has(key)) {
        continue;
      }
      seen.add(key);
      const opened = await this.readFirstMatchingHit(
        repoId,
        query,
        [hit],
        emit,
        context,
        conversation,
        skippedPaths,
        true,
        groundedExport,
        implementationPath
      );
      if (!opened.ok) {
        continue;
      }
      filesRead += 1;
      lastRaw = opened.raw;
      const body = stripReadLinePrefixes(readFileBodies(opened.raw ?? ""));
      if (shipCheckRippleBody(body, query, groundedExport)) {
        callerRead = true;
      }
    }
    return { filesRead, callerRead, lastRaw };
  }

  /**
   * Caller hunt: if the attach is the whole file or misses the use, jump to
   * the import/call. Keep skip-definition / mention filters at the caller.
   */
  private async jumpCallerAttachIfNeeded(
    repoId: string,
    filePath: string,
    query: string,
    groundedExport: string | undefined,
    readRaw: string,
    usedWindow: boolean
  ): Promise<{ raw: string; startLine: number; endLine: number } | undefined> {
    const useBody = stripReadLinePrefixes(readFileBodies(readRaw));
    if (usedWindow && readBodyHasCallerUse(useBody, query, groundedExport)) {
      return undefined;
    }
    const useLine = lineNumberOfCallerUse(useBody, query, groundedExport);
    if (!useLine) {
      return undefined;
    }
    const jumped = await this.readWindowAroundLine(repoId, filePath, useLine);
    if (!jumped) {
      return undefined;
    }
    const jumpedBody = stripReadLinePrefixes(readFileBodies(jumped.raw));
    if (!readBodyHasCallerUse(jumpedBody, query, groundedExport)) {
      return undefined;
    }
    return jumped;
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
      summary: `read_file: ${filePath} (field validation)`,
      completed: true
    });
    return { ok: true, raw: jumped.raw };
  }

  /**
   * Miss-forbidden contract: resolve unused snippet attach or jump before canned miss.
   * Live Fail: wrong opens (__init__.py / urls) must not burn the jump loop and
   * skip ask-derived invent — invent always runs if still no write-reject.
   */
  private async resolveUnusedRejectEvidence(
    repoId: string,
    query: string,
    emit: (step: AgentStep) => void,
    context: AgentSessionContext,
    conversation: AgentConversationMessage[] | undefined,
    openedServerWritePaths: Set<string>,
    allowLastChanceSearch = true
  ): Promise<void> {
    const dropJumpPath = (path: string): void => {
      const key = normalizeHuntPath(path);
      openedServerWritePaths.delete(key);
      this.rejectJumpPathLedger.delete(key);
    };

    for (let guard = 0; guard < 6; guard++) {
      if (contextHasVerifiedFieldBehavior(context, query)) {
        return;
      }
      const unused = this.unusedRejectEvidence(context, query, openedServerWritePaths);
      if (!unused) {
        break;
      }
      if (unused.kind === "jump" && shouldSkipEvidencePath(unused.path, query)) {
        dropJumpPath(unused.path);
        continue;
      }
      if (unused.kind === "snippet") {
        const attached = this.attachRejectSnippetPayload(
          unused.path,
          unused.content,
          unused.lineNumber,
          query,
          emit,
          context,
          conversation
        );
        if (attached.ok) {
          return;
        }
        this.rejectHitLedger = this.rejectHitLedger.filter(
          (entry) =>
            !(
              normalizeHuntPath(entry.fileName) === normalizeHuntPath(unused.path) &&
              entry.content === unused.content
            )
        );
        continue;
      }
      const jumped = await this.readWriteRejectInSameFile(
        repoId,
        unused.path,
        query,
        emit,
        context,
        conversation
      );
      if (jumped.ok) {
        return;
      }
      dropJumpPath(unused.path);
    }

    // Finish is an evidence rail, not another gather brain. The agent loop
    // owns searches; deterministic no-planTurn fallback gathers before finish.
    if (contextHasVerifiedFieldBehavior(context, query)) {
      return;
    }
    // Bounded fail-open recovery only after the ledger and every known write
    // path were consumed. This is not the old multi-query scavenger loop.
    if (!allowLastChanceSearch) {
      return;
    }
    const quoteSearched = await this.lastChanceAskedRejectQuoteSearch(
      repoId,
      query,
      emit,
      context,
      conversation,
      openedServerWritePaths
    );
    if (quoteSearched || contextHasVerifiedFieldBehavior(context, query)) {
      return;
    }
    await this.lastChanceRejectInventedSymbolSearch(
      repoId,
      query,
      emit,
      context,
      conversation,
      openedServerWritePaths
    );
  }

  /**
   * Before canned miss: one search with the Exact asked error quote (rails fail-open).
   * sanitize used to rewrite these to get("parent") — never leave that as the only try.
   */
  private async lastChanceAskedRejectQuoteSearch(
    repoId: string,
    query: string,
    emit: (step: AgentStep) => void,
    context: AgentSessionContext,
    conversation: AgentConversationMessage[] | undefined,
    openedServerWritePaths: Set<string>
  ): Promise<boolean> {
    if (contextHasVerifiedFieldBehavior(context, query)) {
      return false;
    }
    const quotes = askedRejectErrorQuotes(query);
    const candidates = [
      ...quotes,
      ...askedRejectFieldTokens(query)
        .filter((field) => !field.endsWith("_id") || field === "parent_id")
        .slice(0, 1)
        .map((field) => {
          const stem = field.replace(/_id$/i, "");
          return `${stem} is not valid`;
        })
    ].filter(Boolean);
    for (const raw of candidates) {
      const searchQuery = sanitizeAgentSearchQuery(raw, query);
      const key = searchQuery.toLowerCase();
      if (!searchQuery || this.rejectQuoteLastChanceTried.has(key)) {
        continue;
      }
      this.rejectQuoteLastChanceTried.add(key);
      try {
        const searchRaw = await this.executeTool("search_code", { query: searchQuery, repoId });
        const decorated = this.decorateToolResult("search_code", searchRaw, query);
        this.mergeContext(context, "search_code", decorated);
        conversation?.push({
          role: "assistant",
          content: JSON.stringify({ tool: "search_code", args: { query: searchQuery } })
        });
        conversation?.push({ role: "user", content: decorated });
        emit({
          index: 0,
          tool: "search_code",
          summary: `search_code: ${truncateSummary(searchQuery)} (reject quote)`,
          completed: true
        });
        const parsed = JSON.parse(decorated) as SearchPayload & { preferredHits?: SearchHit[] };
        const allHits = [
          ...(parsed.preferredHits ?? []),
          ...((parsed.hits as SearchHit[] | undefined) ?? [])
        ];
        this.recordRejectHitLedger(allHits, query);
        const attached = await this.attachRejectFromSearchHits(
          repoId,
          allHits,
          query,
          emit,
          context,
          conversation
        );
        if (attached.ok) {
          return true;
        }
        for (const hit of allHits) {
          if (hit.fileName && isRejectJumpCandidatePath(hit.fileName)) {
            openedServerWritePaths.add(normalizeHuntPath(hit.fileName));
          }
        }
        if (allHits.some((hit) => hit.fileName && isFailOpenRejectHit(hit, query))) {
          const opened = await this.readFirstMatchingHit(
            repoId,
            query,
            allHits.filter((hit) => hit.fileName && isFailOpenRejectHit(hit, query)),
            emit,
            context,
            conversation
          );
          if (opened.ok && contextHasVerifiedFieldBehavior(context, query)) {
            return true;
          }
        }
        return this.unusedRejectEvidence(context, query, openedServerWritePaths) !== null;
      } catch {
        continue;
      }
    }
    return false;
  }

  /**
   * Live Fail (Parent): Exact quote absent from Lightning; codehost empty/403;
   * agent sprayed quote variants then done. Before canned miss, search ≤2
   * ask-derived symbols (IssueCreateSerializer from issue+create, validate_*)
   * and attach if the asked quote/reject is in the body.
   *
   * Live Fail (2026-09-30 14:03): invent opened draft.py twin first and froze.
   * Prefer job-matching paths (create/update in path/class); only keep a weak
   * twin if no stronger site appears after ranked candidates.
   */
  private async lastChanceRejectInventedSymbolSearch(
    repoId: string,
    query: string,
    emit: (step: AgentStep) => void,
    context: AgentSessionContext,
    conversation: AgentConversationMessage[] | undefined,
    openedServerWritePaths: Set<string>
  ): Promise<boolean> {
    if (this.rejectInventLastChanceTried || contextHasVerifiedFieldBehavior(context, query)) {
      return false;
    }
    this.rejectInventLastChanceTried = true;
    const seeds = inventRejectSymbolSearchCriteria(query).slice(0, 2);
    if (seeds.length === 0) {
      return false;
    }

    const tryAttachFromBody = async (
      filePath: string,
      content: string
    ): Promise<"strong" | "weak" | "none"> => {
      if (shouldSkipEvidencePath(filePath, query)) {
        return "none";
      }
      if (
        !contentIncludesAskedRejectQuote(content, query) &&
        !contentLooksLikeAskedFieldReject(content, query, filePath)
      ) {
        return "none";
      }
      const quotes = askedRejectErrorQuotes(query);
      const match =
        (quotes[0] ? findQueryMatchLine(content, quotes[0]) : undefined) ??
        (() => {
          const line = lineNumberOfWriteReject(content, query, filePath);
          if (!line) {
            return undefined;
          }
          const rows = content.split(/\r?\n/);
          return { lineNumber: line, content: rows[line - 1] ?? "" };
        })();
      if (!match) {
        return "none";
      }
      const weak = isWeakRejectTwinForAsk(filePath, content, query);
      if (weak) {
        return "weak";
      }
      const attached = this.attachRejectSnippetPayload(
        filePath,
        match.content,
        match.lineNumber,
        query,
        emit,
        context,
        conversation
      );
      if (attached.ok) {
        openedServerWritePaths.add(normalizeHuntPath(filePath));
        return "strong";
      }
      const jumped = await this.readWriteRejectInSameFile(
        repoId,
        filePath,
        query,
        emit,
        context,
        conversation
      );
      if (jumped.ok) {
        openedServerWritePaths.add(normalizeHuntPath(filePath));
        return rejectEvidenceMatchesAskJob(
          remoteReadEvidenceFiles((context.read_file as ReadFilePayload | undefined)?.files),
          query
        )
          ? "strong"
          : "weak";
      }
      return "none";
    };

    let weakCandidate: { path: string; content: string; lineNumber: number } | undefined;

    for (const seed of seeds) {
      const key = seed.toLowerCase();
      if (this.rejectQuoteLastChanceTried.has(key)) {
        continue;
      }
      this.rejectQuoteLastChanceTried.add(key);
      try {
        const searchRaw = await this.executeTool("search_code", { query: seed, repoId });
        const decorated = this.decorateToolResult("search_code", searchRaw, query);
        this.mergeContext(context, "search_code", decorated);
        conversation?.push({
          role: "assistant",
          content: JSON.stringify({ tool: "search_code", args: { query: seed } })
        });
        conversation?.push({ role: "user", content: decorated });
        emit({
          index: 0,
          tool: "search_code",
          summary: `search_code: ${truncateSummary(seed)} (reject invent)`,
          completed: true
        });
        const parsed = JSON.parse(decorated) as SearchPayload & {
          preferredHits?: SearchHit[];
          symbols?: Array<{ file?: string; path?: string }>;
        };
        const allHits = [
          ...(parsed.preferredHits ?? []),
          ...((parsed.hits as SearchHit[] | undefined) ?? [])
        ];
        this.recordRejectHitLedger(allHits, query);

        // Attach from snippets only when the hit is job-strong — never freeze on draft twin.
        const strongHits = [...allHits]
          .filter(
            (hit) =>
              hit.fileName &&
              !shouldSkipEvidencePath(hit.fileName, query) &&
              !isWeakRejectTwinForAsk(hit.fileName, hit.content ?? "", query)
          )
          .sort(
            (a, b) =>
              scoreRejectPathForAskJob(b.fileName ?? "", b.content ?? "", query) -
              scoreRejectPathForAskJob(a.fileName ?? "", a.content ?? "", query)
          );
        const attached = await this.attachRejectFromSearchHits(
          repoId,
          strongHits,
          query,
          emit,
          context,
          conversation
        );
        if (
          attached.ok &&
          rejectEvidenceMatchesAskJob(
            remoteReadEvidenceFiles((context.read_file as ReadFilePayload | undefined)?.files),
            query
          )
        ) {
          return true;
        }

        // Remember weak snippet twins; attach only if nothing stronger appears.
        for (const hit of allHits) {
          if (
            !hit.fileName ||
            !hit.content?.trim() ||
            shouldSkipEvidencePath(hit.fileName, query)
          ) {
            continue;
          }
          if (
            isWeakRejectTwinForAsk(hit.fileName, hit.content, query) &&
            contentLooksLikeAskedFieldReject(hit.content, query, hit.fileName)
          ) {
            if (
              !weakCandidate ||
              scoreRejectPathForAskJob(hit.fileName, hit.content, query) >
                scoreRejectPathForAskJob(
                  weakCandidate.path,
                  weakCandidate.content,
                  query
                )
            ) {
              weakCandidate = {
                path: hit.fileName,
                content: hit.content,
                lineNumber: hit.lineNumber ?? 1
              };
            }
          }
        }

        const pathScores = new Map<string, number>();
        const rememberPath = (filePath: string, content = ""): void => {
          if (!filePath || shouldSkipEvidencePath(filePath, query)) {
            return;
          }
          const score = Math.max(
            pathScores.get(normalizeHuntPath(filePath)) ?? -999,
            scoreRejectPathForAskJob(filePath, content, query),
            rejectInventPathRank(filePath, query)
          );
          pathScores.set(normalizeHuntPath(filePath), score);
          if (isRejectJumpCandidatePath(filePath)) {
            openedServerWritePaths.add(normalizeHuntPath(filePath));
          }
        };
        for (const hit of allHits) {
          if (hit.fileName) {
            rememberPath(hit.fileName, hit.content ?? "");
          }
        }
        for (const sym of parsed.symbols ?? []) {
          const file = (sym.file ?? (sym as { path?: string }).path)?.trim();
          if (file) {
            rememberPath(file);
          }
        }

        const rankedPaths = [...pathScores.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([pathKey]) => {
            const hit = allHits.find(
              (entry) => normalizeHuntPath(entry.fileName ?? "") === pathKey
            );
            return hit?.fileName ?? pathKey;
          })
          .slice(0, 4);

        for (const filePath of rankedPaths) {
          const file = await this.ctx.readRemoteFile?.({ path: filePath, repoId });
          if (!file?.content?.trim()) {
            continue;
          }
          emit({
            index: 0,
            tool: "read_file",
            summary: `read_file: ${filePath} (reject invent)`,
            completed: true
          });
          const result = await tryAttachFromBody(filePath, file.content);
          if (result === "strong") {
            return true;
          }
          if (result === "weak") {
            const quotes = askedRejectErrorQuotes(query);
            const match =
              (quotes[0] ? findQueryMatchLine(file.content, quotes[0]) : undefined) ??
              (() => {
                const line = lineNumberOfWriteReject(file.content, query, filePath);
                if (!line) {
                  return undefined;
                }
                const rows = file.content.split(/\r?\n/);
                return { lineNumber: line, content: rows[line - 1] ?? "" };
              })();
            if (match) {
              weakCandidate = {
                path: filePath,
                content: match.content,
                lineNumber: match.lineNumber
              };
            }
            // Live: IssueCreateSerializer invent ranked draft.py — follow imports / peer issue.py.
            for (const related of relatedSerializerPathsFromWeakTwin(
              filePath,
              file.content,
              query
            )) {
              if (shouldSkipEvidencePath(related, query)) {
                continue;
              }
              if (normalizeHuntPath(related) === normalizeHuntPath(filePath)) {
                continue;
              }
              const relatedFile = await this.ctx.readRemoteFile?.({
                path: related,
                repoId
              });
              if (!relatedFile?.content?.trim()) {
                continue;
              }
              emit({
                index: 0,
                tool: "read_file",
                summary: `read_file: ${related} (reject invent related)`,
                completed: true
              });
              const relatedResult = await tryAttachFromBody(related, relatedFile.content);
              if (relatedResult === "strong") {
                return true;
              }
            }
          }
        }
      } catch {
        continue;
      }
    }

    // Before settling on a weak twin: open it and follow related create/update peers.
    if (weakCandidate && !contextHasVerifiedFieldBehavior(context, query)) {
      const weakBody =
        (
          await this.ctx.readRemoteFile?.({ path: weakCandidate.path, repoId })
        )?.content ?? weakCandidate.content;
      for (const related of relatedSerializerPathsFromWeakTwin(
        weakCandidate.path,
        weakBody,
        query
      )) {
        if (shouldSkipEvidencePath(related, query)) {
          continue;
        }
        const relatedFile = await this.ctx.readRemoteFile?.({ path: related, repoId });
        if (!relatedFile?.content?.trim()) {
          continue;
        }
        emit({
          index: 0,
          tool: "read_file",
          summary: `read_file: ${related} (reject invent related)`,
          completed: true
        });
        if ((await tryAttachFromBody(related, relatedFile.content)) === "strong") {
          return true;
        }
      }
    }

    // No create/update site — honest partial: attach best weak twin if any.
    if (weakCandidate && !contextHasVerifiedFieldBehavior(context, query)) {
      const attached = this.attachRejectSnippetPayload(
        weakCandidate.path,
        weakCandidate.content,
        weakCandidate.lineNumber,
        query,
        emit,
        context,
        conversation
      );
      return attached.ok;
    }
    return contextHasVerifiedFieldBehavior(context, query);
  }

  private unusedRejectEvidence(
    context: AgentSessionContext | undefined,
    query: string,
    openedServerWritePaths: Set<string>
  ): UnusedRejectEvidence | null {
    if (!context || contextHasVerifiedFieldBehavior(context, query)) {
      return null;
    }
    const attachable = this.findAttachableRejectHit(
      [
        ...this.rejectHitLedger,
        ...searchPreferredHits(context),
        ...searchRawHits(context)
      ],
      query
    );
    if (attachable) {
      return {
        kind: "snippet",
        path: attachable.fileName,
        content: attachable.content,
        lineNumber: attachable.lineNumber
      };
    }
    const candidates = collectRejectJumpCandidates(
      context,
      openedServerWritePaths,
      this.rejectJumpPathLedger
    );
    for (const path of candidates) {
      return { kind: "jump", path };
    }
    return null;
  }

  private findAttachableRejectHit(
    hits: Array<{ fileName?: string; content?: string; lineNumber?: number }>,
    query: string
  ): RejectHitLedgerEntry | undefined {
    const seen = new Set<string>();
    for (const hit of hits) {
      if (!hit.fileName || !hit.content?.trim()) {
        continue;
      }
      const key = `${normalizeHuntPath(hit.fileName)}::${hit.content.slice(0, 120)}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      if (shouldSkipEvidencePath(hit.fileName, query)) {
        continue;
      }
      if (!contentLooksLikeAskedFieldReject(hit.content, query, hit.fileName)) {
        continue;
      }
      return {
        fileName: hit.fileName,
        content: hit.content,
        lineNumber: Number.isInteger(hit.lineNumber) && (hit.lineNumber as number) >= 1
          ? (hit.lineNumber as number)
          : 1
      };
    }
    return undefined;
  }

  private recordRejectHitLedger(hits: SearchHit[], query: string): void {
    for (const hit of hits) {
      if (!hit.fileName) {
        continue;
      }
      if (shouldSkipEvidencePath(hit.fileName, query)) {
        continue;
      }
      if (isRejectJumpCandidatePath(hit.fileName)) {
        this.rejectJumpPathLedger.add(normalizeHuntPath(hit.fileName));
      }
      if (!hit.content?.trim()) {
        continue;
      }
      if (!contentLooksLikeAskedFieldReject(hit.content, query, hit.fileName)) {
        continue;
      }
      const key = normalizeHuntPath(hit.fileName);
      if (this.rejectHitLedger.some((entry) => normalizeHuntPath(entry.fileName) === key)) {
        continue;
      }
      this.rejectHitLedger.push({
        fileName: hit.fileName,
        content: hit.content,
        lineNumber: hit.lineNumber ?? 1
      });
      if (this.rejectHitLedger.length > MAX_REJECT_HIT_LEDGER) {
        this.rejectHitLedger.shift();
      }
    }
  }

  /** Open ranked reject candidates remotely; index-only excerpts never satisfy evidence. */
  private async attachRejectFromSearchHits(
    repoId: string,
    hits: SearchHit[],
    query: string,
    emit: (step: AgentStep) => void,
    context: AgentSessionContext,
    conversation?: AgentConversationMessage[],
    skipPaths?: Set<string>
  ): Promise<{ ok: boolean; raw?: string; path?: string }> {
    const seen = new Set<string>();
    const candidates: SearchHit[] = [];
    for (const hit of hits) {
      if (!hit.fileName || !hit.content?.trim()) {
        continue;
      }
      const key = normalizeHuntPath(hit.fileName);
      if (seen.has(key) || skipPaths?.has(key)) {
        continue;
      }
      seen.add(key);
      if (shouldSkipEvidencePath(hit.fileName, query)) {
        continue;
      }
      if (!contentLooksLikeAskedFieldReject(hit.content, query, hit.fileName)) {
        continue;
      }
      candidates.push(hit);
    }
    return this.readFirstMatchingHit(
      repoId,
      query,
      candidates,
      emit,
      context,
      conversation,
      skipPaths
    );
  }

  private attachRejectSnippetPayload(
    filePath: string,
    content: string,
    lineNumber: number,
    query: string,
    emit: (step: AgentStep) => void,
    context: AgentSessionContext,
    conversation?: AgentConversationMessage[]
  ): { ok: boolean; raw?: string; path?: string } {
    const start = Number.isInteger(lineNumber) && lineNumber >= 1 ? lineNumber : 1;
    const numbered = content
      .split("\n")
      .map((row, index) => `${start + index}|${row.replace(/^\d+\|/, "")}`)
      .join("\n");
    if (!contentLooksLikeAskedFieldReject(numbered, query, filePath)) {
      return { ok: false };
    }
    const raw = JSON.stringify({
      path: filePath,
      startLine: start,
      files: [{ path: filePath, content: numbered, evidenceSource: "search-snippet" }]
    });
    this.mergeContext(context, "read_file", raw);
    conversation?.push({
      role: "user",
      content: `Search-result snippet only (not an opened remote file): ${filePath}:${start}\n${numbered}`
    });
    emit({
      index: 0,
      tool: "read_file",
      summary: `search snippet only (not remotely verified): ${filePath}`,
      completed: true
    });
    return { ok: true, raw, path: filePath };
  }

  /**
   * Fail-open / no-planTurn only: small deterministic seed (≤4), not the
   * 12-slogan scavenger. Live path uses planTurn.
   */
  private async huntWriteReject(
    repoId: string,
    query: string,
    emit: (step: AgentStep) => void,
    context: AgentSessionContext,
    conversation?: AgentConversationMessage[]
  ): Promise<boolean> {
    const queries = mergePlannedAgentSearchQueries({
      userMessage: query,
      planned: this.runPlannedSearchQueries,
      max: MAX_API_REJECT_SEED_SEARCHES
    });
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
        const allHits = [
          ...(parsed.preferredHits ?? []),
          ...((parsed.hits as SearchHit[] | undefined) ?? [])
        ];
        this.recordRejectHitLedger(allHits, query);
        const attached = await this.attachRejectFromSearchHits(repoId, allHits, query, emit, context, conversation);
        if (attached.ok && contextHasVerifiedFieldBehavior(context, query)) {
          return true;
        }
        let toRead = (parsed.preferredHits ?? []).filter((hit) => {
          if (!hit.fileName) {
            return false;
          }
          if (shouldSkipEvidencePath(hit.fileName, query)) {
            return false;
          }
          return !skippedPaths.has(normalizeHuntPath(hit.fileName));
        });
        if (!toRead.length) {
          toRead = allHits.filter(
            (hit) =>
              hit.fileName &&
              !shouldSkipEvidencePath(hit.fileName, query) &&
              !skippedPaths.has(normalizeHuntPath(hit.fileName)) &&
              isFailOpenRejectHit(hit, query)
          );
        }
        // A reject search result can identify the handler without carrying a
        // reject-shaped snippet (for example, a path-only or declaration hit
        // from the signing handler). Once preferred/fail-open candidates are
        // empty, consume the first non-noise path before spending another
        // search. The remote body remains the evidence gate in
        // readFirstMatchingHit; this only prevents a zero-read search parade.
        if (!toRead.length) {
          toRead = allHits.filter(
            (hit) =>
              hit.fileName &&
              !shouldSkipEvidencePath(hit.fileName, query) &&
              !skippedPaths.has(normalizeHuntPath(hit.fileName))
          );
        }
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
        if (opened.ok && contextHasVerifiedFieldBehavior(context, query)) {
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
    searchQueries?: string[],
    searchBudget: SearchBudget = {}
  ): Promise<{ toRead: SearchHit[] } | undefined> {
    const searchLimit = Math.min(
      MAX_SEARCH_ATTEMPTS,
      Math.max(0, searchBudget.maxSearches ?? MAX_SEARCH_ATTEMPTS)
    );
    const queries = (
      searchQueries ??
      mergePlannedAgentSearchQueries({
        userMessage: query,
        planned: this.runPlannedSearchQueries,
        max: MAX_SEARCH_ATTEMPTS
      })
    )
      .filter((candidate) => !skipQueries.has(candidate))
      .slice(0, searchLimit);
    let stepIndex = 0;
    const tried: string[] = [];
    let lastError: string | undefined;
    for (const searchQuery of queries) {
      if (searchBudget.canContinue && !searchBudget.canContinue()) {
        break;
      }
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
      const originalHits = [...(parsed.hits ?? [])];
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
      // Reject: never discard every hit — empty preferredHits → 10 searches / 0 reads.
      // Also: preferred may be non-empty UI/noise while originalHits still hold the reject
      // fragment — inject asked-field / fail-open hits so attach can see them.
      if (isApiRejectAsk(userMessage)) {
        const hasAskedField = preferred.some((hit) =>
          contentLooksLikeAskedFieldReject(hit.content ?? "", userMessage, hit.fileName)
        );
        if (preferred.length === 0 || !hasAskedField) {
          for (const hit of originalHits) {
            if (!hit.fileName || preferred.some((seen) => seen.fileName === hit.fileName)) {
              continue;
            }
            // If ranking produced no preferred reject candidate at all, keep
            // the first non-noise path as a read candidate. A signing handler
            // may be returned as a declaration/path hit whose snippet does
            // not contain the guard; the remote body is the evidence gate.
            if (!isFailOpenRejectHit(hit, userMessage) && preferred.length > 0) {
              continue;
            }
            // Prefer inject when asked-field / quote-overlap; else only if preferred empty.
            const asked = contentLooksLikeAskedFieldReject(
              hit.content ?? "",
              userMessage,
              hit.fileName
            );
            if (!asked && preferred.length > 0) {
              continue;
            }
            preferred.unshift(hit);
            if (preferred.length >= 5) {
              break;
            }
          }
        }
      }
      parsed.preferredHits = preferred.slice(0, 5);
      // Drop near-miss symbols/hits from model context — otherwise synthesis
      // invents patches for test_all_endpoints_require_authentication.
      parsed.symbols = definitions;
      parsed.hits = preferred.length > 0 ? preferred : textHits;
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

  /**
   * After the export is picked, the writer should see one implementation body:
   * the jumped declaration window, not page 1 plus the full file.
   */
  private replaceReadFileAttach(
    context: AgentSessionContext,
    conversation: AgentConversationMessage[] | undefined,
    path: string,
    raw: string,
    window?: { startLine: number; endLine: number }
  ): void {
    let next: ReadFilePayload;
    try {
      next = JSON.parse(raw) as ReadFilePayload;
    } catch {
      next = { error: "invalid tool JSON" };
    }
    const prev = context.read_file as ReadFilePayload | undefined;
    const keptFiles = (prev?.files ?? []).filter(
      (file) => this.preserveCompoundWriteEvidence || !sameHuntPath(file.path ?? "", path)
    );
    const incoming = (next.files ?? []).filter(
      (file) => !file.path || sameHuntPath(file.path, path)
    ).map((file) => ({ ...file, evidenceSource: file.evidenceSource ?? "remote-read" as const }));
    context.read_file = { ...next, files: [...keptFiles, ...incoming] };
    if (!conversation) {
      return;
    }
    const keptMessages: AgentConversationMessage[] = [];
    for (let i = 0; i < conversation.length; i++) {
      const msg = conversation[i];
      if (!this.preserveCompoundWriteEvidence && msg.role === "assistant" && messageIsReadFileOfPath(msg.content, path)) {
        if (conversation[i + 1]?.role === "user") {
          i += 1;
        }
        continue;
      }
      if (!this.preserveCompoundWriteEvidence && msg.role === "user" && payloadIsReadFileOfPath(msg.content, path)) {
        continue;
      }
      keptMessages.push(msg);
    }
    conversation.length = 0;
    conversation.push(...keptMessages);
    conversation.push({
      role: "assistant",
      content: JSON.stringify({
        tool: "read_file",
        args: window
          ? { path, startLine: window.startLine, endLine: window.endLine }
          : { path }
      })
    });
    conversation.push({ role: "user", content: raw });
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
      next.files = (next.files ?? []).map((file) => ({
        ...file,
        evidenceSource: file.evidenceSource ?? "remote-read"
      }));
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

function contextHasVerifiedFieldBehavior(context: AgentSessionContext | undefined, query: string): boolean {
  return contextHasWriteReject(context, query) || ((context?.read_file as ReadFilePayload | undefined)?.files ?? [])
    .some((file) => Boolean(verifiedFieldHandlingEvidence({ path: file.path ?? "", content: file.content ?? "", evidenceSource: file.evidenceSource }, query)));
}

function contextHasWriteReject(
  context: AgentSessionContext | undefined,
  query: string
): boolean {
  const files = remoteReadEvidenceFiles(
    (context?.read_file as ReadFilePayload | undefined)?.files
  );
  return files.some((file) =>
    contentLooksLikeAskedFieldReject(file.content ?? "", query, file.path ?? "")
  );
}

function requiresStateWriteAndReject(query: string, intentBrief?: string): boolean {
  // This completion gate and its fallback specifically prove state persistence.
  // A planner brief cannot turn a Parent validation lookup into a state-transition ask.
  return /\bstate(?:_id)?\b/i.test(query) && (
    (intentBrief?.includes("evidence=write-site") === true && intentBrief.includes("evidence=write-reject")) ||
    (isApiRejectAsk(query) && /\b(written|persisted|saved|write|writes|updates?)\b/i.test(query))
  );
}

export function contextHasStateWriteSite(context: AgentSessionContext | undefined): boolean {
  const files = remoteReadEvidenceFiles(
    (context?.read_file as ReadFilePayload | undefined)?.files
  );
  const stateMutation =
    /(?:\.\s*state(?:_id)?\s*=|\[\s*["']state(?:_id)?["']\s*\]\s*=|\bstate(?:_id)?\s*=\s*(?:validated_data|data)\b|\b(?:update|setattr)\s*\([^)]*state(?:_id)?)/i;
  const bodies = new Map<string, string[]>();
  for (const file of files) {
    const path = file.path ?? "";
    bodies.set(path, [...(bodies.get(path) ?? []), file.content ?? ""]);
  }
  return [...bodies].some(([path, windows]) => {
    // Tool-call order is not source order. A model may read update before
    // validate, or repeat overlapping windows. Reassemble real numbered rows
    // before judging class scope; never turn an out-of-order proof into a miss.
    const numbered = new Map<number, string>();
    let allNumbered = true;
    for (const row of windows.flatMap(window => window.split("\n"))) {
      const match = /^(\d+)\|(.*)$/.exec(row);
      if (!match) { if (row.trim()) allNumbered = false; continue; }
      const line = Number(match[1]);
      const previous = numbered.get(line);
      if (previous !== undefined && previous !== match[2]) return false;
      numbered.set(line, match[2]!);
    }
    const body = allNumbered && numbered.size
      ? [...numbered].sort(([a], [b]) => a - b).map(([, row]) => row).join("\n")
      : windows.map(stripReadLinePrefixes).join("\n");
    const stateInput = /(?:\.get\(\s*["']state["']|\[\s*["']state["']\s*\])/.exec(body);
    const updateStart = body.search(/\bdef\s+update\([^)]*validated_data/);
    const sameClassStateInput = stateInput && updateStart > stateInput.index &&
      !/^\s*class\s+\w+/m.test(body.slice(stateInput.index, updateStart));
    return (
      (isServerWritePath(path) || isMutationHandlerPath(path)) &&
      (stateMutation.test(body) ||
        (/\bdef\s+update\([^)]*validated_data/.test(body) &&
          /\bsuper\(\)\.update\(\s*instance\s*,\s*validated_data\s*\)/.test(body) &&
          sameClassStateInput))
    );
  });
}

function completePythonRejectWindow(body: string, query: string, path: string): { content: string; startLine: number; endLine: number } | undefined {
  const line = lineNumberOfWriteReject(body, query, path);
  if (!line) return undefined;
  const rows = body.split(/\r?\n/);
  for (let start = line - 2; start >= Math.max(0, line - 30); start--) {
    const guard = rows[start]!.match(/^(\s*)(?:if|elif)\b/);
    if (!guard) continue;
    let end = line;
    while (end < rows.length && (!rows[end]!.trim() || rows[end]!.match(/^\s*/)![0].length > guard[1]!.length)) end++;
    while (end > start + 1 && !rows[end - 1]!.trim()) end--;
    const content = rows.slice(start, end).join("\n");
    if (end - start <= 60 && contentLooksLikeAskedFieldReject(content, query, path)) return { content, startLine: start + 1, endLine: end };
  }
  return undefined;
}

export function sameClassSerializerUpdateWindow(body: string, guard: string, query = ""): { content: string; startLine: number; endLine: number } | undefined {
  let anchor = -1;
  // Evidence may contain multiple numbered windows for the same file. Their
  // concatenation is not a contiguous substring of the complete remote body.
  // Recover only an exact, unique rejection row; never anchor by class name
  // or a guessed path, which could borrow a neighboring serializer's writer.
    for (const row of guard.split(/\r?\n/)) {
      const exact = row.trimEnd();
      if (!exact.trim() || !contentLooksLikeWriteReject(exact)) continue;
      const fields = askedRejectFieldTokens(query);
      if (query && !fields.some(field => new RegExp(`\\b${field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(exact))) continue;
      const found = body.indexOf(exact);
      if (found >= 0 && body.indexOf(exact, found + exact.length) < 0) { anchor = found; break; }
    }
  if (anchor < 0 || !guard.trim()) return undefined;
  const rows = body.split(/\r?\n/);
  const anchorLine = body.slice(0, anchor).split(/\r?\n/).length - 1;
  let classStart = -1;
  let classEnd = rows.length;
  for (let candidate = 0; candidate <= anchorLine; candidate++) {
    if (!/^\s*class\s+\w+/.test(rows[candidate]!)) continue;
    const indent = rows[candidate]!.match(/^\s*/)![0].length;
    let end = rows.length;
    for (let line = candidate + 1; line < rows.length; line++) {
      const row = rows[line]!;
      if (row.trim() && !row.trimStart().startsWith("#") && row.match(/^\s*/)![0].length <= indent) { end = line; break; }
    }
    // A nested configuration class before validate has already ended. Choose
    // the innermost class whose actual indentation scope contains the guard.
    if (anchorLine < end) { classStart = candidate; classEnd = end; }
  }
  if (classStart < 0) return undefined;
  for (let start = classStart + 1; start < classEnd; start++) {
    const declaration = rows[start]!.match(/^(\s*)def\s+update\([^)]*\bvalidated_data\b[^)]*\):\s*$/);
    if (!declaration) continue;
    let end = start + 1;
    while (end < classEnd && (!rows[end]!.trim() || rows[end]!.trimStart().startsWith("#") || rows[end]!.match(/^\s*/)![0].length > declaration[1]!.length)) end++;
    while (end > start + 1 && !rows[end - 1]!.trim()) end--;
    const content = rows.slice(start, end).join("\n");
    if (end - start > 200 || /^\s*(?:\.\.\.|…)\s*$/m.test(content) ||
        !/\breturn\s+super\(\)\.update\(\s*instance\s*,\s*validated_data\s*\)/.test(content)) continue;
    return { content, startLine: start + 1, endLine: end };
  }
  return undefined;
}

function contextHasGroundedLocateRead(
  context: AgentSessionContext | undefined,
  query: string
): boolean {
  const files = remoteReadEvidenceFiles(
    (context?.read_file as ReadFilePayload | undefined)?.files
  );
  return files.some((file) =>
    locateReadCountsAsGrounding({
      path: file.path ?? "",
      body: stripReadLinePrefixes(file.content ?? ""),
      query
    })
  );
}

/** First line that looks like a write/reject raise — used when field-aware scan misses. */
function lineNumberOfAnyWriteReject(content: string): number | undefined {
  const rows = content.split("\n").map((row) => row.replace(/^\d+\|/, ""));
  for (let i = 0; i < rows.length; i++) {
    if (contentLooksLikeWriteReject(rows[i] ?? "")) {
      return i + 1;
    }
  }
  return undefined;
}

function contextHasRequestAuthEnforcement(context: AgentSessionContext | undefined): boolean {
  const files = (context?.read_file as ReadFilePayload | undefined)?.files ?? [];
  return files.some((file) =>
    isRequestAuthEnforcementHit({ fileName: file.path ?? "", content: file.content ?? "" })
  );
}

function contextHasBackendStateDefinition(context: AgentSessionContext | undefined): boolean {
  const files = (context?.read_file as ReadFilePayload | undefined)?.files ?? [];
  return files.some((file) =>
    isBackendStateDefinitionHit({ fileName: file.path ?? "", content: file.content ?? "" })
  );
}

function contextHasCreateDefinition(context: AgentSessionContext | undefined): boolean {
  const files = (context?.read_file as ReadFilePayload | undefined)?.files ?? [];
  return files.some(
    (file) =>
      isCreateDefinitionHit({ fileName: file.path ?? "", content: file.content ?? "" }) ||
      contentLooksLikeCreateHandler(file.content ?? "")
  );
}

function attachedReadPaths(context: AgentSessionContext | undefined): string[] {
  const files = remoteReadEvidenceFiles(
    (context?.read_file as ReadFilePayload | undefined)?.files
  );
  return files.map((file) => file.path ?? "").filter(Boolean);
}

function remoteReadEvidenceFiles(
  files: ReadFilePayload["files"]
): NonNullable<ReadFilePayload["files"]> {
  return (files ?? []).filter((file) => file.evidenceSource !== "search-snippet");
}

function isRejectJumpCandidatePath(fileName: string): boolean {
  if (!fileName.trim()) {
    return false;
  }
  const n = fileName.replace(/\\/g, "/").toLowerCase();
  return (
    isServerWritePath(fileName) ||
    isMutationHandlerPath(fileName) ||
    /(^|\/)serializers?\//.test(n) ||
    /\.serializer\.(py|ts|go|rb)$/.test(n)
  );
}

function searchPreferredHits(context: AgentSessionContext | undefined): SearchHit[] {
  const parsed = context?.search_code as (SearchPayload & { preferredHits?: SearchHit[] }) | undefined;
  return (parsed?.preferredHits ?? []).filter((hit) => Boolean(hit.fileName));
}

function searchRawHits(context: AgentSessionContext | undefined): SearchHit[] {
  const parsed = context?.search_code as SearchPayload | undefined;
  return ((parsed?.hits as SearchHit[] | undefined) ?? []).filter((hit) => Boolean(hit.fileName));
}

function collectRejectJumpCandidates(
  context: AgentSessionContext | undefined,
  openedServerWritePaths: Set<string>,
  jumpPathLedger: Set<string> = new Set()
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (path: string | undefined) => {
    if (!path?.trim()) {
      return;
    }
    const key = normalizeHuntPath(path);
    if (seen.has(key)) {
      return;
    }
    if (
      !isRejectJumpCandidatePath(path) &&
      !openedServerWritePaths.has(key) &&
      !jumpPathLedger.has(key)
    ) {
      return;
    }
    seen.add(key);
    out.push(path);
  };
  for (const path of openedServerWritePaths) {
    push(path);
  }
  for (const path of jumpPathLedger) {
    push(path);
  }
  for (const path of attachedReadPaths(context)) {
    push(path);
  }
  for (const hit of [...searchPreferredHits(context), ...searchRawHits(context)]) {
    push(hit.fileName);
  }
  return out;
}

function shipCheckRippleBody(
  body: string,
  query: string,
  groundedExport?: string
): boolean {
  return (
    readBodyHasCallerUse(body, query, groundedExport) ||
    (isShipCheckQuery(query) && contentLooksLikeUnauthorizedWrite(body))
  );
}

function contextHasUnauthorizedSiblingWrite(
  context: AgentSessionContext | undefined,
  implementationPath?: string
): boolean {
  const files = (context?.read_file as ReadFilePayload | undefined)?.files ?? [];
  const impl = implementationPath ? normalizeHuntPath(implementationPath) : "";
  return files.some((file) => {
    const path = file.path ?? "";
    if (impl && normalizeHuntPath(path) === impl) {
      return false;
    }
    return contentLooksLikeUnauthorizedWrite(file.content ?? "");
  });
}

function pruneContextToWriteReject(context: AgentSessionContext | undefined, query: string): void {
  if (!context?.read_file || typeof context.read_file !== "object") {
    return;
  }
  const payload = context.read_file as ReadFilePayload;
  const files = (payload.files ?? []).filter((file) =>
    filterWriteRejectFiles([file], query).length > 0 || Boolean(verifiedFieldHandlingEvidence({
      path: file.path ?? "", content: file.content ?? "", evidenceSource: file.evidenceSource
    }, query)));
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
