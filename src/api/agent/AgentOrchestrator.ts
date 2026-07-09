import type {
  AgentSessionContext,
  AgentSessionRequest,
  AgentSessionResult,
  AgentStep,
  AgentToolName
} from "./agentTypes";
import type { AgentToolContext } from "./agentToolContext";
import { createAgentToolRegistry } from "./tools/registry";

const DEFAULT_MAX_STEPS = 8;
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

/** Highest-scoring indexed hit; stable order when scores tie. */
export function pickTopSearchHit(hits: SearchHit[]): SearchHit | undefined {
  if (!hits.length) {
    return undefined;
  }
  return [...hits].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
}

function readLineWindow(lineNumber: number): { startLine: number; endLine: number } {
  return {
    startLine: Math.max(1, lineNumber - READ_LINE_PADDING),
    endLine: lineNumber + READ_LINE_PADDING
  };
}

/**
 * Read-only agent loop (opt-in via `coopAI.chat.agentMode`).
 * Interim: deterministic `search_code` → `read_file` on the top hit.
 * Full LLM tool-call parsing is a follow-up.
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

  public async run(request: AgentSessionRequest): Promise<AgentSessionResult> {
    const maxSteps = request.maxSteps ?? DEFAULT_MAX_STEPS;
    const steps: AgentStep[] = [];
    const context: AgentSessionContext = {};

    const repoId = request.repoId?.trim();
    const query = request.message.trim();
    if (!repoId || !query || maxSteps < 1) {
      return { steps, context: undefined };
    }

    const searchRaw = await this.executeTool("search_code", { query, repoId });
    const searchParsed = JSON.parse(searchRaw) as Record<string, unknown>;
    context.search_code = searchParsed;
    steps.push({
      index: steps.length,
      tool: "search_code",
      summary: `search_code: ${truncateSummary(query)}`,
      completed: true
    });

    const search = searchParsed as SearchPayload;
    if (search.error || !search.hits?.length || steps.length >= maxSteps) {
      return { steps, context };
    }

    const topHit = pickTopSearchHit(search.hits);
    if (!topHit?.fileName) {
      return { steps, context };
    }

    const { startLine, endLine } = readLineWindow(topHit.lineNumber);
    const readRaw = await this.executeTool("read_file", {
      path: topHit.fileName,
      startLine,
      endLine
    });
    const readParsed = JSON.parse(readRaw) as Record<string, unknown>;
    context.read_file = readParsed;
    steps.push({
      index: steps.length,
      tool: "read_file",
      summary: `read_file: ${topHit.fileName}`,
      completed: true
    });

    return { steps, context };
  }
}

function truncateSummary(text: string, max = 80): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function createAgentOrchestrator(ctx: AgentToolContext): AgentOrchestrator {
  return new AgentOrchestrator(ctx);
}
