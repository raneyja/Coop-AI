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
  pickSearchHitsToRead,
  pickTopSearchHit,
  rankSearchHits,
  sanitizeAgentSearchQuery
} from "./searchQuery";
import { createAgentToolRegistry } from "./tools/registry";
import { isRepoStructureQuery } from "../../workspace/repoFactIntent";

export { pickTopSearchHit };

const DEFAULT_MAX_STEPS = AGENT_MAX_TOOL_ROUNDS;
const READ_LINE_PADDING = 25;

type SearchHit = {
  fileName: string;
  lineNumber: number;
  score?: number;
};

type SearchPayload = {
  error?: string;
  hits?: SearchHit[];
};

type ReadFilePayload = {
  path?: string;
  files?: Array<{ path: string; content: string }>;
  error?: string;
};

function readLineWindow(lineNumber: number): { startLine: number; endLine: number } {
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
      lastToolResult = this.decorateToolResult(plan.tool, rawResult);
      this.mergeContext(context, plan.tool, lastToolResult);
      emit({
        index: steps.length,
        tool: plan.tool,
        summary: this.summarize(plan.tool, args, query),
        completed: true
      });
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

    const searchQuery = sanitizeAgentSearchQuery(query, query);
    const searchRaw = await this.executeTool("search_code", { query: searchQuery, repoId });
    const searchParsed = JSON.parse(searchRaw) as Record<string, unknown>;
    context.search_code = searchParsed;
    emit({
      index: steps.length,
      tool: "search_code",
      summary: `search_code: ${truncateSummary(searchQuery)}`,
      completed: true
    });

    const search = searchParsed as SearchPayload;
    if (search.error || !search.hits?.length || steps.length >= maxSteps) {
      return { steps, context };
    }

    const toRead = pickSearchHitsToRead(search.hits, 1);
    const topHit = toRead[0] ?? pickTopSearchHit(search.hits);
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

  private decorateToolResult(tool: AgentToolName, raw: string): string {
    if (tool !== "search_code") {
      return raw;
    }
    try {
      const parsed = JSON.parse(raw) as SearchPayload & Record<string, unknown>;
      if (!parsed.hits?.length) {
        return raw;
      }
      parsed.hits = rankSearchHits(parsed.hits);
      parsed.preferredHits = pickSearchHitsToRead(parsed.hits, 2);
      parsed.skipNote =
        "Skip barrel index.ts re-exports and frontend auth-form/components paths. Prefer api/server/middleware implementations.";
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
    const path = typeof args.path === "string" ? args.path : "";
    return `git_blame: ${path}`;
  }
}

function truncateSummary(text: string, max = 80): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function createAgentOrchestrator(ctx: AgentToolContext): AgentOrchestrator {
  return new AgentOrchestrator(ctx);
}
