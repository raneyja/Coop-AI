import {
  AGENT_JOB_WALL_MS,
  AGENT_MAX_FILES_READ,
  AGENT_MAX_TOOL_ROUNDS
} from "../../config/agentJobBudget";
import type {
  AgentPlanTurnFn,
  AgentSessionContext,
  AgentSessionRequest,
  AgentSessionResult,
  AgentStep,
  AgentToolName
} from "./agentTypes";
import type { AgentToolContext } from "./agentToolContext";
import { parseAgentToolPlan } from "./parseAgentToolPlan";
import {
  fallbackAgentSearchQueries,
  pickSearchHitsToRead,
  pickSymbolHitsToRead,
  pickTopSearchHit,
  rankSearchHits,
  sanitizeAgentSearchQuery
} from "./searchQuery";
import { createAgentToolRegistry } from "./tools/registry";
import { isRepoStructureQuery } from "../../workspace/repoFactIntent";

export { pickTopSearchHit };

const DEFAULT_MAX_STEPS = AGENT_MAX_TOOL_ROUNDS;
const READ_LINE_PADDING = 25;
/** Each retry is another round trip — the gather budget is shared with the answer. */
const MAX_SEARCH_ATTEMPTS = 2;
/** Read budget when the index returned a hit with no line number. */
const UNPOSITIONED_READ_LINES = 120;

type SearchHit = {
  fileName: string;
  lineNumber: number;
  score?: number;
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
  /** When set, the model chooses tools. Missing/invalid first plan → deterministic fallback. */
  planTurn?: AgentPlanTurnFn;
  signal?: AbortSignal;
  startedAt?: number;
  wallMs?: number;
};

/**
 * Read-only agent loop (opt-in via `coopAI.chat.agentMode`).
 * LLM-chosen tools when `planTurn` is provided; otherwise deterministic
 * `search_code` → `read_file` (or `list_directory` for structure asks).
 */
export class AgentOrchestrator {
  private readonly registry;

  public constructor(private readonly ctx: AgentToolContext) {
    this.registry = createAgentToolRegistry(ctx);
  }

  public async executeTool(tool: AgentToolName, args: Record<string, unknown>): Promise<string> {
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

    if (options?.planTurn) {
      return this.runLlmLoop(request, repoId, query, maxSteps, options);
    }
    return this.runDeterministic(repoId, query, maxSteps, options);
  }

  private async runLlmLoop(
    request: AgentSessionRequest,
    repoId: string,
    query: string,
    maxSteps: number,
    options: AgentRunOptions
  ): Promise<AgentSessionResult> {
    const steps: AgentStep[] = [];
    const context: AgentSessionContext = {};
    const emit = (step: AgentStep) => {
      steps.push(step);
      options.onStep?.(step, [...steps]);
    };
    const startedAt = options.startedAt ?? Date.now();
    const wallMs = options.wallMs ?? AGENT_JOB_WALL_MS;
    const planTurn = options.planTurn;
    if (!planTurn) {
      return this.runDeterministic(repoId, query, maxSteps, options);
    }

    let filesRead = 0;
    let lastToolResult: string | undefined;

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
          lastToolResult
        });
      } catch {
        if (steps.length === 0) {
          return this.runDeterministic(repoId, query, maxSteps, options);
        }
        break;
      }

      const plan = parseAgentToolPlan(raw);
      if (plan.kind === "invalid") {
        if (steps.length === 0) {
          return this.runDeterministic(repoId, query, maxSteps, options);
        }
        break;
      }
      if (plan.kind === "done") {
        break;
      }
      if (plan.tool === "read_file") {
        if (filesRead >= AGENT_MAX_FILES_READ) {
          break;
        }
        filesRead += 1;
      }

      const args = this.prepareToolArgs(plan.tool, plan.args, repoId, query);
      let rawResult: string;
      try {
        rawResult = await this.executeTool(plan.tool, args);
      } catch {
        break;
      }
      lastToolResult = this.decorateToolResult(plan.tool, rawResult, query);
      this.mergeContext(context, plan.tool, lastToolResult);
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
          const found = await this.searchUntilReadableHits(repoId, query, emit, context, new Set([used]));
          if (found) {
            lastToolResult = JSON.stringify(context.search_code ?? parsed);
          }
        }
      }
      if (plan.tool === "propose_patch") {
        break;
      }
    }

    return { steps, context: steps.length ? context : undefined };
  }

  private async runDeterministic(
    repoId: string,
    query: string,
    maxSteps: number,
    options?: AgentRunOptions
  ): Promise<AgentSessionResult> {
    const steps: AgentStep[] = [];
    const context: AgentSessionContext = {};
    const emit = (step: AgentStep) => {
      steps.push(step);
      options?.onStep?.(step, [...steps]);
    };

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

    const topHit = found.toRead[0];
    if (!topHit?.fileName) {
      return { steps, context };
    }

    const { startLine, endLine } = readLineWindow(topHit.lineNumber);
    const readRaw = await this.executeTool("read_file", {
      path: topHit.fileName,
      repoId,
      startLine,
      endLine
    });
    const readParsed = JSON.parse(readRaw) as Record<string, unknown>;
    context.read_file = readParsed;
    emit({
      index: steps.length,
      tool: "read_file",
      summary: `read_file: ${topHit.fileName}`,
      completed: true
    });

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
    for (const searchQuery of queries) {
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
      const parsed = JSON.parse(decorated) as SearchPayload & { preferredHits?: SearchHit[] };
      const toRead = parsed.preferredHits ?? [];
      if (toRead.length > 0) {
        return { toRead };
      }
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
      parsed.preferredHits = preferred.slice(0, 2);
      parsed.hits = textHits;
      parsed.skipNote = preferred.length
        ? definitions.length
          ? "preferredHits starts with declaration sites from the symbol index — read those lines, not the top of the file."
          : "Read the ranked hits below. Barrel index.ts, build output, and vendored code are already filtered out."
        : "Every hit was a barrel, build output, or vendored file. Search again with a different term — do not read those paths.";
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
    const path = typeof args.path === "string" ? args.path : "";
    return `git_blame: ${path}`;
  }
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
